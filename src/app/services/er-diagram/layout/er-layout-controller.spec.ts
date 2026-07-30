import { describe, expect, it, vi } from 'vitest';

import {
  ErLayoutController,
  ErLayoutControllerPolicy,
  ErLayoutInput,
  ErLayoutRunner,
  ErLayoutTimeoutFactory,
} from './er-layout-controller';
import {
  LayoutEdgeRequest,
  LayoutRequest,
  LayoutResult,
} from './layout-contracts';

describe('ErLayoutController', () => {
  it('uses monotonically increasing request IDs and commits only the newest result', async () => {
    const pending = new Map<number, Deferred<LayoutResult>>();
    const engine: ErLayoutRunner = (request) => {
      const deferred = createDeferred<LayoutResult>();
      pending.set(request.requestId, deferred);
      return deferred.promise;
    };
    const fallback = vi.fn<ErLayoutRunner>();
    const controller = new ErLayoutController(engine, fallback);

    const first = controller.layout(createInput('first'));
    const second = controller.layout(createInput('second'));

    expect(controller.state).toEqual({ status: 'loading', requestId: 2 });
    pending
      .get(2)
      ?.resolve(createResult(createRequest(createInput('second'), 2)));
    await second;

    expect(controller.state.status).toBe('ready');
    if (controller.state.status === 'ready') {
      expect(controller.state.requestId).toBe(2);
      expect(controller.state.result.nodes[0]?.id).toBe('second');
    }

    pending
      .get(1)
      ?.resolve(createResult(createRequest(createInput('first'), 1)));
    await first;

    expect(controller.state.status).toBe('ready');
    expect(
      controller.state.status === 'ready' && controller.state.requestId,
    ).toBe(2);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('invalidates in-flight work when cleared', async () => {
    const deferred = createDeferred<LayoutResult>();
    const engine: ErLayoutRunner = () => deferred.promise;
    const fallback = vi.fn<ErLayoutRunner>();
    const controller = new ErLayoutController(engine, fallback);
    const input = createInput();

    const pending = controller.layout(input);
    controller.clear();
    expect(controller.state).toEqual({ status: 'idle' });

    deferred.resolve(createResult(createRequest(input, 1)));
    await pending;

    expect(controller.state).toEqual({ status: 'idle' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('isolates subscriber failures from engine and fallback state', async () => {
    const reports = vi.fn();
    const fallback = vi.fn<ErLayoutRunner>();
    const observer = vi.fn();
    const controller = new ErLayoutController(
      (request) => createResult(request),
      fallback,
      { onListenerError: reports },
    );
    controller.subscribe((state) => {
      if (state.status !== 'idle') throw new Error(`listener ${state.status}`);
    });
    controller.subscribe(observer);

    await controller.layout(createInput());

    expect(controller.state.status === 'ready' && controller.state.source).toBe(
      'engine',
    );
    expect(fallback).not.toHaveBeenCalled();
    expect(reports).toHaveBeenCalledTimes(2);
    expect(observer).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'ready', source: 'engine' }),
    );
  });

  it('exposes last-known-good geometry during a compatible rerun and its error state', async () => {
    const input = createInput();
    const rerun = createDeferred<LayoutResult>();
    const engine: ErLayoutRunner = (request) =>
      request.requestId === 1 ? createResult(request) : rerun.promise;
    const controller = new ErLayoutController(engine, () => {
      throw new Error('fallback failed');
    });

    await controller.layout(input);
    const firstResult =
      controller.state.status === 'ready' ? controller.state.result : undefined;
    expect(firstResult?.requestId).toBe(1);

    const pending = controller.layout(input);
    expect(controller.state).toMatchObject({
      status: 'loading',
      requestId: 2,
      lastKnownGood: { requestId: 1 },
    });
    expect(
      controller.state.status === 'loading' && controller.state.lastKnownGood,
    ).toBe(firstResult);

    rerun.reject(new Error('rerun failed'));
    await pending;

    expect(controller.state).toMatchObject({
      status: 'error',
      requestId: 2,
      lastKnownGood: { requestId: 1 },
    });
    expect(
      controller.state.status === 'error' && controller.state.lastKnownGood,
    ).toBe(firstResult);
  });

  it('does not expose previous geometry for an incompatible request', async () => {
    const rerun = createDeferred<LayoutResult>();
    const engine: ErLayoutRunner = (request) =>
      request.requestId === 1 ? createResult(request) : rerun.promise;
    const controller = new ErLayoutController(engine, () => {
      throw new Error('fallback failed');
    });

    await controller.layout(createInput());
    const pending = controller.layout({
      ...createInput(),
      nodes: [{ id: 'table', width: 21, height: 10, ports: [] }],
    });

    expect(controller.state.status).toBe('loading');
    expect(
      controller.state.status === 'loading' &&
        'lastKnownGood' in controller.state,
    ).toBe(false);

    rerun.reject(new Error('rerun failed'));
    await pending;
    expect(controller.state.status).toBe('error');
    expect(
      controller.state.status === 'error' &&
        'lastKnownGood' in controller.state,
    ).toBe(false);
  });

  it('discards last-known-good geometry on clear', async () => {
    const afterClear = createDeferred<LayoutResult>();
    const input = createInput();
    const engine: ErLayoutRunner = (request) =>
      request.requestId === 1 ? createResult(request) : afterClear.promise;
    const controller = new ErLayoutController(engine, vi.fn<ErLayoutRunner>());

    await controller.layout(input);
    controller.clear();
    const pending = controller.layout(input);

    expect(controller.state.status).toBe('loading');
    expect(
      controller.state.status === 'loading' &&
        'lastKnownGood' in controller.state,
    ).toBe(false);

    afterClear.resolve(createResult(createRequest(input, 3)));
    await pending;
  });

  it('uses a clean fallback for the current request and exposes a nonblocking warning', async () => {
    const input = createInput();
    const engine = vi.fn<ErLayoutRunner>((request) => {
      (request.nodes as unknown as { id: string }[])[0].id =
        'mutated-by-engine';
      throw new Error('ELK chunk failed to load');
    });
    const fallback = vi.fn<ErLayoutRunner>((request) =>
      createResult(request, 'fallback'),
    );
    const controller = new ErLayoutController(engine, fallback);

    await controller.layout(input);

    expect(controller.state.status).toBe('ready');
    if (controller.state.status === 'ready') {
      expect(controller.state.source).toBe('fallback');
      expect(controller.state.result.nodes[0]?.id).toBe('table');
      expect(controller.state.warning?.code).toBe('layout-engine-fallback');
      expect(controller.state.result.diagnostics[0]).toEqual(
        controller.state.warning,
      );
    }
    expect(fallback.mock.calls[0]?.[0].nodes[0]?.id).toBe('table');
  });

  it('skips the engine at configured node or edge limits and explains the fallback', async () => {
    const nodeEngine = vi.fn<ErLayoutRunner>();
    const nodeFallback = vi.fn<ErLayoutRunner>((request) =>
      createResult(request, 'fallback'),
    );
    const nodeController = new ErLayoutController(nodeEngine, nodeFallback, {
      maxEngineNodes: 0,
    });

    await nodeController.layout(createInput());
    expect(nodeEngine).not.toHaveBeenCalled();
    expect(
      nodeController.state.status === 'ready' &&
        nodeController.state.warning?.code,
    ).toBe('layout-engine-capacity-fallback');
    expect(
      nodeController.state.status === 'ready' &&
        nodeController.state.warning?.message,
    ).toContain('1 nodes exceeds the 0 node limit');

    const edgeEngine = vi.fn<ErLayoutRunner>();
    const edgeFallback = vi.fn<ErLayoutRunner>((request) =>
      createResult(request, 'fallback'),
    );
    const edgeController = new ErLayoutController(edgeEngine, edgeFallback, {
      maxEngineEdges: 0,
    });

    await edgeController.layout(createInputWithEdge(createEdge()));
    expect(edgeEngine).not.toHaveBeenCalled();
    expect(
      edgeController.state.status === 'ready' &&
        edgeController.state.warning?.message,
    ).toContain('1 edges exceeds the 0 edge limit');
  });

  it('uses an injected timeout deterministically and cancels its handle', async () => {
    const elapsed = createDeferred<void>();
    const cancel = vi.fn();
    const timeoutFactory = vi.fn<ErLayoutTimeoutFactory>(() => ({
      elapsed: elapsed.promise,
      cancel,
    }));
    const engineResult = createDeferred<LayoutResult>();
    const engine = vi.fn<ErLayoutRunner>(() => engineResult.promise);
    const fallback = vi.fn<ErLayoutRunner>((request) =>
      createResult(request, 'fallback'),
    );
    const controller = new ErLayoutController(engine, fallback, {
      engineTimeoutMs: 25,
      timeoutFactory,
    });

    const pending = controller.layout(createInput());
    expect(controller.state).toEqual({ status: 'loading', requestId: 1 });
    expect(timeoutFactory).toHaveBeenCalledWith(25);

    elapsed.resolve();
    await pending;

    expect(controller.state.status === 'ready' && controller.state.source).toBe(
      'fallback',
    );
    expect(
      controller.state.status === 'ready' && controller.state.warning?.code,
    ).toBe('layout-engine-timeout');
    expect(cancel).toHaveBeenCalledOnce();
    expect(engine).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('keeps safeguards disabled by default and rejects invalid policy values', async () => {
    const engine = vi.fn<ErLayoutRunner>((request) => createResult(request));
    const controller = new ErLayoutController(engine, vi.fn<ErLayoutRunner>());

    await controller.layout(createInput());
    expect(engine).toHaveBeenCalledOnce();

    const invalidPolicies: ErLayoutControllerPolicy[] = [
      { engineTimeoutMs: 0 },
      { engineTimeoutMs: Number.POSITIVE_INFINITY },
      { maxEngineNodes: -1 },
      { maxEngineEdges: 1.5 },
    ];
    for (const policy of invalidPolicies) {
      expect(
        () =>
          new ErLayoutController(
            vi.fn<ErLayoutRunner>(),
            vi.fn<ErLayoutRunner>(),
            policy,
          ),
      ).toThrow(RangeError);
    }
  });

  it('falls back when engine node geometry or request ID is invalid', async () => {
    const fallback = vi.fn<ErLayoutRunner>((request) =>
      createResult(request, 'fallback'),
    );
    const invalidPositionEngine: ErLayoutRunner = (request) => ({
      ...createResult(request),
      nodes: [
        {
          ...createResult(request).nodes[0],
          position: { x: Number.NaN, y: 0 },
        },
      ],
    });
    const controller = new ErLayoutController(invalidPositionEngine, fallback);

    await controller.layout(createInput());
    expect(controller.state.status === 'ready' && controller.state.source).toBe(
      'fallback',
    );

    const staleIdController = new ErLayoutController(
      (request) => ({
        ...createResult(request),
        requestId: request.requestId + 1,
      }),
      fallback,
    );
    await staleIdController.layout(createInput());
    expect(
      staleIdController.state.status === 'ready' &&
        staleIdController.state.source,
    ).toBe('fallback');
  });

  it('accepts negative finite coordinates and coherent negative bounds', async () => {
    const fallback = vi.fn<ErLayoutRunner>();
    const controller = new ErLayoutController(
      (request) => ({
        ...createResult(request),
        nodes: [
          {
            ...createResult(request).nodes[0],
            position: { x: -20, y: -10 },
          },
        ],
        bounds: {
          minX: -30,
          minY: -20,
          maxX: 10,
          maxY: 10,
          width: 40,
          height: 30,
        },
      }),
      fallback,
    );

    await controller.layout(createInput());

    expect(controller.state.status === 'ready' && controller.state.source).toBe(
      'engine',
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back when the engine returns a zero-sized node', async () => {
    const fallback = vi.fn<ErLayoutRunner>((request) =>
      createResult(request, 'fallback'),
    );
    const controller = new ErLayoutController(
      (request) => ({
        ...createResult(request),
        nodes: [
          {
            ...createResult(request).nodes[0],
            width: 0,
          },
        ],
      }),
      fallback,
    );

    await controller.layout(createInput());

    expect(controller.state.status === 'ready' && controller.state.source).toBe(
      'fallback',
    );
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('drops only a malformed routed edge and keeps otherwise valid engine geometry', async () => {
    const edge = createEdge();
    const input = createInputWithEdge(edge);
    const fallback = vi.fn<ErLayoutRunner>();
    const controller = new ErLayoutController(
      (request) => ({
        ...createResult(request),
        edges: [
          {
            ...edge,
            sections: [
              {
                startPoint: { x: Number.POSITIVE_INFINITY, y: 0 },
                endPoint: { x: 30, y: 0 },
              },
            ],
          },
        ],
      }),
      fallback,
    );

    await controller.layout(input);

    expect(controller.state.status === 'ready' && controller.state.source).toBe(
      'engine',
    );
    if (controller.state.status === 'ready') {
      expect(controller.state.result.edges).toEqual([]);
      expect(
        controller.state.result.diagnostics.map(
          (diagnostic) => diagnostic.code,
        ),
      ).toEqual(
        expect.arrayContaining(['layout-edge-dropped', 'layout-edge-missing']),
      );
    }
    expect(fallback).not.toHaveBeenCalled();
  });

  it('enters an error state only when both engine and fallback are unusable', async () => {
    const controller = new ErLayoutController(
      () => {
        throw new Error('engine failed');
      },
      () => {
        throw new Error('fallback failed');
      },
    );

    await controller.layout(createInput());

    expect(controller.state.status).toBe('error');
    if (controller.state.status === 'error') {
      expect(controller.state.diagnostic.code).toBe('layout-unavailable');
      expect(controller.state.diagnostic.message).toContain('engine failed');
      expect(controller.state.diagnostic.message).toContain('fallback failed');
      expect(controller.state.causes).toHaveLength(2);
    }
  });

  it('handles an empty graph without invoking either runner', async () => {
    const engine = vi.fn<ErLayoutRunner>();
    const fallback = vi.fn<ErLayoutRunner>();
    const controller = new ErLayoutController(engine, fallback);

    await controller.layout({
      nodes: [],
      edges: [],
      options: createInput().options,
    });

    expect(controller.state).toMatchObject({
      status: 'ready',
      requestId: 1,
      source: 'empty',
      result: {
        requestId: 1,
        nodes: [],
        edges: [],
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      },
    });
    expect(engine).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });
});

function createInput(nodeId = 'table'): ErLayoutInput {
  return {
    nodes: [
      {
        id: nodeId,
        width: 20,
        height: 10,
        ports: [],
      },
    ],
    edges: [],
    options: {
      direction: 'right',
      routing: 'orthogonal',
      padding: 0,
      componentSpacing: 80,
      nodeSpacing: 50,
      layerSpacing: 120,
    },
  };
}

function createInputWithEdge(edge: LayoutEdgeRequest): ErLayoutInput {
  return {
    ...createInput('source'),
    nodes: [
      { id: 'source', width: 20, height: 10, ports: [] },
      { id: 'target', width: 20, height: 10, ports: [] },
    ],
    edges: [edge],
  };
}

function createEdge(): LayoutEdgeRequest {
  return {
    id: 'edge',
    semantic: {
      source: { nodeId: 'source', columnId: 'source-column' },
      target: { nodeId: 'target', columnId: 'target-column' },
    },
    layout: {
      source: { nodeId: 'source' },
      target: { nodeId: 'target' },
    },
  };
}

function createRequest(input: ErLayoutInput, requestId: number): LayoutRequest {
  return { ...input, requestId };
}

function createResult(
  request: LayoutRequest,
  engine: LayoutResult['engine'] = 'elk',
): LayoutResult {
  const nodes = request.nodes.map((node, index) => ({
    id: node.id,
    position: { x: index * 30, y: 0 },
    width: node.width,
    height: node.height,
    ports: node.ports.map((port) => ({
      id: port.id,
      position: { x: port.position.x + index * 30, y: port.position.y },
      width: port.width,
      height: port.height,
      side: port.side,
    })),
  }));
  const maxX = nodes.reduce(
    (maximum, node) => Math.max(maximum, node.position.x + node.width),
    0,
  );
  const maxY = nodes.reduce(
    (maximum, node) => Math.max(maximum, node.position.y + node.height),
    0,
  );

  return {
    requestId: request.requestId,
    engine,
    nodes,
    edges: request.edges.map((edge) => ({
      ...edge,
      sections: [
        {
          startPoint: { x: 20, y: 5 },
          endPoint: { x: 30, y: 5 },
        },
      ],
    })),
    bounds: {
      minX: 0,
      minY: 0,
      maxX,
      maxY,
      width: maxX,
      height: maxY,
    },
    diagnostics: [],
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
