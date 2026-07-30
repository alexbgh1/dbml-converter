import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { DbmlCodeEditorComponent } from '../../components/dbml-converter/components/dbml-code-editor/dbml-code-editor.component';
import { DbmlConversionActionsComponent } from '../../shared/components/dbml-conversion-actions/dbml-conversion-actions.component';
import { LoadDbmlExampleButtonComponent } from '../../shared/components/load-dbml-example-button/load-dbml-example-button.component';
import { DBML_DEFAULT_EXAMPLE } from '../../components/dbml-converter/constants';
import { DbmlStateService } from '../../services/dbml-state/dbml-state.service';
import { DiagnosticRepairRequest } from '../../services/dbml-parser/interfaces/diagnostics.interface';
import {
  DiagramColumn,
  DiagramEdge,
  DiagramGraph,
  DiagramNode,
} from '../../services/er-diagram/er-diagram.interface';
import {
  columnMatchesSelection,
  DiagramSelection,
  edgeMatchesSelection,
  nodeMatchesSelection,
} from '../../services/er-diagram/diagram-selection';
import { schemaToDiagram } from '../../services/er-diagram/schema-to-diagram';
import { ER_DIAGRAM_CARD_GEOMETRY } from '../../services/er-diagram/er-diagram-card-geometry';
import {
  applyLayoutResult,
  diagramToLayoutRequest,
} from '../../services/er-diagram/layout/diagram-layout-adapter';
import { runGridLayout } from '../../services/er-diagram/layout/grid-layout-runner';
import {
  ErLayoutController,
  ErLayoutState,
} from '../../services/er-diagram/layout/er-layout-controller';
import { ER_LAYOUT_ENGINE } from '../../services/er-diagram/layout/er-layout-engine.token';
import {
  applyManualNodePositions,
  moveNodeInLayout,
} from '../../services/er-diagram/layout/manual-layout';
import type {
  LayoutPoint,
  LayoutRequest,
  LayoutResult,
} from '../../services/er-diagram/layout/layout-contracts';
import { ErDiagramWorkspaceService } from '../../services/er-diagram/er-diagram-workspace.service';
import { DiagnosticsPanelComponent } from '../../shared/components/diagnostics-panel/diagnostics-panel.component';
import {
  clientPointToWorkspace,
  panAfterBoundsOriginChange,
} from '../../services/er-diagram/workspace-geometry';

const EMPTY_DIAGRAM_GRAPH: DiagramGraph = {
  nodes: [],
  edges: [],
  layout: {
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    width: 0,
    height: 0,
  },
};

const LAYOUT_TIMEOUT_MS = 10_000;
const POINTER_DRAG_THRESHOLD_SQUARED = 9;

interface PointerGestureBase {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  moved: boolean;
  captured: boolean;
}

interface CanvasPanGesture extends PointerGestureBase {
  readonly kind: 'pan';
  readonly panX: number;
  readonly panY: number;
}

interface NodeDragGesture extends PointerGestureBase {
  readonly kind: 'node';
  readonly nodeId: string;
  readonly pointerOffset: LayoutPoint;
  pendingPosition: LayoutPoint | null;
}

type PointerGesture = CanvasPanGesture | NodeDragGesture;

@Component({
  selector: 'app-er-diagram',
  imports: [
    DbmlCodeEditorComponent,
    DbmlConversionActionsComponent,
    LoadDbmlExampleButtonComponent,
    DiagnosticsPanelComponent,
  ],
  templateUrl: './er-diagram.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'flex-1 min-h-0' },
})
export class ErDiagramComponent {
  private state = inject(DbmlStateService);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);
  private engineRunner = inject(ER_LAYOUT_ENGINE);
  private workspace = inject(ErDiagramWorkspaceService);
  private viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  private dbmlEditor = viewChild(DbmlCodeEditorComponent);
  readonly cardHeaderHeight = ER_DIAGRAM_CARD_GEOMETRY.headerHeight;
  readonly cardRowHeight = ER_DIAGRAM_CARD_GEOMETRY.rowHeight;
  readonly cardEmptyBodyHeight = ER_DIAGRAM_CARD_GEOMETRY.emptyBodyHeight;
  readonly cardContentPaddingX = ER_DIAGRAM_CARD_GEOMETRY.contentPaddingX;
  readonly dbmlContent = this.state.dbmlContent;
  readonly isConverting = this.state.isConverting;
  readonly diagnosticsState = this.state.diagnosticsState;
  readonly inputPanelOpen = signal(true);
  private layoutController = new ErLayoutController(
    this.engineRunner,
    runGridLayout,
    { engineTimeoutMs: LAYOUT_TIMEOUT_MS },
  );

  hasConverted = this.state.hasConvertedOutput;
  private semanticGraph = computed<DiagramGraph>(() =>
    this.hasConverted()
      ? schemaToDiagram(this.state.schema())
      : EMPTY_DIAGRAM_GRAPH,
  );
  hasDiagramInput = computed(() => this.semanticGraph().nodes.length > 0);
  graph = signal<DiagramGraph>(EMPTY_DIAGRAM_GRAPH);
  layoutState = signal<ErLayoutState>({ status: 'idle' });
  isLayoutLoading = computed(() => this.layoutState().status === 'loading');
  layoutWarning = computed(() => {
    const state = this.layoutState();
    return state.status === 'ready' ? (state.warning ?? null) : null;
  });
  layoutError = computed(() => {
    const state = this.layoutState();
    return state.status === 'error' ? state.diagnostic : null;
  });
  layoutStatusLabel = computed(() => {
    const state = this.layoutState();
    if (state.status === 'loading') return 'Loading layout';
    if (state.status === 'error') return 'Error';
    if (state.status === 'idle') return 'Idle';
    return state.source === 'fallback' ? 'Fallback' : 'Ready';
  });

  zoom = signal(1);
  panX = signal(0);
  panY = signal(0);
  selection = signal<DiagramSelection>(null);
  draggingNodeId = signal<string | null>(null);
  isCanvasPanning = signal(false);
  hasSelection = computed(() => this.selection() !== null);
  transform = computed(
    () => `translate(${this.panX()}px, ${this.panY()}px) scale(${this.zoom()})`,
  );
  graphOffset = computed(
    () =>
      `translate(${-this.graph().layout.minX} ${-this.graph().layout.minY})`,
  );

  private pointerGesture: PointerGesture | undefined;
  private pointerWindowListenersActive = false;
  private cancelledClickPointerId: number | null = null;
  private animationFrameId: number | null = null;
  private suppressNextDiagramClick = false;
  private clickSuppressionTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingRequestGraph: DiagramGraph | null = null;
  private activeRequestGraph: DiagramGraph | null = null;
  private activeLayoutRequest: LayoutRequest | null = null;
  private workspaceLayoutResult: LayoutResult | null = null;
  private pendingFitRequestId = signal<number | null>(null);
  private fitResizeObserver: ResizeObserver | undefined;
  private observedViewport: HTMLDivElement | undefined;
  private readonly handleWindowBlur = (): void => this.cancelPointerGesture();
  private readonly handleWindowPointerMove = (event: PointerEvent): void => {
    const viewport = this.viewport()?.nativeElement;
    if (viewport && event.composedPath().includes(viewport)) return;
    this.movePan(event);
  };
  private readonly handleWindowPointerEnd = (event: PointerEvent): void => {
    const gesture = this.pointerGesture;
    if (gesture?.pointerId === event.pointerId) {
      this.endPan(event);
      return;
    }

    if (this.cancelledClickPointerId !== event.pointerId) return;
    this.cancelledClickPointerId = null;
    if (event.type === 'pointerup') this.suppressDiagramClickOnce();
    this.detachPointerWindowListenersIfIdle();
  };

  constructor() {
    const unsubscribe = this.layoutController.subscribe((state) =>
      this.acceptLayoutState(state),
    );
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this.handleWindowBlur);
    }
    this.destroyRef.onDestroy(() => {
      this.cancelPointerGesture();
      this.clearCancelledPointerGuard();
      this.clearClickSuppression();
      unsubscribe();
      this.layoutController.clear();
      this.disconnectFitObserver();
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', this.handleWindowBlur);
      }
    });

    effect(() => {
      const converted = this.hasConverted();
      const semanticGraph = this.semanticGraph();
      untracked(() => {
        if (!converted || semanticGraph.nodes.length === 0) {
          this.cancelPointerGesture();
          if (converted) this.workspace.retainNodeIds([]);
          this.pendingRequestGraph = null;
          this.activeRequestGraph = null;
          this.layoutController.clear();
          return;
        }
        this.requestLayout(semanticGraph);
      });
    });

    effect(() => {
      const graph = this.graph();
      const selection = untracked(this.selection);
      if (
        selection &&
        !this.selectionExists(selection, graph.nodes, graph.edges)
      ) {
        this.selection.set(null);
      }
    });

    effect(() => {
      const requestId = this.pendingFitRequestId();
      const viewport = this.viewport()?.nativeElement;
      this.graph();
      if (requestId === null || !viewport) return;
      untracked(() => this.attemptPendingFit(requestId, viewport));
    });
  }

  autoArrange(): void {
    const semanticGraph = this.semanticGraph();
    if (!this.hasConverted() || semanticGraph.nodes.length === 0) return;
    this.cancelPointerGesture();
    this.workspace.clear();
    this.requestLayout(semanticGraph);
  }

  toggleInputPanel(): void {
    this.inputPanelOpen.update((open) => !open);
  }

  onDbmlInput(code: string): void {
    this.state.onDbmlInput(code);
  }

  handleConvert(): void {
    this.state.handleConvert();
  }

  clearAll(): void {
    this.state.clearAll();
  }

  loadExample(): void {
    this.state.replaceDbml(DBML_DEFAULT_EXAMPLE);
  }

  zoomBy(delta: number): void {
    this.cancelPointerGesture();
    this.zoom.set(this.clampZoom(this.zoom() + delta));
  }

  resetViewport(): void {
    this.cancelPointerGesture();
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  fitToScreen(): void {
    this.cancelPointerGesture();
    const viewport = this.viewport()?.nativeElement;
    const graph = this.graph();
    if (!viewport || !graph.layout.width || !graph.layout.height) return;

    if (this.fitGraph(viewport, graph)) {
      this.pendingFitRequestId.set(null);
      this.disconnectFitObserver();
      return;
    }

    const state = this.layoutState();
    if (state.status === 'ready') {
      this.pendingFitRequestId.set(state.requestId);
      this.observeForPendingFit(viewport);
    }
  }

  private fitGraph(viewport: HTMLDivElement, graph: DiagramGraph): boolean {
    if (!graph.layout.width || !graph.layout.height) return false;

    const availableWidth = viewport.clientWidth - 48;
    const availableHeight = viewport.clientHeight - 48;
    if (availableWidth <= 0 || availableHeight <= 0) return false;

    const scale = this.clampZoom(
      Math.min(
        availableWidth / graph.layout.width,
        availableHeight / graph.layout.height,
      ),
    );
    this.zoom.set(scale);
    this.panX.set((viewport.clientWidth - graph.layout.width * scale) / 2);
    this.panY.set((viewport.clientHeight - graph.layout.height * scale) / 2);
    return true;
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (this.pointerGesture) return;
    const viewport = this.viewport()?.nativeElement;
    if (!viewport) return;

    const previousZoom = this.zoom();
    const nextZoom = this.clampZoom(
      previousZoom + (event.deltaY < 0 ? 0.1 : -0.1),
    );
    if (nextZoom === previousZoom) return;

    const rect = viewport.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const worldX = (pointerX - this.panX()) / previousZoom;
    const worldY = (pointerY - this.panY()) / previousZoom;

    this.zoom.set(nextZoom);
    this.panX.set(pointerX - worldX * nextZoom);
    this.panY.set(pointerY - worldY * nextZoom);
  }

  startPan(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) return;
    if (this.isLayoutLoading()) return;
    if (this.pointerGesture) return;

    const target = event.target instanceof Element ? event.target : null;
    const edgeHit = target?.closest<SVGPathElement>('[data-edge-id]');
    if (
      target &&
      !edgeHit &&
      target.closest('button, a, [data-node-card], [data-diagram-interactive]')
    )
      return;

    const viewport = this.pointerViewport(event);
    if (!viewport) return;

    // Reserve accepted canvas/edge gestures before the browser can start a
    // native SVG drag or text selection. Pointer Events still dispatches the
    // quiet `click`, so edge selection remains owned by selectEdge().
    event.preventDefault();
    this.preparePointerGesture();
    this.pointerGesture = {
      kind: 'pan',
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: this.panX(),
      panY: this.panY(),
      moved: false,
      captured: false,
    };
    this.attachPointerWindowListeners();
  }

  startNodeDrag(event: PointerEvent, node: DiagramNode): void {
    if (event.button !== 0 || !event.isPrimary || this.pointerGesture) return;
    if (this.isLayoutLoading()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-node-drag-excluded]')) return;
    if (
      !this.activeLayoutRequest ||
      !this.workspaceLayoutResult ||
      !this.activeLayoutRequest.nodes.some(
        (candidate) => candidate.id === node.id,
      )
    )
      return;

    const worldPoint = this.clientToWorkspace(event.clientX, event.clientY);
    if (!worldPoint) return;

    this.preparePointerGesture();
    this.pointerGesture = {
      kind: 'node',
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      nodeId: node.id,
      pointerOffset: {
        x: worldPoint.x - node.layout.x,
        y: worldPoint.y - node.layout.y,
      },
      pendingPosition: null,
      moved: false,
      captured: false,
    };
    this.attachPointerWindowListeners();
  }

  movePan(event: PointerEvent): void {
    const gesture = this.pointerGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.clientX;
    const deltaY = event.clientY - gesture.clientY;
    if (
      !gesture.moved &&
      deltaX * deltaX + deltaY * deltaY <= POINTER_DRAG_THRESHOLD_SQUARED
    )
      return;

    if (!gesture.moved) {
      gesture.moved = true;
      this.capturePointer(gesture, event);
      this.pendingFitRequestId.set(null);
      this.disconnectFitObserver();
      if (gesture.kind === 'node') {
        this.draggingNodeId.set(gesture.nodeId);
      } else {
        this.isCanvasPanning.set(true);
      }
    }

    (event as Partial<PointerEvent>).preventDefault?.();
    if (gesture.kind === 'pan') {
      this.panX.set(gesture.panX + deltaX);
      this.panY.set(gesture.panY + deltaY);
      return;
    }

    this.queueNodePosition(gesture, event.clientX, event.clientY);
  }

  endPan(event: PointerEvent): void {
    const gesture = this.pointerGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    if (
      event.type === 'pointerup' &&
      gesture.kind === 'node' &&
      gesture.moved
    ) {
      this.queueNodePosition(gesture, event.clientX, event.clientY);
      this.flushPendingNodeMove();
    } else if (event.type !== 'pointerup') {
      this.cancelScheduledNodeMove();
    }

    const shouldSuppressClick = event.type === 'pointerup' && gesture.moved;
    this.finishPointerGesture(gesture);
    if (shouldSuppressClick) this.suppressDiagramClickOnce();
  }

  onCanvasClick(): void {
    if (this.consumeSuppressedDiagramClick()) return;
    this.clearSelection();
  }

  cancelPointerGesture(event?: Event): void {
    const gesture = this.pointerGesture;
    if (!gesture) return;
    if (
      event &&
      'pointerId' in event &&
      typeof event.pointerId === 'number' &&
      event.pointerId !== gesture.pointerId
    )
      return;

    this.cancelScheduledNodeMove();
    if (gesture.moved && event?.type !== 'pointercancel') {
      this.cancelledClickPointerId = gesture.pointerId;
    }
    this.finishPointerGesture(gesture);
  }

  private preparePointerGesture(): void {
    this.clearCancelledPointerGuard();
    this.clearClickSuppression();
  }

  private attachPointerWindowListeners(): void {
    if (this.pointerWindowListenersActive || typeof window === 'undefined') {
      return;
    }
    window.addEventListener('pointermove', this.handleWindowPointerMove, true);
    window.addEventListener('pointerup', this.handleWindowPointerEnd, true);
    window.addEventListener('pointercancel', this.handleWindowPointerEnd, true);
    this.pointerWindowListenersActive = true;
  }

  private detachPointerWindowListenersIfIdle(): void {
    if (
      !this.pointerWindowListenersActive ||
      this.pointerGesture ||
      this.cancelledClickPointerId !== null ||
      typeof window === 'undefined'
    )
      return;

    window.removeEventListener(
      'pointermove',
      this.handleWindowPointerMove,
      true,
    );
    window.removeEventListener('pointerup', this.handleWindowPointerEnd, true);
    window.removeEventListener(
      'pointercancel',
      this.handleWindowPointerEnd,
      true,
    );
    this.pointerWindowListenersActive = false;
  }

  private clearCancelledPointerGuard(): void {
    this.cancelledClickPointerId = null;
    this.detachPointerWindowListenersIfIdle();
  }

  private pointerViewport(event: PointerEvent): HTMLDivElement | undefined {
    return event.currentTarget instanceof HTMLDivElement
      ? event.currentTarget
      : this.viewport()?.nativeElement;
  }

  private clientToWorkspace(
    clientX: number,
    clientY: number,
  ): LayoutPoint | null {
    const viewport = this.viewport()?.nativeElement;
    const graph = this.graph();
    if (!viewport) return null;

    const rect = viewport.getBoundingClientRect();
    return clientPointToWorkspace(
      { x: clientX, y: clientY },
      {
        viewportOrigin: { x: rect.left, y: rect.top },
        pan: { x: this.panX(), y: this.panY() },
        zoom: this.zoom(),
        boundsOrigin: { x: graph.layout.minX, y: graph.layout.minY },
      },
    );
  }

  private capturePointer(gesture: PointerGesture, event: PointerEvent): void {
    const viewport = this.pointerViewport(event);
    if (!viewport || typeof viewport.setPointerCapture !== 'function') return;
    try {
      viewport.setPointerCapture(gesture.pointerId);
      gesture.captured = true;
    } catch {
      // A pointer may have ended between the threshold event and capture.
      // Window blur/cancel still cleans the local gesture in that case.
    }
  }

  private queueNodePosition(
    gesture: NodeDragGesture,
    clientX: number,
    clientY: number,
  ): void {
    if (this.pointerGesture !== gesture) return;
    const pointer = this.clientToWorkspace(clientX, clientY);
    if (!pointer) return;

    gesture.pendingPosition = {
      x: pointer.x - gesture.pointerOffset.x,
      y: pointer.y - gesture.pointerOffset.y,
    };
    if (this.animationFrameId !== null) return;

    this.animationFrameId = this.requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.flushPendingNodeMove();
    });
  }

  private flushPendingNodeMove(): void {
    if (this.animationFrameId !== null) {
      this.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    const gesture = this.pointerGesture;
    if (gesture?.kind !== 'node' || !gesture.pendingPosition) return;
    const position = gesture.pendingPosition;
    gesture.pendingPosition = null;
    this.applyNodePosition(gesture.nodeId, position);
  }

  private cancelScheduledNodeMove(): void {
    if (this.animationFrameId !== null) {
      this.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.pointerGesture?.kind === 'node') {
      this.pointerGesture.pendingPosition = null;
    }
  }

  private applyNodePosition(nodeId: string, position: LayoutPoint): void {
    const request = this.activeLayoutRequest;
    const currentResult = this.workspaceLayoutResult;
    const semanticGraph = this.activeRequestGraph;
    if (!request || !currentResult || !semanticGraph) {
      return;
    }

    const nextResult = moveNodeInLayout(
      request,
      currentResult,
      nodeId,
      position,
    );
    if (nextResult === currentResult) return;

    const previousGraph = this.graph();
    const nextGraph = applyLayoutResult(semanticGraph, nextResult);
    const nextPan = panAfterBoundsOriginChange(
      { x: this.panX(), y: this.panY() },
      { x: previousGraph.layout.minX, y: previousGraph.layout.minY },
      { x: nextGraph.layout.minX, y: nextGraph.layout.minY },
      this.zoom(),
    );

    this.workspace.setNodePosition(nodeId, position);
    this.workspaceLayoutResult = nextResult;
    this.panX.set(nextPan.x);
    this.panY.set(nextPan.y);
    this.graph.set(nextGraph);
  }

  private finishPointerGesture(gesture: PointerGesture): void {
    if (this.pointerGesture !== gesture) return;
    const viewport = this.viewport()?.nativeElement;

    // Clear local state before release: releasePointerCapture synchronously
    // dispatches lostpointercapture in some browsers.
    this.pointerGesture = undefined;
    this.draggingNodeId.set(null);
    this.isCanvasPanning.set(false);
    this.detachPointerWindowListenersIfIdle();

    if (!gesture.captured || !viewport) return;
    try {
      const hasCapture =
        typeof viewport.hasPointerCapture !== 'function' ||
        viewport.hasPointerCapture(gesture.pointerId);
      if (hasCapture && typeof viewport.releasePointerCapture === 'function') {
        viewport.releasePointerCapture(gesture.pointerId);
      }
    } catch {
      // Capture may already have been released by the browser.
    }
  }

  private requestAnimationFrame(callback: FrameRequestCallback): number {
    if (
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      return window.requestAnimationFrame(callback);
    }
    return setTimeout(
      () => callback(performance.now()),
      16,
    ) as unknown as number;
  }

  private cancelAnimationFrame(handle: number): void {
    if (
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(handle);
      return;
    }
    clearTimeout(handle);
  }

  private suppressDiagramClickOnce(): void {
    this.clearClickSuppression();
    this.suppressNextDiagramClick = true;
    this.clickSuppressionTimer = setTimeout(() => {
      this.suppressNextDiagramClick = false;
      this.clickSuppressionTimer = undefined;
    });
  }

  private consumeSuppressedDiagramClick(): boolean {
    if (!this.suppressNextDiagramClick) return false;
    this.clearClickSuppression();
    return true;
  }

  private clearClickSuppression(): void {
    this.suppressNextDiagramClick = false;
    if (this.clickSuppressionTimer !== undefined) {
      clearTimeout(this.clickSuppressionTimer);
      this.clickSuppressionTimer = undefined;
    }
  }

  selectNode(event: Event, node: DiagramNode): void {
    event.stopPropagation();
    if (this.consumeSuppressedDiagramClick()) return;
    const current = this.selection();
    this.selection.set(
      current?.kind === 'node' && current.nodeId === node.id
        ? null
        : { kind: 'node', nodeId: node.id },
    );
  }

  selectColumn(event: Event, node: DiagramNode, column: DiagramColumn): void {
    event.stopPropagation();
    const current = this.selection();
    this.selection.set(
      current?.kind === 'column' && current.columnId === column.id
        ? null
        : { kind: 'column', nodeId: node.id, columnId: column.id },
    );
  }

  selectEdge(event: Event, edge: DiagramEdge): void {
    event.stopPropagation();
    if (this.consumeSuppressedDiagramClick()) return;
    const current = this.selection();
    this.selection.set(
      current?.kind === 'edge' && current.edgeId === edge.id
        ? null
        : { kind: 'edge', edgeId: edge.id },
    );
  }

  clearSelection(): void {
    this.selection.set(null);
  }

  edgeIsEmphasized(edge: DiagramEdge): boolean {
    return edgeMatchesSelection(edge, this.selection());
  }

  edgeIsSelected(edge: DiagramEdge): boolean {
    const selection = this.selection();
    return selection?.kind === 'edge' && selection.edgeId === edge.id;
  }

  nodeIsEmphasized(node: DiagramNode): boolean {
    return nodeMatchesSelection(node, this.graph().edges, this.selection());
  }

  nodeIsDirectlySelected(node: DiagramNode): boolean {
    const selection = this.selection();
    return (
      (selection?.kind === 'node' || selection?.kind === 'column') &&
      selection.nodeId === node.id
    );
  }

  nodeButtonIsPressed(node: DiagramNode): boolean {
    const selection = this.selection();
    return selection?.kind === 'node' && selection.nodeId === node.id;
  }

  nodeIsDragging(node: DiagramNode): boolean {
    return this.draggingNodeId() === node.id;
  }

  columnIsSelected(node: DiagramNode, column: DiagramColumn): boolean {
    return columnMatchesSelection(node.id, column.id, this.selection());
  }

  showSource(event: Event, line?: number): void {
    event.stopPropagation();
    if (line === undefined) return;
    this.revealSourceLine(line);
  }

  goToLine(line: number): void {
    this.revealSourceLine(line);
  }

  applyRepair(request: DiagnosticRepairRequest): void {
    this.state.applyDiagnosticRepair(request);
  }

  undoRepair(): void {
    this.state.undoLastRepair();
  }

  private revealSourceLine(line: number): void {
    this.inputPanelOpen.set(true);
    afterNextRender(
      { write: () => this.dbmlEditor()?.scrollToLine(line) },
      { injector: this.injector },
    );
  }

  private requestLayout(semanticGraph: DiagramGraph): void {
    this.cancelPointerGesture();
    this.workspace.retainNodeIds(semanticGraph.nodes.map((node) => node.id));
    const request = diagramToLayoutRequest(semanticGraph, 0);
    const input = {
      nodes: request.nodes,
      edges: request.edges,
      options: request.options,
    };

    this.pendingRequestGraph = semanticGraph;
    void this.layoutController.layout(input);
    // `layout()` publishes loading synchronously, so the request context has
    // already been captured before asynchronous engine work can complete.
    this.pendingRequestGraph = null;
  }

  private acceptLayoutState(state: ErLayoutState): void {
    this.layoutState.set(state);

    if (state.status === 'idle') {
      this.cancelPointerGesture();
      this.activeLayoutRequest = null;
      this.workspaceLayoutResult = null;
      this.clearRenderedLayout();
      return;
    }

    if (state.status === 'loading') {
      this.activeRequestGraph = this.pendingRequestGraph;
      if (state.lastKnownGood && this.activeRequestGraph) {
        this.renderWorkspaceLayout(state.lastKnownGood, false);
      } else {
        // Initial or incompatible work intentionally renders no grid while
        // ELK is pending. The grid is reserved for an actual fallback result.
        this.activeLayoutRequest = null;
        this.workspaceLayoutResult = null;
        this.clearRenderedLayout();
      }
      return;
    }

    if (state.status === 'error') {
      if (state.lastKnownGood && this.activeRequestGraph) {
        this.renderWorkspaceLayout(state.lastKnownGood, false);
      } else {
        this.activeLayoutRequest = null;
        this.workspaceLayoutResult = null;
        this.clearRenderedLayout();
      }
      return;
    }

    if (!this.activeRequestGraph) {
      // A ready state without its semantic request cannot be rendered safely.
      this.clearRenderedLayout();
      return;
    }

    this.renderWorkspaceLayout(state.result, true);
    this.scheduleFitAfterCommit(state.requestId);
  }

  private renderWorkspaceLayout(
    automaticResult: LayoutResult,
    retainCurrentNodeIds: boolean,
  ): void {
    const semanticGraph = this.activeRequestGraph;
    if (!semanticGraph) return;

    const request = diagramToLayoutRequest(
      semanticGraph,
      automaticResult.requestId,
    );
    const positions = retainCurrentNodeIds
      ? this.workspace.retainNodeIds(request.nodes.map((node) => node.id))
      : this.workspace.snapshot();
    const workspaceResult = applyManualNodePositions(
      request,
      automaticResult,
      positions,
    );

    this.activeLayoutRequest = request;
    this.workspaceLayoutResult = workspaceResult;
    this.graph.set(applyLayoutResult(semanticGraph, workspaceResult));
  }

  private scheduleFitAfterCommit(requestId: number): void {
    this.pendingFitRequestId.set(requestId);
    afterNextRender(
      {
        read: () => {
          const viewport = this.viewport()?.nativeElement;
          if (viewport) this.attemptPendingFit(requestId, viewport);
        },
      },
      { injector: this.injector },
    );
  }

  private attemptPendingFit(requestId: number, viewport: HTMLDivElement): void {
    if (this.pendingFitRequestId() !== requestId) return;
    if (this.fitGraph(viewport, this.graph())) {
      this.pendingFitRequestId.set(null);
      this.disconnectFitObserver();
      return;
    }
    this.observeForPendingFit(viewport);
  }

  private observeForPendingFit(viewport: HTMLDivElement): void {
    if (typeof ResizeObserver === 'undefined') return;
    if (this.fitResizeObserver && this.observedViewport === viewport) return;

    this.disconnectFitObserver();
    this.observedViewport = viewport;
    this.fitResizeObserver = new ResizeObserver(() => {
      const requestId = this.pendingFitRequestId();
      if (requestId !== null) this.attemptPendingFit(requestId, viewport);
    });
    this.fitResizeObserver.observe(viewport);
  }

  private disconnectFitObserver(): void {
    this.fitResizeObserver?.disconnect();
    this.fitResizeObserver = undefined;
    this.observedViewport = undefined;
  }

  private clearRenderedLayout(): void {
    this.pendingFitRequestId.set(null);
    this.disconnectFitObserver();
    this.graph.set(EMPTY_DIAGRAM_GRAPH);
  }

  private selectionExists(
    selection: NonNullable<DiagramSelection>,
    nodes: DiagramNode[],
    edges: DiagramEdge[],
  ): boolean {
    if (selection.kind === 'edge') {
      return edges.some((edge) => edge.id === selection.edgeId);
    }

    const node = nodes.find((candidate) => candidate.id === selection.nodeId);
    if (!node) return false;
    if (selection.kind === 'node') return true;
    return node.columns.some((column) => column.id === selection.columnId);
  }

  private clampZoom(value: number): number {
    return Math.min(2, Math.max(0.35, Number(value.toFixed(2))));
  }
}
