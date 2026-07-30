import { describe, expect, it, vi } from 'vitest';

import {
  createElkLayoutRunner,
  ElkLayoutRunnerError,
} from './elk-layout-runner';
import type { LayoutRequest } from './layout-contracts';

describe('createElkLayoutRunner', () => {
  it('maps app-owned requests into ELK JSON and maps the response back', async () => {
    const layout = vi.fn<(graph: unknown) => Promise<unknown>>(
      async (graph) => {
        expect(graph).toMatchObject({
          id: 'er-layout-17',
          children: [
            expect.objectContaining({ id: 'parent' }),
            expect.objectContaining({ id: 'child' }),
          ],
          edges: [
            {
              id: 'relation',
              sources: ['parent-east'],
              targets: ['child-west'],
            },
          ],
        });
        return rawGraph();
      },
    );
    class TestElk {
      readonly layout = layout;
    }
    const loader = vi.fn(async () => ({ default: { default: TestElk } }));
    const runner = createElkLayoutRunner(loader);

    const result = await runner(request(17));

    expect(result).toMatchObject({
      requestId: 17,
      engine: 'elk',
      nodes: [
        expect.objectContaining({
          id: 'parent',
          position: { x: 48, y: 48 },
        }),
        expect.objectContaining({
          id: 'child',
          position: { x: 488, y: 48 },
        }),
      ],
      edges: [
        expect.objectContaining({
          id: 'relation',
          semantic: request(17).edges[0].semantic,
        }),
      ],
    });
    expect(result.edges[0].sections).toHaveLength(2);
    expect(layout).toHaveBeenCalledTimes(1);
  });

  it('shares one initialization across concurrent calls and reuses the engine', async () => {
    const module = deferred<unknown>();
    let constructorCalls = 0;
    const layout = vi.fn(async () => rawGraph());
    class TestElk {
      constructor() {
        constructorCalls += 1;
      }

      readonly layout = layout;
    }
    const loader = vi.fn(() => module.promise);
    const runner = createElkLayoutRunner(loader);

    const first = runner(request(1));
    const second = runner(request(2));
    await Promise.resolve();
    module.resolve({ default: TestElk });

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { requestId: 1, engine: 'elk' },
      { requestId: 2, engine: 'elk' },
    ]);
    await expect(runner(request(3))).resolves.toMatchObject({ requestId: 3 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(constructorCalls).toBe(1);
    expect(layout).toHaveBeenCalledTimes(3);
  });

  it('clears a failed loader cache so a later request can retry', async () => {
    const loadFailure = new Error('chunk unavailable');
    const layout = vi.fn(async () => rawGraph());
    class TestElk {
      readonly layout = layout;
    }
    const loader = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(loadFailure)
      .mockResolvedValue({ default: TestElk });
    const runner = createElkLayoutRunner(loader);

    await expect(runner(request(1))).rejects.toBe(loadFailure);
    await expect(runner(request(2))).resolves.toMatchObject({
      requestId: 2,
      engine: 'elk',
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(layout).toHaveBeenCalledTimes(1);
  });

  it('keeps a loaded engine cached when an individual layout call fails', async () => {
    const layoutFailure = new Error('graph-specific failure');
    const layout = vi
      .fn<(graph: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(layoutFailure)
      .mockResolvedValue(rawGraph());
    class TestElk {
      readonly layout = layout;
    }
    const loader = vi.fn(async () => ({ default: TestElk }));
    const runner = createElkLayoutRunner(loader);

    await expect(runner(request(1))).rejects.toBe(layoutFailure);
    await expect(runner(request(2))).resolves.toMatchObject({ requestId: 2 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(layout).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid module at the boundary and allows a clean retry', async () => {
    const layout = vi.fn(async () => rawGraph());
    class TestElk {
      readonly layout = layout;
    }
    const loader = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ default: 'not-a-constructor' })
      .mockResolvedValueOnce({ default: TestElk });
    const runner = createElkLayoutRunner(loader);

    await expect(runner(request(1))).rejects.toThrow(ElkLayoutRunnerError);
    await expect(runner(request(2))).resolves.toMatchObject({ requestId: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

function request(requestId: number): LayoutRequest {
  return {
    requestId,
    options: {
      direction: 'right',
      routing: 'orthogonal',
      padding: 48,
      componentSpacing: 80,
      nodeSpacing: 56,
      layerSpacing: 160,
    },
    nodes: [
      {
        id: 'parent',
        width: 280,
        height: 108,
        ports: [
          {
            id: 'parent-east',
            position: { x: 280, y: 60 },
            width: 1,
            height: 1,
            side: 'east',
          },
        ],
      },
      {
        id: 'child',
        width: 280,
        height: 108,
        ports: [
          {
            id: 'child-west',
            position: { x: 0, y: 60 },
            width: 1,
            height: 1,
            side: 'west',
          },
        ],
      },
    ],
    edges: [
      {
        id: 'relation',
        semantic: {
          source: { nodeId: 'child', columnId: 'child-parent-id' },
          target: { nodeId: 'parent', columnId: 'parent-id' },
        },
        layout: {
          source: { nodeId: 'parent', portId: 'parent-east' },
          target: { nodeId: 'child', portId: 'child-west' },
        },
      },
    ],
  };
}

function rawGraph(): unknown {
  return {
    id: 'root',
    children: [
      {
        id: 'child',
        x: 488,
        y: 48,
        width: 280,
        height: 108,
        ports: [{ id: 'child-west', x: -0.5, y: 59.5, width: 1, height: 1 }],
      },
      {
        id: 'parent',
        x: 48,
        y: 48,
        width: 280,
        height: 108,
        ports: [{ id: 'parent-east', x: 279.5, y: 59.5, width: 1, height: 1 }],
      },
    ],
    edges: [
      {
        id: 'relation',
        sections: [
          {
            id: 'first',
            startPoint: { x: 328, y: 108 },
            bendPoints: [{ x: 408, y: 108 }],
            endPoint: { x: 408, y: 80 },
          },
          {
            id: 'second',
            startPoint: { x: 408, y: 80 },
            bendPoints: [{ x: 488, y: 80 }],
            endPoint: { x: 488, y: 108 },
            junctionPoints: [{ x: 408, y: 80 }],
          },
        ],
      },
    ],
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
