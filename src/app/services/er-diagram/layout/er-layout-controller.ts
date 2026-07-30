import {
  isFiniteLayoutPoint,
  LayoutBounds,
  LayoutDiagnostic,
  LayoutEdgeRequest,
  LayoutEdgeRoute,
  LayoutEdgeSection,
  LayoutNodePlacement,
  LayoutNodeRequest,
  LayoutPortPlacement,
  LayoutRequest,
  LayoutResult,
} from './layout-contracts';
import { normalizeRoutedEdgeSections } from './route-normalizer';

export type ErLayoutInput = Omit<LayoutRequest, 'requestId'>;

export type ErLayoutRunner = (
  request: LayoutRequest,
) => LayoutResult | Promise<LayoutResult>;

export interface ErLayoutTimeoutHandle {
  readonly elapsed: Promise<void>;
  cancel(): void;
}

export type ErLayoutTimeoutFactory = (
  milliseconds: number,
) => ErLayoutTimeoutHandle;

/**
 * Optional safeguards. Every undefined limit is disabled, preserving the
 * original behavior of always awaiting the primary engine.
 */
export interface ErLayoutControllerPolicy {
  /** Positive finite duration. Undefined means that the engine has no timeout. */
  readonly engineTimeoutMs?: number;
  /** Non-negative integer. The engine is skipped when node count is greater. */
  readonly maxEngineNodes?: number;
  /** Non-negative integer. The engine is skipped when edge count is greater. */
  readonly maxEngineEdges?: number;
  /** Injectable only to make timeout scheduling deterministic and cancelable. */
  readonly timeoutFactory?: ErLayoutTimeoutFactory;
  /** Receives subscriber failures without allowing them to alter layout state. */
  readonly onListenerError?: (error: unknown) => void;
}

export interface ErLayoutIdleState {
  readonly status: 'idle';
}

export interface ErLayoutLoadingState {
  readonly status: 'loading';
  readonly requestId: number;
  /**
   * Previous geometry is exposed only for an exactly matching layout request.
   * It retains its original request ID so its provenance remains explicit.
   */
  readonly lastKnownGood?: LayoutResult;
}

export interface ErLayoutReadyState {
  readonly status: 'ready';
  readonly requestId: number;
  readonly source: 'engine' | 'fallback' | 'empty';
  readonly result: LayoutResult;
  /** Present when a usable fallback replaced an unusable engine result. */
  readonly warning?: LayoutDiagnostic;
}

export interface ErLayoutErrorState {
  readonly status: 'error';
  readonly requestId: number;
  readonly diagnostic: LayoutDiagnostic;
  /** Retained for logging/debugging; rendering code should use `diagnostic`. */
  readonly causes: readonly unknown[];
  /** Safe-to-render geometry for the same exact request, when available. */
  readonly lastKnownGood?: LayoutResult;
}

export type ErLayoutState =
  | ErLayoutIdleState
  | ErLayoutLoadingState
  | ErLayoutReadyState
  | ErLayoutErrorState;

export type ErLayoutStateListener = (state: ErLayoutState) => void;

interface UsableResult {
  readonly usable: true;
  readonly result: LayoutResult;
}

interface UnusableResult {
  readonly usable: false;
  readonly reason: string;
}

type ResultValidation = UsableResult | UnusableResult;

interface LastKnownGood {
  readonly fingerprint: string;
  readonly result: LayoutResult;
}

const IDLE_STATE: ErLayoutIdleState = { status: 'idle' };
const BOUNDS_EPSILON = 0.000_001;
const PORT_SIDES = new Set(['north', 'east', 'south', 'west']);

/**
 * Coordinates asynchronous layout work without depending on Angular or a
 * particular graph engine. A monotonically increasing request ID implements
 * latest-request-wins semantics, including when `clear()` is called.
 */
export class ErLayoutController {
  private currentState: ErLayoutState = IDLE_STATE;
  private sequence = 0;
  private lastKnownGood: LastKnownGood | null = null;
  private readonly listeners = new Set<ErLayoutStateListener>();
  private readonly policy: ErLayoutControllerPolicy;

  constructor(
    private readonly engineRunner: ErLayoutRunner,
    private readonly fallbackRunner: ErLayoutRunner,
    policy: ErLayoutControllerPolicy = {},
  ) {
    validatePolicy(policy);
    this.policy = { ...policy };
  }

  get state(): ErLayoutState {
    return this.currentState;
  }

  subscribe(listener: ErLayoutStateListener): () => void {
    this.listeners.add(listener);
    this.notifyListener(listener, this.currentState);
    return () => this.listeners.delete(listener);
  }

  /** Invalidates in-flight work before returning to the deterministic idle state. */
  clear(): void {
    this.sequence += 1;
    this.lastKnownGood = null;
    this.commit(IDLE_STATE);
  }

  async layout(input: ErLayoutInput): Promise<ErLayoutState> {
    const requestId = ++this.sequence;
    const request = materializeRequest(input, requestId);
    const fingerprint = fingerprintRequest(request);
    const compatibleLastKnownGood =
      this.getCompatibleLastKnownGood(fingerprint);
    this.commit({
      status: 'loading',
      requestId,
      ...(compatibleLastKnownGood
        ? { lastKnownGood: compatibleLastKnownGood }
        : {}),
    });

    if (request.nodes.length === 0 && request.edges.length === 0) {
      const result = createEmptyResult(requestId);
      const ready: ErLayoutReadyState = {
        status: 'ready',
        requestId,
        source: 'empty',
        result,
      };
      this.commitReadyIfCurrent(requestId, fingerprint, ready);
      return this.currentState;
    }

    let engineFailure: unknown;
    let warning = engineCapacityWarning(request, this.policy);

    if (warning) {
      engineFailure = new Error(warning.message);
    } else {
      try {
        const candidate = await this.runEngine(request);
        if (!this.isCurrent(requestId)) {
          return this.currentState;
        }

        const validation = validateAndSanitizeResult(candidate, request, 'elk');
        if (validation.usable) {
          const ready: ErLayoutReadyState = {
            status: 'ready',
            requestId,
            source: 'engine',
            result: validation.result,
          };
          this.commitReadyIfCurrent(requestId, fingerprint, ready);
          return this.currentState;
        }

        engineFailure = new Error(validation.reason);
      } catch (error) {
        engineFailure = error;
        if (error instanceof EngineTimeoutError) {
          warning = {
            code: 'layout-engine-timeout',
            message: `Automatic layout exceeded the configured ${error.milliseconds} ms timeout; the fallback layout was used.`,
          };
        }
      }
    }

    if (!this.isCurrent(requestId)) {
      return this.currentState;
    }

    warning ??= {
      code: 'layout-engine-fallback',
      message: `Automatic layout was unavailable; the fallback layout was used. ${failureMessage(engineFailure)}`,
    };

    try {
      const candidate = await this.fallbackRunner(cloneRequest(request));
      if (!this.isCurrent(requestId)) {
        return this.currentState;
      }

      const validation = validateAndSanitizeResult(
        candidate,
        request,
        'fallback',
      );
      if (!validation.usable) {
        throw new Error(validation.reason);
      }

      const result: LayoutResult = {
        ...validation.result,
        diagnostics: [warning, ...validation.result.diagnostics],
      };
      const ready: ErLayoutReadyState = {
        status: 'ready',
        requestId,
        source: 'fallback',
        result,
        warning,
      };
      this.commitReadyIfCurrent(requestId, fingerprint, ready);
      return this.currentState;
    } catch (fallbackFailure) {
      if (!this.isCurrent(requestId)) {
        return this.currentState;
      }

      const diagnostic: LayoutDiagnostic = {
        code: 'layout-unavailable',
        message: `Neither automatic nor fallback layout could produce usable geometry. Engine: ${failureMessage(engineFailure)} Fallback: ${failureMessage(fallbackFailure)}`,
      };
      const errorState: ErLayoutErrorState = {
        status: 'error',
        requestId,
        diagnostic,
        causes: [engineFailure, fallbackFailure],
        ...(compatibleLastKnownGood
          ? { lastKnownGood: compatibleLastKnownGood }
          : {}),
      };
      this.commitIfCurrent(requestId, errorState);
      return this.currentState;
    }
  }

  private isCurrent(requestId: number): boolean {
    return requestId === this.sequence;
  }

  private getCompatibleLastKnownGood(
    fingerprint: string,
  ): LayoutResult | undefined {
    return this.lastKnownGood?.fingerprint === fingerprint
      ? this.lastKnownGood.result
      : undefined;
  }

  private async runEngine(request: LayoutRequest): Promise<LayoutResult> {
    const milliseconds = this.policy.engineTimeoutMs;
    if (milliseconds === undefined) {
      return this.engineRunner(cloneRequest(request));
    }

    const timeout = (this.policy.timeoutFactory ?? createTimeout)(milliseconds);
    const engine = Promise.resolve().then(() =>
      this.engineRunner(cloneRequest(request)),
    );

    try {
      const outcome = await Promise.race([
        engine.then((result) => ({ kind: 'result' as const, result })),
        timeout.elapsed.then(() => ({ kind: 'timeout' as const })),
      ]);
      if (outcome.kind === 'timeout') {
        throw new EngineTimeoutError(milliseconds);
      }
      return outcome.result;
    } finally {
      timeout.cancel();
    }
  }

  private commitReadyIfCurrent(
    requestId: number,
    fingerprint: string,
    state: ErLayoutReadyState,
  ): void {
    if (this.isCurrent(requestId)) {
      this.lastKnownGood = { fingerprint, result: state.result };
      this.commit(state);
    }
  }

  private commitIfCurrent(requestId: number, state: ErLayoutState): void {
    if (this.isCurrent(requestId)) {
      this.commit(state);
    }
  }

  private commit(state: ErLayoutState): void {
    this.currentState = state;
    for (const listener of [...this.listeners]) {
      this.notifyListener(listener, state);
    }
  }

  private notifyListener(
    listener: ErLayoutStateListener,
    state: ErLayoutState,
  ): void {
    try {
      listener(state);
    } catch (error) {
      try {
        (this.policy.onListenerError ?? reportListenerError)(error);
      } catch {
        // Reporting must never turn an observer failure into a layout failure.
      }
    }
  }
}

class EngineTimeoutError extends Error {
  constructor(readonly milliseconds: number) {
    super(`The layout engine timed out after ${milliseconds} ms.`);
    this.name = 'EngineTimeoutError';
  }
}

function validatePolicy(policy: ErLayoutControllerPolicy): void {
  if (
    policy.engineTimeoutMs !== undefined &&
    (!Number.isFinite(policy.engineTimeoutMs) || policy.engineTimeoutMs <= 0)
  ) {
    throw new RangeError('engineTimeoutMs must be a positive finite number.');
  }

  validateCountLimit('maxEngineNodes', policy.maxEngineNodes);
  validateCountLimit('maxEngineEdges', policy.maxEngineEdges);
  if (
    policy.onListenerError !== undefined &&
    typeof policy.onListenerError !== 'function'
  ) {
    throw new TypeError('onListenerError must be a function.');
  }
}

function reportListenerError(error: unknown): void {
  const host = globalThis as typeof globalThis & {
    reportError?: (value: unknown) => void;
  };
  if (typeof host.reportError === 'function') {
    host.reportError(error);
    return;
  }
  console.error('ER layout state listener failed.', error);
}

function validateCountLimit(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
}

function engineCapacityWarning(
  request: LayoutRequest,
  policy: ErLayoutControllerPolicy,
): LayoutDiagnostic | null {
  const exceeded: string[] = [];
  if (
    policy.maxEngineNodes !== undefined &&
    request.nodes.length > policy.maxEngineNodes
  ) {
    exceeded.push(
      `${request.nodes.length} nodes exceeds the ${policy.maxEngineNodes} node limit`,
    );
  }
  if (
    policy.maxEngineEdges !== undefined &&
    request.edges.length > policy.maxEngineEdges
  ) {
    exceeded.push(
      `${request.edges.length} edges exceeds the ${policy.maxEngineEdges} edge limit`,
    );
  }

  if (exceeded.length === 0) {
    return null;
  }

  return {
    code: 'layout-engine-capacity-fallback',
    message: `Automatic layout was skipped because ${exceeded.join(' and ')}; the fallback layout was used.`,
  };
}

function createTimeout(milliseconds: number): ErLayoutTimeoutHandle {
  let timer: ReturnType<typeof setTimeout>;
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, milliseconds);
  });

  return {
    elapsed,
    cancel: () => clearTimeout(timer),
  };
}

/**
 * Exact compatibility intentionally includes order because model order may
 * influence deterministic layout. The request ID is the only excluded field.
 */
function fingerprintRequest(request: LayoutRequest): string {
  return JSON.stringify({
    nodes: request.nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
      position: node.position ? [node.position.x, node.position.y] : null,
      positionMode: node.positionMode ?? null,
      ports: node.ports.map((port) => ({
        id: port.id,
        width: port.width,
        height: port.height,
        position: [port.position.x, port.position.y],
        side: port.side,
      })),
    })),
    edges: request.edges.map((edge) => ({
      id: edge.id,
      semantic: {
        source: [
          edge.semantic.source.nodeId,
          edge.semantic.source.columnId ?? null,
        ],
        target: [
          edge.semantic.target.nodeId,
          edge.semantic.target.columnId ?? null,
        ],
      },
      layout: {
        source: [edge.layout.source.nodeId, edge.layout.source.portId ?? null],
        target: [edge.layout.target.nodeId, edge.layout.target.portId ?? null],
      },
    })),
    options: {
      direction: request.options.direction,
      routing: request.options.routing,
      padding: request.options.padding,
      componentSpacing: request.options.componentSpacing,
      nodeSpacing: request.options.nodeSpacing,
      layerSpacing: request.options.layerSpacing,
    },
  });
}

function createEmptyResult(requestId: number): LayoutResult {
  return {
    requestId,
    engine: 'fallback',
    nodes: [],
    edges: [],
    bounds: {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    },
    diagnostics: [],
  };
}

function validateAndSanitizeResult(
  value: unknown,
  request: LayoutRequest,
  expectedEngine: LayoutResult['engine'],
): ResultValidation {
  if (!isRecord(value)) {
    return unusable('The layout result is not an object.');
  }
  if (value['requestId'] !== request.requestId) {
    return unusable('The layout result has a stale or invalid request ID.');
  }
  if (value['engine'] !== expectedEngine) {
    return unusable(
      `The layout result did not identify the ${expectedEngine} runner.`,
    );
  }

  const bounds = readBounds(value['bounds']);
  if (!bounds) {
    return unusable('The layout result contains invalid bounds.');
  }

  const nodes = readNodes(value['nodes'], request.nodes, bounds);
  if (!nodes) {
    return unusable(
      'The layout result contains invalid or incomplete node geometry.',
    );
  }

  const diagnostics = readDiagnostics(value['diagnostics']);
  const edgeResult = readEdges(value['edges'], request.edges);

  return {
    usable: true,
    result: {
      requestId: request.requestId,
      engine: expectedEngine,
      nodes,
      edges: edgeResult.edges,
      bounds,
      diagnostics: [...diagnostics, ...edgeResult.diagnostics],
    },
  };
}

function readBounds(value: unknown): LayoutBounds | null {
  if (!isRecord(value)) {
    return null;
  }

  const minX = value['minX'];
  const minY = value['minY'];
  const maxX = value['maxX'];
  const maxY = value['maxY'];
  const width = value['width'];
  const height = value['height'];
  if (
    !isFiniteNumber(minX) ||
    !isFiniteNumber(minY) ||
    !isFiniteNumber(maxX) ||
    !isFiniteNumber(maxY) ||
    !isFiniteDimension(width) ||
    !isFiniteDimension(height) ||
    maxX < minX ||
    maxY < minY ||
    width + BOUNDS_EPSILON < maxX - minX ||
    height + BOUNDS_EPSILON < maxY - minY
  ) {
    return null;
  }

  return { minX, minY, maxX, maxY, width, height };
}

function readNodes(
  value: unknown,
  requestedNodes: readonly LayoutNodeRequest[],
  bounds: LayoutBounds,
): LayoutNodePlacement[] | null {
  if (!Array.isArray(value) || value.length !== requestedNodes.length) {
    return null;
  }

  const requestedById = new Map(requestedNodes.map((node) => [node.id, node]));
  const placementsById = new Map<string, LayoutNodePlacement>();

  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate['id'] !== 'string') {
      return null;
    }

    const id = candidate['id'];
    const requested = requestedById.get(id);
    if (!requested || placementsById.has(id)) {
      return null;
    }

    const position = candidate['position'];
    const width = candidate['width'];
    const height = candidate['height'];
    if (
      !isFiniteLayoutPoint(position) ||
      !isFinitePositiveDimension(width) ||
      !isFinitePositiveDimension(height) ||
      !isInsideBounds(position.x, position.y, width, height, bounds)
    ) {
      return null;
    }

    const ports = readPorts(candidate['ports'], requested);
    if (!ports) {
      return null;
    }

    placementsById.set(id, {
      id,
      position: { x: position.x, y: position.y },
      width,
      height,
      ports,
    });
  }

  return requestedNodes.map(
    (node) => placementsById.get(node.id) as LayoutNodePlacement,
  );
}

function readPorts(
  value: unknown,
  requestedNode: LayoutNodeRequest,
): LayoutPortPlacement[] | null {
  if (!Array.isArray(value) || value.length !== requestedNode.ports.length) {
    return null;
  }

  const requestedIds = new Set(requestedNode.ports.map((port) => port.id));
  const placements = new Map<string, LayoutPortPlacement>();

  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate['id'] !== 'string' ||
      !requestedIds.has(candidate['id']) ||
      placements.has(candidate['id']) ||
      !isFiniteLayoutPoint(candidate['position']) ||
      !isFiniteDimension(candidate['width']) ||
      !isFiniteDimension(candidate['height']) ||
      typeof candidate['side'] !== 'string' ||
      !PORT_SIDES.has(candidate['side'])
    ) {
      return null;
    }

    const position = candidate['position'];
    placements.set(candidate['id'], {
      id: candidate['id'],
      position: { x: position.x, y: position.y },
      width: candidate['width'],
      height: candidate['height'],
      side: candidate['side'] as LayoutPortPlacement['side'],
    });
  }

  return requestedNode.ports.map(
    (port) => placements.get(port.id) as LayoutPortPlacement,
  );
}

function readEdges(
  value: unknown,
  requestedEdges: readonly LayoutEdgeRequest[],
): {
  edges: LayoutEdgeRoute[];
  diagnostics: LayoutDiagnostic[];
} {
  const requestedById = new Map(requestedEdges.map((edge) => [edge.id, edge]));
  const routesById = new Map<string, LayoutEdgeRoute>();
  const diagnostics: LayoutDiagnostic[] = [];
  const candidates = Array.isArray(value) ? value : [];

  for (const candidate of candidates) {
    if (!isRecord(candidate) || typeof candidate['id'] !== 'string') {
      diagnostics.push({
        code: 'layout-edge-dropped',
        message: 'A routed edge without a valid ID was ignored.',
      });
      continue;
    }

    const id = candidate['id'];
    const requested = requestedById.get(id);
    if (!requested || routesById.has(id)) {
      diagnostics.push({
        code: requested ? 'layout-edge-duplicate' : 'layout-edge-unknown',
        message: requested
          ? `Duplicate route for edge ${id} was ignored.`
          : `Unknown routed edge ${id} was ignored.`,
        edgeId: id,
      });
      continue;
    }

    const normalized = normalizeRoutedEdgeSections(candidate['sections']);
    if (normalized.status === 'rejected') {
      diagnostics.push({
        code: 'layout-edge-dropped',
        message: `Edge ${id} did not contain usable routed geometry and was ignored.`,
        edgeId: id,
      });
      continue;
    }

    const sections: LayoutEdgeSection[] = normalized.sections.map(
      (section) => ({
        id: section.id,
        startPoint: section.startPoint,
        endPoint: section.endPoint,
        bendPoints: section.bendPoints,
        junctionPoints: section.junctionPoints,
      }),
    );
    routesById.set(id, { ...requested, sections });

    for (const issue of normalized.issues) {
      diagnostics.push({
        code: `layout-edge-${issue.code}`,
        message: issue.message,
        edgeId: id,
      });
    }
  }

  for (const requested of requestedEdges) {
    if (!routesById.has(requested.id)) {
      diagnostics.push({
        code: 'layout-edge-missing',
        message: `No usable route was produced for edge ${requested.id}.`,
        edgeId: requested.id,
      });
    }
  }

  return {
    edges: requestedEdges.flatMap((edge) => {
      const route = routesById.get(edge.id);
      return route ? [route] : [];
    }),
    diagnostics,
  };
}

function readDiagnostics(value: unknown): LayoutDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate['code'] !== 'string' ||
      typeof candidate['message'] !== 'string'
    ) {
      return [];
    }

    const diagnostic: LayoutDiagnostic = {
      code: candidate['code'],
      message: candidate['message'],
    };
    if (typeof candidate['edgeId'] === 'string') {
      return [{ ...diagnostic, edgeId: candidate['edgeId'] }];
    }
    return [diagnostic];
  });
}

function isInsideBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: LayoutBounds,
): boolean {
  return (
    x + BOUNDS_EPSILON >= bounds.minX &&
    y + BOUNDS_EPSILON >= bounds.minY &&
    x + width <= bounds.maxX + BOUNDS_EPSILON &&
    y + height <= bounds.maxY + BOUNDS_EPSILON
  );
}

function materializeRequest(
  input: ErLayoutInput,
  requestId: number,
): LayoutRequest {
  return cloneRequest({ ...input, requestId });
}

function cloneRequest(request: LayoutRequest): LayoutRequest {
  return {
    requestId: request.requestId,
    options: { ...request.options },
    nodes: request.nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
      position: node.position ? { ...node.position } : undefined,
      positionMode: node.positionMode,
      ports: node.ports.map((port) => ({
        id: port.id,
        width: port.width,
        height: port.height,
        side: port.side,
        position: { ...port.position },
      })),
    })),
    edges: request.edges.map((edge) => ({
      id: edge.id,
      semantic: {
        source: { ...edge.semantic.source },
        target: { ...edge.semantic.target },
      },
      layout: {
        source: { ...edge.layout.source },
        target: { ...edge.layout.target },
      },
    })),
  };
}

function unusable(reason: string): UnusableResult {
  return { usable: false, reason };
}

function failureMessage(value: unknown): string {
  if (value instanceof Error && value.message.trim()) {
    return value.message;
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return 'Unknown layout failure.';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteDimension(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isFinitePositiveDimension(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
