import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DbmlCodeEditorComponent } from '../../components/dbml-converter/components/dbml-code-editor/dbml-code-editor.component';
import { DbmlStateService } from '../../services/dbml-state/dbml-state.service';
import { DIAGNOSTIC_CODES } from '../../services/dbml-parser/constants/diagnostic-codes.constants';
import {
  Diagnostic,
  DiagnosticsViewState,
} from '../../services/dbml-parser/interfaces/diagnostics.interface';
import {
  Cardinality,
  DatabaseSchema,
} from '../../services/dbml-parser/interfaces/dbml-parser.interface';
import type { DiagramNode } from '../../services/er-diagram/er-diagram.interface';
import { ER_LAYOUT_ENGINE } from '../../services/er-diagram/layout/er-layout-engine.token';
import {
  ErLayoutRunner,
  ErLayoutState,
} from '../../services/er-diagram/layout/er-layout-controller';
import { runGridLayout } from '../../services/er-diagram/layout/grid-layout-runner';
import {
  LayoutRequest,
  LayoutResult,
} from '../../services/er-diagram/layout/layout-contracts';
import { ErDiagramWorkspaceService } from '../../services/er-diagram/er-diagram-workspace.service';
import { ErDiagramComponent } from './er-diagram.component';

const SCHEMA: DatabaseSchema = {
  tables: [
    {
      name: 'memberships',
      alias: null,
      sourceLine: 1,
      columns: [
        {
          name: 'tenant_id',
          type: 'uuid',
          pk: true,
          unique: true,
          nullable: true,
          sourceLine: 2,
        },
        {
          name: 'user_id',
          type: 'uuid',
          unique: true,
          nullable: false,
          sourceLine: 3,
        },
      ],
    },
    {
      name: 'tenants',
      alias: null,
      sourceLine: 6,
      columns: [{ name: 'id', type: 'uuid', pk: true, sourceLine: 7 }],
    },
    {
      name: 'users',
      alias: null,
      sourceLine: 10,
      columns: [{ name: 'id', type: 'uuid', pk: true, sourceLine: 11 }],
    },
  ],
  relations: [
    {
      from: { table: 'memberships', column: 'tenant_id' },
      to: { table: 'tenants', column: 'id' },
      cardinality: { from: Cardinality.Many, to: Cardinality.One },
    },
    {
      from: { table: 'memberships', column: 'user_id' },
      to: { table: 'users', column: 'id' },
      cardinality: { from: Cardinality.Many, to: Cardinality.One },
    },
  ],
};

const SECOND_SCHEMA: DatabaseSchema = {
  tables: [
    {
      name: 'projects',
      alias: null,
      sourceLine: 1,
      columns: [{ name: 'id', type: 'uuid', pk: true, sourceLine: 2 }],
    },
  ],
  relations: [],
};

interface FakeState {
  hasConvertedOutput: ReturnType<typeof signal<boolean>>;
  schema: ReturnType<typeof signal<DatabaseSchema>>;
  dbmlContent: ReturnType<typeof signal<string>>;
  isConverting: ReturnType<typeof signal<boolean>>;
  diagnosticsState: ReturnType<typeof signal<DiagnosticsViewState>>;
  onDbmlInput: ReturnType<typeof vi.fn>;
  handleConvert: ReturnType<typeof vi.fn>;
  clearAll: ReturnType<typeof vi.fn>;
  replaceDbml: ReturnType<typeof vi.fn>;
  applyDiagnosticRepair: ReturnType<typeof vi.fn>;
  undoLastRepair: ReturnType<typeof vi.fn>;
}

type PointerViewport = HTMLDivElement & {
  setPointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
};

describe('ErDiagramComponent', () => {
  let fixture: ComponentFixture<ErDiagramComponent>;
  let component: ErDiagramComponent;
  let state: FakeState;
  let engineImplementation: ErLayoutRunner;
  let engine: ReturnType<typeof vi.fn<ErLayoutRunner>>;
  let workspace: ErDiagramWorkspaceService;

  beforeEach(() => {
    state = {
      hasConvertedOutput: signal(true),
      schema: signal(SCHEMA),
      dbmlContent: signal('Table users { id int [pk] }'),
      isConverting: signal(false),
      diagnosticsState: signal<DiagnosticsViewState>({
        freshness: 'current',
        items: [],
        repairActivity: null,
        repairFailure: null,
        canUndo: false,
      }),
      onDbmlInput: vi.fn(),
      handleConvert: vi.fn(),
      clearAll: vi.fn(),
      replaceDbml: vi.fn(),
      applyDiagnosticRepair: vi.fn(),
      undoLastRepair: vi.fn(),
    };
    engineImplementation = async (request) => elkGridResult(request);
    engine = vi.fn<ErLayoutRunner>((request) => engineImplementation(request));

    TestBed.configureTestingModule({
      providers: [
        { provide: DbmlStateService, useValue: state },
        { provide: ER_LAYOUT_ENGINE, useValue: engine },
      ],
    });

    workspace = TestBed.inject(ErDiagramWorkspaceService);
    workspace.clear();
  });

  function createComponent(): void {
    fixture = TestBed.createComponent(ErDiagramComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  async function renderReady(): Promise<void> {
    createComponent();
    await settleLayout();
  }

  async function settleLayout(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
  }

  async function flushLayoutMicrotasks(): Promise<void> {
    for (let turn = 0; turn < 4; turn += 1) {
      await Promise.resolve();
    }
    fixture.detectChanges();
  }

  it('toggles the DBML input panel and forwards editor actions', () => {
    createComponent();

    expect(
      fixture.nativeElement.querySelector('#er-diagram-input-panel'),
    ).not.toBeNull();

    component.onDbmlInput('Table posts { id int [pk] }');
    component.handleConvert();
    component.clearAll();

    expect(state.onDbmlInput).toHaveBeenCalledWith(
      'Table posts { id int [pk] }',
    );
    expect(state.handleConvert).toHaveBeenCalledOnce();
    expect(state.clearAll).toHaveBeenCalledOnce();

    component.toggleInputPanel();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#er-diagram-input-panel'),
    ).toBeNull();
  });

  it('shows loading without a grid until the first engine result is accepted', async () => {
    const deferred = createDeferred<LayoutResult>();
    engineImplementation = () => deferred.promise;
    createComponent();

    expect(component.layoutState()).toEqual({
      status: 'loading',
      requestId: 1,
    });
    expect(component.graph().nodes).toEqual([]);
    expect(
      fixture.nativeElement.querySelector(
        '[aria-label="Diagram layout loading"]',
      ),
    ).not.toBeNull();

    await Promise.resolve();
    const request = engine.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    deferred.resolve(elkGridResult(request!));
    await settleLayout();

    expect(component.layoutState()).toMatchObject({
      status: 'ready',
      requestId: 1,
      source: 'engine',
    });
    expect(component.graph().nodes).toHaveLength(SCHEMA.tables.length);
    expect(
      fixture.nativeElement.querySelector(
        '[aria-label="Diagram layout loading"]',
      ),
    ).toBeNull();
    expect(component.layoutStatusLabel()).toBe('Ready');
  });

  it('shows a nonblocking warning when the engine falls back to the grid', async () => {
    engineImplementation = async () => {
      throw new Error('engine unavailable');
    };
    await renderReady();

    expect(component.layoutState()).toMatchObject({
      status: 'ready',
      source: 'fallback',
      warning: { code: 'layout-engine-fallback' },
    });
    expect(component.graph().nodes).toHaveLength(SCHEMA.tables.length);
    const warning = fixture.nativeElement.querySelector(
      '[aria-label="Layout warning"]',
    ) as HTMLElement;
    expect(warning.textContent).toContain('fallback layout was used');
    expect(component.layoutStatusLabel()).toBe('Fallback');
  });

  it('ignores a stale engine response after the converted schema changes', async () => {
    const first = createDeferred<LayoutResult>();
    const second = createDeferred<LayoutResult>();
    engineImplementation = (request) =>
      request.nodes[0]?.id.includes('projects')
        ? second.promise
        : first.promise;
    createComponent();
    await Promise.resolve();
    const firstRequest = engine.mock.calls[0]?.[0];

    state.schema.set(SECOND_SCHEMA);
    fixture.detectChanges();
    await Promise.resolve();
    const secondRequest = engine.mock.calls[1]?.[0];
    expect(component.layoutState()).toMatchObject({
      status: 'loading',
      requestId: 2,
    });
    expect(component.graph().nodes).toEqual([]);

    second.resolve(elkGridResult(secondRequest!));
    await flushLayoutMicrotasks();
    expect(component.layoutState()).toMatchObject({
      status: 'ready',
      requestId: 2,
    });
    expect(component.graph().nodes.map((node) => node.label)).toEqual([
      'projects',
    ]);

    first.resolve(elkGridResult(firstRequest!));
    await settleLayout();
    expect(component.layoutState()).toMatchObject({
      status: 'ready',
      requestId: 2,
    });
    expect(component.graph().nodes.map((node) => node.label)).toEqual([
      'projects',
    ]);
  });

  it('reruns Auto arrange while retaining the compatible accepted graph', async () => {
    await renderReady();
    const labels = component.graph().nodes.map((node) => node.label);
    const deferred = createDeferred<LayoutResult>();
    engineImplementation = () => deferred.promise;

    autoArrangeButton().click();
    fixture.detectChanges();

    expect(component.layoutState()).toMatchObject({
      status: 'loading',
      requestId: 2,
      lastKnownGood: { requestId: 1 },
    });
    expect(component.graph().nodes.map((node) => node.label)).toEqual(labels);

    await Promise.resolve();
    deferred.resolve(elkGridResult(engine.mock.calls[1]![0]));
    await settleLayout();
    expect(engine).toHaveBeenCalledTimes(2);
    expect(component.layoutState()).toMatchObject({
      status: 'ready',
      requestId: 2,
      source: 'engine',
    });
  });

  it('fits automatically only after an accepted layout commit', async () => {
    const width = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(1000);
    const height = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(700);
    const deferred = createDeferred<LayoutResult>();
    engineImplementation = () => deferred.promise;

    try {
      createComponent();
      expect(component.layoutState().status).toBe('loading');
      expect(component.zoom()).toBe(1);
      expect(component.panX()).toBe(0);
      expect(component.panY()).toBe(0);

      await Promise.resolve();
      deferred.resolve(elkGridResult(engine.mock.calls[0]![0]));
      await settleLayout();

      const graph = component.graph();
      const expectedZoom = Math.min(
        2,
        Math.max(
          0.35,
          Number(
            Math.min(
              952 / graph.layout.width,
              652 / graph.layout.height,
            ).toFixed(2),
          ),
        ),
      );
      expect(component.layoutState().status).toBe('ready');
      expect(component.zoom()).toBe(expectedZoom);
      expect(component.panX()).toBe(
        (1000 - graph.layout.width * expectedZoom) / 2,
      );
      expect(component.panY()).toBe(
        (700 - graph.layout.height * expectedZoom) / 2,
      );
    } finally {
      width.mockRestore();
      height.mockRestore();
    }
  });

  it('retries a pending fit when a zero-sized viewport becomes measurable', async () => {
    let resizeCallback!: ResizeObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = observe;
        unobserve = vi.fn();
        disconnect = disconnect;
      },
    );

    try {
      await renderReady();
      expect(observe).toHaveBeenCalledOnce();
      expect(component.zoom()).toBe(1);

      const viewport = fixture.nativeElement.querySelector(
        '[aria-label="Entity relationship diagram canvas"]',
      ) as HTMLDivElement;
      Object.defineProperties(viewport, {
        clientWidth: { configurable: true, value: 1000 },
        clientHeight: { configurable: true, value: 700 },
      });
      resizeCallback([], {} as ResizeObserver);
      fixture.detectChanges();

      const graph = component.graph();
      const expectedZoom = Math.min(
        2,
        Math.max(
          0.35,
          Number(
            Math.min(
              952 / graph.layout.width,
              652 / graph.layout.height,
            ).toFixed(2),
          ),
        ),
      );
      expect(component.zoom()).toBe(expectedZoom);
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a compatible graph on layout error and clears an incompatible one', async () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(_callback: ResizeObserverCallback) {}
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = disconnect;
      },
    );

    try {
      await renderReady();
      const accepted = component.layoutState();
      expect(accepted.status).toBe('ready');
      if (accepted.status !== 'ready') return;

      publishLayoutState({
        status: 'error',
        requestId: accepted.requestId + 1,
        diagnostic: { code: 'layout-unavailable', message: 'layout failed' },
        causes: [],
        lastKnownGood: accepted.result,
      });
      fixture.detectChanges();

      expect(component.graph().nodes).toHaveLength(SCHEMA.tables.length);
      expect(
        fixture.nativeElement.querySelector('[aria-label="Layout error"]')
          .textContent,
      ).toContain('last successful layout remains visible');

      publishLayoutState({
        status: 'error',
        requestId: accepted.requestId + 2,
        diagnostic: {
          code: 'layout-unavailable',
          message: 'incompatible layout failed',
        },
        causes: [],
      });
      fixture.detectChanges();

      expect(component.graph().nodes).toEqual([]);
      expect(disconnect).toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain(
        'The diagram could not be arranged.',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders the legend and column badges in PK, FK, UQ, NN order', async () => {
    await renderReady();
    const legend = fixture.nativeElement.querySelector(
      '[aria-label="Diagram legend"]',
    ) as HTMLElement;
    const legendItems = Array.from<HTMLElement>(
      legend.querySelectorAll('span'),
    ).map((item) => item.textContent.trim());

    expect(legendItems).toEqual(['Legend', 'PK', 'FK', 'UQ', 'NN', 'junction']);
    expect(
      Array.from<HTMLElement>(legend.querySelectorAll('span[aria-label]')).map(
        (item) => item.getAttribute('aria-label'),
      ),
    ).toEqual([
      'Primary key (PK)',
      'Foreign key (FK)',
      'Unique (UQ)',
      'Not null (NN)',
    ]);

    expect(columnBadges('tenant_id')).toEqual(['PK', 'FK', 'UQ']);
    expect(columnBadges('user_id')).toEqual(['FK', 'UQ', 'NN']);
  });

  it('selects tables and columns without navigating to source', async () => {
    await renderReady();
    const layoutCallsBeforeSelection = engine.mock.calls.length;
    const layoutBeforeSelection = component.graph();
    const memberships = component.graph().nodes[0];
    const userId = memberships.columns[1];

    tableSelectionButton('memberships').click();
    fixture.detectChanges();

    expect(component.selection()).toEqual({
      kind: 'node',
      nodeId: memberships.id,
    });
    expect(
      tableSelectionButton('memberships').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(component.graph()).toBe(layoutBeforeSelection);
    expect(engine).toHaveBeenCalledTimes(layoutCallsBeforeSelection);

    columnSelectionButton('user_id').click();
    fixture.detectChanges();

    expect(component.selection()).toEqual({
      kind: 'column',
      nodeId: memberships.id,
      columnId: userId.id,
    });
    expect(
      tableSelectionButton('memberships').getAttribute('aria-pressed'),
    ).toBe('false');
    expect(columnSelectionButton('user_id').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(component.graph()).toBe(layoutBeforeSelection);
    expect(engine).toHaveBeenCalledTimes(layoutCallsBeforeSelection);

    component.zoomBy(0.1);
    component.resetViewport();
    expect(component.selection()).toEqual({
      kind: 'column',
      nodeId: memberships.id,
      columnId: userId.id,
    });
  });

  it('opens the embedded editor and selects table and column source lines', async () => {
    await renderReady();
    const scrollToLine = vi.spyOn(
      DbmlCodeEditorComponent.prototype,
      'scrollToLine',
    );

    component.toggleInputPanel();
    fixture.detectChanges();
    expect(component.inputPanelOpen()).toBe(false);
    expect(
      fixture.nativeElement.querySelector('#er-diagram-input-panel'),
    ).toBeNull();

    sourceButton('Show source for table memberships').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.inputPanelOpen()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('#er-diagram-input-panel'),
    ).not.toBeNull();
    expect(scrollToLine).toHaveBeenNthCalledWith(1, 1);

    sourceButton('Show source for memberships.user_id').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollToLine).toHaveBeenNthCalledWith(2, 3);
  });

  it('renders conversion diagnostics and wires navigation, repair and undo', async () => {
    const repair = {
      kind: 'replace-reference-target' as const,
      label: 'Fix reference',
      line: 3,
      expectedText: 'missing.id',
      replacementText: 'users.id',
    };
    const diagnostic: Diagnostic = {
      code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_TABLE,
      severity: 'error',
      phase: 'schema-validation',
      message: 'Referenced table does not exist',
      line: 3,
      repairs: [repair],
    };
    state.diagnosticsState.set({
      freshness: 'current',
      items: [{ id: 'unknown-table-0', diagnostic }],
      repairActivity: null,
      repairFailure: null,
      canUndo: false,
    });
    const scrollToLine = vi.spyOn(
      DbmlCodeEditorComponent.prototype,
      'scrollToLine',
    );

    await renderReady();
    const diagnosticsToggle = fixture.nativeElement.querySelector(
      'button[aria-controls="diagnostics-list"]',
    ) as HTMLButtonElement;
    expect(diagnosticsToggle.textContent).toContain('1 error');

    diagnosticsToggle.click();
    fixture.detectChanges();
    const diagnosticButton = fixture.nativeElement.querySelector(
      'button[aria-label="View details for SCHEMA_UNKNOWN_REFERENCE_TABLE"]',
    ) as HTMLButtonElement;
    diagnosticButton.click();
    fixture.detectChanges();
    buttonWithText('Go to line 3').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollToLine).toHaveBeenCalledWith(3);

    const repairButton = fixture.nativeElement.querySelector(
      'button[aria-label="Repair SCHEMA_UNKNOWN_REFERENCE_TABLE"]',
    ) as HTMLButtonElement;
    repairButton.click();
    fixture.detectChanges();
    buttonWithText('Apply repair').click();
    expect(state.applyDiagnosticRepair).toHaveBeenCalledWith({
      diagnosticId: 'unknown-table-0',
      diagnostic,
      repair,
    });

    state.diagnosticsState.set({
      freshness: 'pending-validation',
      items: [{ id: 'unknown-table-0', diagnostic }],
      repairActivity: {
        diagnosticId: 'unknown-table-0',
        affectedDiagnosticIds: ['unknown-table-0'],
        diagnostic,
        repair,
        before: 'before',
        after: state.dbmlContent(),
        status: 'pending-validation',
        resolvedDiagnosticCount: 0,
      },
      repairFailure: null,
      canUndo: true,
    });
    fixture.detectChanges();
    buttonWithText('Undo').click();

    expect(state.undoLastRepair).toHaveBeenCalledOnce();
  });

  it('keeps the wide edge hit target on the visible route and selects it', async () => {
    await renderReady();
    const hitPath = fixture.nativeElement.querySelector(
      'svg path[data-diagram-interactive]',
    ) as SVGPathElement;
    const visiblePath = hitPath.nextElementSibling as SVGPathElement;

    expect(hitPath.getAttribute('d')).toBe(visiblePath.getAttribute('d'));
    expect(hitPath.getAttribute('stroke-width')).toBe('14');
    expect(hitPath.getAttribute('vector-effect')).toBe('non-scaling-stroke');

    hitPath.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(component.selection()).toEqual({
      kind: 'edge',
      edgeId: component.graph().edges[0].id,
    });
  });

  it('renders accepted engine geometry as rounded orthogonal routes', async () => {
    await renderReady();
    const edge = component.graph().edges[0];
    const relationLabel = fixture.nativeElement.querySelector(
      'svg text',
    ) as SVGTextElement;
    const firstNode = fixture.nativeElement.querySelector(
      'article',
    ) as HTMLElement;

    expect(edge.cardinality).toBe('N:1');
    expect(edge.layout.renderCardinality).toBe('1:N');
    expect(edge.layout.path).toContain(' Q ');
    expect(edge.layout.path).not.toContain(' C ');
    expect(relationLabel.textContent.trim()).toBe('1:N');
    expect(firstNode.style.left).toBe(
      `${component.graph().nodes[0].layout.x - component.graph().layout.minX}px`,
    );
    expect(
      fixture.nativeElement.querySelector('svg g').getAttribute('transform'),
    ).toBe(component.graphOffset());
  });

  it('clears selection on a canvas click but suppresses the click after a pan', async () => {
    await renderReady();
    const node = component.graph().nodes[0];
    const viewport = fixture.nativeElement.querySelector(
      '[aria-label="Entity relationship diagram canvas"]',
    ) as HTMLDivElement & {
      setPointerCapture: (pointerId: number) => void;
      hasPointerCapture: (pointerId: number) => boolean;
      releasePointerCapture: (pointerId: number) => void;
    };
    viewport.setPointerCapture = vi.fn();
    viewport.hasPointerCapture = vi.fn(() => true);
    viewport.releasePointerCapture = vi.fn();

    component.selection.set({ kind: 'node', nodeId: node.id });
    component.startPan(pointerEvent('pointerdown', 10, 10, viewport));
    component.movePan(pointerEvent('pointermove', 14, 10, viewport));
    component.endPan(pointerEvent('pointerup', 14, 10, viewport));

    expect(component.selection()).toEqual({ kind: 'node', nodeId: node.id });

    component.onCanvasClick();

    expect(component.selection()).toEqual({ kind: 'node', nodeId: node.id });

    component.onCanvasClick();

    expect(component.selection()).toBeNull();

    component.selection.set({ kind: 'node', nodeId: node.id });
    const panX = component.panX();
    const panY = component.panY();
    component.startPan(pointerEvent('pointerdown', 20, 20, viewport));
    component.movePan(pointerEvent('pointermove', 22, 20, viewport));
    component.endPan(pointerEvent('pointerup', 22, 20, viewport));

    expect(component.panX()).toBe(panX);
    expect(component.panY()).toBe(panY);

    component.onCanvasClick();

    expect(component.selection()).toBeNull();
  });

  it('keeps a short header click as selection without creating a manual position', async () => {
    await renderReady();
    const viewport = preparePointerViewport({ left: 120, top: 75 });
    const node = nodeByLabel('tenants');
    const header = tableSelectionButton(node.label);
    const start = nodeClientPoint(node, { x: 28, y: 18 }, viewport);
    const before = { x: node.layout.x, y: node.layout.y };

    component.startNodeDrag(
      pointerEvent('pointerdown', start.x, start.y, header, header),
      node,
    );
    component.movePan(
      pointerEvent('pointermove', start.x + 2, start.y, viewport),
    );
    component.endPan(pointerEvent('pointerup', start.x + 2, start.y, viewport));
    header.click();
    fixture.detectChanges();

    expect(component.selection()).toEqual({ kind: 'node', nodeId: node.id });
    expect(nodePosition(node.id)).toEqual(before);
    expect(component.draggingNodeId()).toBeNull();
    expect(workspace.snapshot().size).toBe(0);
    expect(engine).toHaveBeenCalledOnce();
  });

  it('drags a header through zoom and pan without rerunning ELK and reroutes only incident relations', async () => {
    await renderReady();
    const viewport = preparePointerViewport({ left: 95, top: 55 });
    component.zoom.set(1.5);
    component.panX.set(37);
    component.panY.set(-16);

    const beforeGraph = component.graph();
    const node = nodeByLabel('tenants');
    const before = { x: node.layout.x, y: node.layout.y };
    const incident = beforeGraph.edges.find(
      (edge) => edge.fromNode === node.id || edge.toNode === node.id,
    );
    const nonIncident = beforeGraph.edges.find(
      (edge) => edge.fromNode !== node.id && edge.toNode !== node.id,
    );
    expect(incident).toBeDefined();
    expect(nonIncident).toBeDefined();
    const layoutCalls = engine.mock.calls.length;

    dragNodeBy(node.label, { x: 60, y: -30 }, viewport);

    const moved = nodeByLabel(node.label);
    const afterIncident = component
      .graph()
      .edges.find((edge) => edge.id === incident!.id);
    const afterNonIncident = component
      .graph()
      .edges.find((edge) => edge.id === nonIncident!.id);
    expect(moved.layout.x).toBeCloseTo(before.x + 60);
    expect(moved.layout.y).toBeCloseTo(before.y - 30);
    expect(workspace.snapshot().get(node.id)).toEqual({
      x: moved.layout.x,
      y: moved.layout.y,
    });
    expect(afterIncident?.layout.path).not.toBe(incident!.layout.path);
    expect(afterNonIncident?.layout.path).toBe(nonIncident!.layout.path);
    expect(engine).toHaveBeenCalledTimes(layoutCalls);

    const header = tableSelectionButton(node.label);
    header.click();
    fixture.detectChanges();
    expect(component.selection()).toBeNull();

    header.click();
    fixture.detectChanges();
    expect(component.selection()).toEqual({ kind: 'node', nodeId: node.id });
  });

  it('compensates pan when a moved table expands the layout bounds', async () => {
    await renderReady();
    const viewport = preparePointerViewport({ left: 40, top: 30 });
    component.zoom.set(1.25);
    component.panX.set(73);
    component.panY.set(-22);

    const beforeGraph = component.graph();
    const stationary = nodeByLabel('users');
    const beforeScreen = graphScreenPosition(stationary);

    dragNodeBy('tenants', { x: -600, y: -420 }, viewport);

    const afterGraph = component.graph();
    const moved = nodeByLabel('tenants');
    const stationaryAfter = nodeByLabel('users');
    const afterScreen = graphScreenPosition(stationaryAfter);
    expect(afterGraph.layout.minX).toBeLessThan(beforeGraph.layout.minX);
    expect(afterGraph.layout.minY).toBeLessThan(beforeGraph.layout.minY);
    expect(afterGraph.layout.minX).toBeLessThanOrEqual(moved.layout.x);
    expect(afterGraph.layout.minY).toBeLessThanOrEqual(moved.layout.y);
    expect(afterGraph.layout.maxX).toBeGreaterThanOrEqual(
      moved.layout.x + moved.layout.width,
    );
    expect(afterGraph.layout.maxY).toBeGreaterThanOrEqual(
      moved.layout.y + moved.layout.height,
    );
    expect(stationaryAfter.layout.x).toBe(stationary.layout.x);
    expect(stationaryAfter.layout.y).toBe(stationary.layout.y);
    expect(afterScreen.x).toBeCloseTo(beforeScreen.x);
    expect(afterScreen.y).toBeCloseTo(beforeScreen.y);
  });

  it('keeps manual positions on Reset and clears them with Auto arrange', async () => {
    await renderReady();
    const viewport = preparePointerViewport();
    const automatic = nodePosition(nodeByLabel('tenants').id);
    const layoutCalls = engine.mock.calls.length;

    dragNodeBy('tenants', { x: 120, y: 85 }, viewport);
    const manuallyArranged = nodePosition(nodeByLabel('tenants').id);
    expect(manuallyArranged).not.toEqual(automatic);
    expect(workspace.snapshot().size).toBe(1);

    component.zoom.set(0.7);
    component.panX.set(90);
    component.panY.set(-45);
    component.resetViewport();

    expect(component.zoom()).toBe(1);
    expect(component.panX()).toBe(0);
    expect(component.panY()).toBe(0);
    expect(nodePosition(nodeByLabel('tenants').id)).toEqual(manuallyArranged);
    expect(workspace.snapshot().size).toBe(1);
    expect(engine).toHaveBeenCalledTimes(layoutCalls);

    autoArrangeButton().click();
    fixture.detectChanges();
    expect(workspace.snapshot().size).toBe(0);
    await settleLayout();

    expect(engine).toHaveBeenCalledTimes(layoutCalls + 1);
    expect(nodePosition(nodeByLabel('tenants').id)).toEqual(automatic);
    expect(workspace.snapshot().size).toBe(0);
  });

  it('selects an edge on a quiet click but pans from its hit path after movement', async () => {
    await renderReady();
    const viewport = preparePointerViewport();
    const hitPath = fixture.nativeElement.querySelector(
      'svg path[data-edge-id]',
    ) as SVGPathElement;
    const edgeId = hitPath.dataset['edgeId']!;

    component.startPan(
      pointerEvent('pointerdown', 160, 140, viewport, hitPath),
    );
    component.endPan(pointerEvent('pointerup', 160, 140, viewport, hitPath));
    hitPath.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(component.selection()).toEqual({ kind: 'edge', edgeId });

    component.selection.set(null);
    const panBefore = { x: component.panX(), y: component.panY() };
    component.startPan(
      pointerEvent('pointerdown', 210, 190, viewport, hitPath),
    );
    component.movePan(pointerEvent('pointermove', 245, 214, viewport, hitPath));
    component.endPan(pointerEvent('pointerup', 245, 214, viewport, hitPath));

    expect(component.panX()).toBe(panBefore.x + 35);
    expect(component.panY()).toBe(panBefore.y + 24);

    hitPath.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(component.selection()).toBeNull();

    hitPath.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(component.selection()).toEqual({ kind: 'edge', edgeId });
  });

  it('prevents native SVG dragging from an edge hit path without losing its quiet click', async () => {
    await renderReady();
    preparePointerViewport();
    const hitPath = fixture.nativeElement.querySelector(
      'svg path[data-edge-id]',
    ) as SVGPathElement;
    const edgeId = hitPath.dataset['edgeId']!;

    const pointerDown = dispatchPointerEvent(
      hitPath,
      'pointerdown',
      160,
      140,
      43,
    );
    const dragStart = new Event('dragstart', {
      bubbles: true,
      cancelable: true,
    });
    hitPath.dispatchEvent(dragStart);
    dispatchPointerEvent(hitPath, 'pointerup', 160, 140, 43);
    hitPath.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect({
      pointerDownPrevented: pointerDown.defaultPrevented,
      dragStartPrevented: dragStart.defaultPrevented,
      selection: component.selection(),
    }).toEqual({
      pointerDownPrevented: true,
      dragStartPrevented: true,
      selection: { kind: 'edge', edgeId },
    });
  });

  it('ignores a second pointer and discards a cancelled drag frame', async () => {
    let nextFrameId = 91;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      void callback;
      return nextFrameId++;
    });
    const cancelFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);

    try {
      await renderReady();
      requestFrame.mockClear();
      cancelFrame.mockClear();
      const viewport = preparePointerViewport();
      const node = nodeByLabel('tenants');
      const header = tableSelectionButton(node.label);
      const start = nodeClientPoint(node, { x: 20, y: 18 }, viewport);
      const before = { x: node.layout.x, y: node.layout.y };

      component.startNodeDrag(
        pointerEvent('pointerdown', start.x, start.y, header, header, 7),
        node,
      );
      component.movePan(
        pointerEvent(
          'pointermove',
          start.x + 90,
          start.y + 40,
          viewport,
          viewport,
          8,
        ),
      );
      component.cancelPointerGesture(
        pointerEvent(
          'pointercancel',
          start.x + 90,
          start.y + 40,
          viewport,
          viewport,
          8,
        ),
      );

      expect(requestFrame).not.toHaveBeenCalled();

      component.movePan(
        pointerEvent(
          'pointermove',
          start.x + 90,
          start.y + 40,
          viewport,
          viewport,
          7,
        ),
      );
      expect(requestFrame).toHaveBeenCalled();
      expect(component.draggingNodeId()).toBe(node.id);
      const pendingFrames = requestFrame.mock.calls.map(
        ([callback]) => callback,
      );

      component.cancelPointerGesture(
        pointerEvent(
          'pointercancel',
          start.x + 90,
          start.y + 40,
          viewport,
          viewport,
          7,
        ),
      );
      for (const pendingFrame of pendingFrames) pendingFrame(0);
      fixture.detectChanges();

      expect(cancelFrame).toHaveBeenCalled();
      expect(component.draggingNodeId()).toBeNull();
      expect(nodePosition(node.id)).toEqual(before);
      expect(workspace.snapshot().size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cleans up a pre-threshold gesture released outside the viewport', async () => {
    await renderReady();
    const viewport = preparePointerViewport();
    const node = nodeByLabel('tenants');
    const header = tableSelectionButton(node.label);
    const start = nodeClientPoint(node, { x: 20, y: 18 }, viewport);
    const before = nodePosition(node.id);

    component.startNodeDrag(
      pointerEvent('pointerdown', start.x, start.y, header, header),
      node,
    );
    dispatchWindowPointer('pointerup', start.x - 40, start.y, 7);

    dragNodeBy(node.label, { x: 45, y: 25 }, viewport);

    expect(nodePosition(node.id)).toEqual({
      x: before.x + 45,
      y: before.y + 25,
    });
  });

  it('does not begin canvas pan while an automatic layout is loading', async () => {
    await renderReady();
    const deferred = createDeferred<LayoutResult>();
    engineImplementation = () => deferred.promise;
    autoArrangeButton().click();
    fixture.detectChanges();

    const viewport = preparePointerViewport();
    const before = { x: component.panX(), y: component.panY() };
    component.startPan(pointerEvent('pointerdown', 120, 100, viewport));
    component.movePan(pointerEvent('pointermove', 180, 145, viewport));
    component.endPan(pointerEvent('pointerup', 180, 145, viewport));

    expect(component.layoutState().status).toBe('loading');
    expect(component.isCanvasPanning()).toBe(false);
    expect(component.panX()).toBe(before.x);
    expect(component.panY()).toBe(before.y);
    expect(viewport.setPointerCapture).not.toHaveBeenCalled();

    await Promise.resolve();
    const request = engine.mock.calls[1]?.[0];
    expect(request).toBeDefined();
    deferred.resolve(elkGridResult(request!));
    await settleLayout();
  });

  it('suppresses the residual click when Convert cancels an active drag', async () => {
    await renderReady();
    const deferred = createDeferred<LayoutResult>();
    engineImplementation = () => deferred.promise;
    const viewport = preparePointerViewport();
    const node = nodeByLabel('users');
    const header = tableSelectionButton(node.label);
    const start = nodeClientPoint(node, { x: 24, y: 18 }, viewport);

    component.startNodeDrag(
      pointerEvent('pointerdown', start.x, start.y, header, header),
      node,
    );
    component.movePan(
      pointerEvent('pointermove', start.x + 70, start.y + 30, viewport),
    );
    expect(component.draggingNodeId()).toBe(node.id);

    state.schema.set({
      tables: [...SCHEMA.tables],
      relations: [...SCHEMA.relations],
    });
    fixture.detectChanges();
    expect(component.draggingNodeId()).toBeNull();

    dispatchWindowPointer('pointerup', start.x + 70, start.y + 30, 7);
    const currentHeader = tableSelectionButton(node.label);
    currentHeader.click();
    fixture.detectChanges();
    expect(component.selection()).toBeNull();

    currentHeader.click();
    fixture.detectChanges();
    expect(component.selection()).toEqual({ kind: 'node', nodeId: node.id });

    await Promise.resolve();
    const request = engine.mock.calls[1]?.[0];
    expect(request).toBeDefined();
    deferred.resolve(elkGridResult(request!));
    await settleLayout();
  });

  it('retains stable manual IDs and prunes removed tables on Convert', async () => {
    await renderReady();
    const users = nodeByLabel('users');
    const tenants = nodeByLabel('tenants');
    const manualUsers = {
      x: users.layout.x + 137,
      y: users.layout.y - 83,
    };
    workspace.setNodePosition(users.id, manualUsers);
    workspace.setNodePosition(tenants.id, {
      x: tenants.layout.x - 180,
      y: tenants.layout.y + 95,
    });

    state.schema.set({
      tables: [SCHEMA.tables[2]!, SECOND_SCHEMA.tables[0]!],
      relations: [],
    });
    fixture.detectChanges();
    await settleLayout();

    const usersAfter = nodeByLabel('users');
    const projectsAfter = nodeByLabel('projects');
    const secondRequest = engine.mock.calls[1]?.[0];
    expect(secondRequest).toBeDefined();
    const automaticProject = elkGridResult(secondRequest!).nodes.find(
      (node) => node.id === projectsAfter.id,
    );

    expect(usersAfter.id).toBe(users.id);
    expect(nodePosition(usersAfter.id)).toEqual(manualUsers);
    expect(automaticProject).toBeDefined();
    expect(nodePosition(projectsAfter.id)).toEqual(automaticProject!.position);
    expect(component.graph().nodes.some((node) => node.id === tenants.id)).toBe(
      false,
    );
    expect(workspace.snapshot().size).toBe(1);
    expect(workspace.snapshot().get(users.id)).toEqual(manualUsers);
    expect(workspace.snapshot().has(tenants.id)).toBe(false);
    expect(workspace.snapshot().has(projectsAfter.id)).toBe(false);
  });

  it('fits only into a measurable viewport and resets pan and zoom explicitly', async () => {
    await renderReady();
    const viewport = fixture.nativeElement.querySelector(
      '[aria-label="Entity relationship diagram canvas"]',
    ) as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 700 },
    });

    component.fitToScreen();

    const graph = component.graph();
    const expectedZoom = Math.min(
      2,
      Math.max(
        0.35,
        Number(
          Math.min(952 / graph.layout.width, 652 / graph.layout.height).toFixed(
            2,
          ),
        ),
      ),
    );
    expect(component.zoom()).toBe(expectedZoom);
    expect(component.panX()).toBe(
      (1000 - graph.layout.width * expectedZoom) / 2,
    );
    expect(component.panY()).toBe(
      (700 - graph.layout.height * expectedZoom) / 2,
    );

    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 0 },
      clientHeight: { configurable: true, value: 0 },
    });
    component.zoom.set(0.8);
    component.panX.set(12);
    component.panY.set(34);

    component.fitToScreen();

    expect(component.zoom()).toBe(0.8);
    expect(component.panX()).toBe(12);
    expect(component.panY()).toBe(34);

    component.resetViewport();

    expect(component.zoom()).toBe(1);
    expect(component.panX()).toBe(0);
    expect(component.panY()).toBe(0);
  });

  it('drops a stale selection when the converted graph changes', async () => {
    await renderReady();
    component.selection.set({
      kind: 'node',
      nodeId: component.graph().nodes[0].id,
    });

    state.schema.set({ tables: [], relations: [] });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.selection()).toBeNull();
  });

  function preparePointerViewport(
    origin: { left?: number; top?: number } = {},
  ): PointerViewport {
    const left = origin.left ?? 0;
    const top = origin.top ?? 0;
    const width = 1200;
    const height = 800;
    const viewport = fixture.nativeElement.querySelector(
      '[aria-label="Entity relationship diagram canvas"]',
    ) as PointerViewport;

    viewport.setPointerCapture = vi.fn();
    viewport.hasPointerCapture = vi.fn(() => true);
    viewport.releasePointerCapture = vi.fn();
    viewport.getBoundingClientRect = vi.fn(
      () =>
        ({
          x: left,
          y: top,
          left,
          top,
          right: left + width,
          bottom: top + height,
          width,
          height,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    return viewport;
  }

  function nodeByLabel(label: string): DiagramNode {
    const node = component
      .graph()
      .nodes.find((candidate) => candidate.label === label);
    if (!node) throw new Error(`Missing diagram node: ${label}`);
    return node;
  }

  function nodePosition(nodeId: string): { x: number; y: number } {
    const node = component
      .graph()
      .nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error(`Missing diagram node ID: ${nodeId}`);
    return { x: node.layout.x, y: node.layout.y };
  }

  function nodeClientPoint(
    node: DiagramNode,
    offset: { x: number; y: number },
    viewport: HTMLDivElement,
  ): { x: number; y: number } {
    const rect = viewport.getBoundingClientRect();
    const graph = component.graph();
    return {
      x:
        rect.left +
        component.panX() +
        (node.layout.x - graph.layout.minX + offset.x) * component.zoom(),
      y:
        rect.top +
        component.panY() +
        (node.layout.y - graph.layout.minY + offset.y) * component.zoom(),
    };
  }

  function graphScreenPosition(node: DiagramNode): { x: number; y: number } {
    const graph = component.graph();
    return {
      x:
        component.panX() +
        (node.layout.x - graph.layout.minX) * component.zoom(),
      y:
        component.panY() +
        (node.layout.y - graph.layout.minY) * component.zoom(),
    };
  }

  function dragNodeBy(
    table: string,
    delta: { x: number; y: number },
    viewport: PointerViewport,
    pointerId = 7,
  ): void {
    const node = nodeByLabel(table);
    const header = tableSelectionButton(table);
    const start = nodeClientPoint(node, { x: 28, y: 18 }, viewport);
    const end = {
      x: start.x + delta.x * component.zoom(),
      y: start.y + delta.y * component.zoom(),
    };

    component.startNodeDrag(
      pointerEvent('pointerdown', start.x, start.y, header, header, pointerId),
      node,
    );
    component.movePan(
      pointerEvent('pointermove', end.x, end.y, viewport, viewport, pointerId),
    );
    component.endPan(
      pointerEvent('pointerup', end.x, end.y, viewport, viewport, pointerId),
    );
    fixture.detectChanges();
  }

  function tableSelectionButton(table: string): HTMLButtonElement {
    const source = sourceButton(`Show source for table ${table}`);
    return source.parentElement!.querySelector('button') as HTMLButtonElement;
  }

  function columnSelectionButton(column: string): HTMLButtonElement {
    const title = fixture.nativeElement.querySelector(
      `button span[title="${column}"]`,
    ) as HTMLElement;
    return title.closest('button') as HTMLButtonElement;
  }

  function columnBadges(column: string): string[] {
    const knownBadges = new Set(['PK', 'FK', 'UQ', 'NN']);
    return Array.from<HTMLElement>(
      columnSelectionButton(column).querySelectorAll('span'),
    )
      .map((item) => item.textContent.trim())
      .filter((item) => knownBadges.has(item));
  }

  function sourceButton(label: string): HTMLButtonElement {
    return fixture.nativeElement.querySelector(
      `button[aria-label="${label}"]`,
    ) as HTMLButtonElement;
  }

  function buttonWithText(text: string): HTMLButtonElement {
    return Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((button) => button.textContent.trim() === text)!;
  }

  function autoArrangeButton(): HTMLButtonElement {
    return Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((button) => button.textContent.trim() === 'Auto arrange')!;
  }

  function publishLayoutState(layoutState: ErLayoutState): void {
    const componentInternals = component as unknown as {
      acceptLayoutState(state: ErLayoutState): void;
    };
    componentInternals.acceptLayoutState(layoutState);
  }
});

function elkGridResult(request: LayoutRequest): LayoutResult {
  return { ...runGridLayout(request), engine: 'elk' };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function pointerEvent(
  type: string,
  clientX: number,
  clientY: number,
  currentTarget: EventTarget,
  target: EventTarget | null = currentTarget,
  pointerId = 7,
): PointerEvent {
  return {
    button: 0,
    isPrimary: true,
    pointerId,
    clientX,
    clientY,
    type,
    target,
    currentTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as PointerEvent;
}

function dispatchPointerEvent(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
  pointerId: number,
): Event {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
    button: { value: 0 },
    isPrimary: { value: true },
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchWindowPointer(
  type: 'pointerup' | 'pointercancel',
  clientX: number,
  clientY: number,
  pointerId: number,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
    button: { value: 0 },
    isPrimary: { value: true },
  });
  window.dispatchEvent(event);
}
