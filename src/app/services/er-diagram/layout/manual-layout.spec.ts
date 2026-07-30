import { describe, expect, it } from 'vitest';

import { runGridLayout } from './grid-layout-runner';
import {
  LayoutEdgeRequest,
  LayoutPoint,
  LayoutRequest,
  LayoutResult,
} from './layout-contracts';
import {
  applyManualNodePositions,
  moveNodeInLayout,
  retainManualNodePositions,
} from './manual-layout';

describe('retainManualNodePositions', () => {
  it('prunes missing and non-finite entries, clones points, and follows node order', () => {
    const first = { x: -15, y: 20 };
    const positions = new Map<string, LayoutPoint>([
      ['removed', { x: 999, y: 999 }],
      ['first', first],
      ['invalid', { x: Number.NaN, y: 4 }],
      ['second', { x: 30, y: 40 }],
    ]);

    const retained = retainManualNodePositions(positions, [
      'second',
      'invalid',
      'first',
      'second',
      'missing',
    ]);

    expect([...retained]).toEqual([
      ['second', { x: 30, y: 40 }],
      ['first', { x: -15, y: 20 }],
    ]);
    expect(retained).not.toBe(positions);
    expect(retained.get('first')).not.toBe(first);
  });
});

describe('moveNodeInLayout', () => {
  it('translates the node and ports, reroutes incident edges, and preserves all other geometry', () => {
    const input = request();
    const automatic = automaticResult(input);
    const requestSnapshot = JSON.stringify(input);
    const resultSnapshot = JSON.stringify(automatic);
    deepFreeze(input);
    deepFreeze(automatic);

    const originalNode = node(automatic, 'a');
    const originalIncident = edge(automatic, 'ab');
    const originalNonIncident = edge(automatic, 'bc');
    const moved = moveNodeInLayout(input, automatic, 'a', {
      x: -80,
      y: 100,
    });
    const movedNode = node(moved, 'a');

    expect(moved).not.toBe(automatic);
    expect(moved.engine).toBe('elk');
    expect(moved.requestId).toBe(automatic.requestId);
    expect(movedNode.position).toEqual({ x: -80, y: 100 });
    expect(movedNode.ports).toEqual([
      expect.objectContaining({
        id: 'a-east',
        position: { x: 40, y: 130 },
      }),
      expect.objectContaining({
        id: 'a-west',
        position: { x: -80, y: 150 },
      }),
    ]);
    expect(node(moved, 'b')).toBe(node(automatic, 'b'));
    expect(edge(moved, 'ab')).not.toBe(originalIncident);
    expect(edge(moved, 'ab').sections).not.toEqual(originalIncident.sections);
    expect(edge(moved, 'bc')).toBe(originalNonIncident);
    expect(edge(moved, 'bc').sections).toEqual(originalNonIncident.sections);
    expect(JSON.stringify(input)).toBe(requestSnapshot);
    expect(JSON.stringify(automatic)).toBe(resultSnapshot);
    expect(originalNode.position).toEqual({ x: 0, y: 40 });
  });

  it('keeps parallel lanes, edge direction, and self-loop routing stable', () => {
    const input = request();
    input.edges = [
      input.edges[0],
      { ...input.edges[0], id: 'ab-parallel' },
      selfEdge(),
      input.edges[1],
    ];
    const automatic = automaticResult(input);

    const moved = moveNodeInLayout(input, automatic, 'a', {
      x: 460,
      y: 120,
    });
    const movedNode = node(moved, 'a');
    const parallel = [edge(moved, 'ab'), edge(moved, 'ab-parallel')];
    const self = edge(moved, 'a-self');
    const selfPoints = sectionPoints(self);

    expect(moved.edges.map(({ id }) => id)).toEqual(
      input.edges.map(({ id }) => id),
    );
    for (const routed of moved.edges) {
      const requested = input.edges.find(({ id }) => id === routed.id);
      expect(routed.semantic).toEqual(requested?.semantic);
      expect(routed.layout).toEqual(requested?.layout);
    }
    expect(parallel[0].sections[0].startPoint).toEqual(
      parallel[1].sections[0].startPoint,
    );
    expect(parallel[0].sections[0].bendPoints).not.toEqual(
      parallel[1].sections[0].bendPoints,
    );
    expect(selfPoints.length).toBeGreaterThan(4);
    expect(Math.min(...selfPoints.map(({ y }) => y))).toBeLessThan(
      movedNode.position.y,
    );
    expect(Math.max(...selfPoints.map(({ x }) => x))).toBeGreaterThan(
      movedNode.position.x + movedNode.width,
    );
  });

  it('recalculates bounds from negative nodes and every preserved route point', () => {
    const input = request();
    const automatic = automaticResult(input);
    const withExteriorRoute: LayoutResult = {
      ...automatic,
      edges: automatic.edges.map((candidate) =>
        candidate.id === 'bc'
          ? {
              ...candidate,
              sections: [
                {
                  id: 'bc-exterior',
                  startPoint: { x: 420, y: 70 },
                  bendPoints: [{ x: 999, y: -300 }],
                  endPoint: { x: 600, y: 190 },
                  junctionPoints: [{ x: 1200, y: -40 }],
                },
              ],
            }
          : candidate,
      ),
    };

    const moved = moveNodeInLayout(input, withExteriorRoute, 'a', {
      x: -500,
      y: 20,
    });

    expect(moved.bounds.minX).toBe(-500);
    expect(moved.bounds.minY).toBe(-300);
    expect(moved.bounds.maxX).toBe(1200);
    expect(moved.bounds.width).toBe(1700);
    expectPointInsideBounds({ x: 999, y: -300 }, moved);
    expectPointInsideBounds({ x: 1200, y: -40 }, moved);
  });

  it('preserves existing diagnostics and adds each reroute diagnostic only once', () => {
    const input = request();
    input.edges = [
      ...input.edges,
      {
        id: 'a-missing',
        semantic: {
          source: { nodeId: 'a' },
          target: { nodeId: 'missing' },
        },
        layout: {
          source: { nodeId: 'a', portId: 'a-east' },
          target: { nodeId: 'missing', portId: 'missing-west' },
        },
      },
    ];
    const baseDiagnostic = {
      code: 'elk-note',
      message: 'Preserve the engine diagnostic.',
    };
    const automatic: LayoutResult = {
      ...automaticResult({ ...input, edges: input.edges.slice(0, 2) }),
      diagnostics: [baseDiagnostic],
    };

    const firstMove = moveNodeInLayout(input, automatic, 'a', {
      x: -100,
      y: 20,
    });
    const secondMove = moveNodeInLayout(input, firstMove, 'a', {
      x: -140,
      y: 30,
    });

    expect(secondMove.engine).toBe('elk');
    expect(secondMove.requestId).toBe(automatic.requestId);
    expect(secondMove.diagnostics[0]).toBe(baseDiagnostic);
    expect(
      secondMove.diagnostics.filter(
        ({ code, edgeId }) =>
          code === 'fallback-edge-endpoint-missing' && edgeId === 'a-missing',
      ),
    ).toHaveLength(1);
  });

  it('returns the same result for invalid, absent, or unchanged nodes', () => {
    const input = request();
    const automatic = automaticResult(input);
    const resultWithoutNode: LayoutResult = {
      ...automatic,
      nodes: automatic.nodes.filter(({ id }) => id !== 'a'),
    };

    expect(moveNodeInLayout(input, automatic, 'missing', { x: 1, y: 2 })).toBe(
      automatic,
    );
    expect(
      moveNodeInLayout(input, automatic, 'a', {
        x: Number.POSITIVE_INFINITY,
        y: 2,
      }),
    ).toBe(automatic);
    expect(
      moveNodeInLayout(input, automatic, 'a', node(automatic, 'a').position),
    ).toBe(automatic);
    expect(
      moveNodeInLayout(
        { ...input, nodes: input.nodes.filter(({ id }) => id !== 'a') },
        automatic,
        'a',
        { x: 1, y: 2 },
      ),
    ).toBe(automatic);
    expect(
      moveNodeInLayout(input, resultWithoutNode, 'a', { x: 1, y: 2 }),
    ).toBe(resultWithoutNode);
  });
});

describe('applyManualNodePositions', () => {
  it('applies multiple positions in stable request order and prunes stale entries', () => {
    const input = request();
    const automatic = automaticResult(input);
    const firstOrder = new Map<string, LayoutPoint>([
      ['b', { x: 180, y: 300 }],
      ['removed', { x: 1, y: 1 }],
      ['a', { x: -120, y: 240 }],
      ['c', { x: Number.NaN, y: 0 }],
    ]);
    const reverseOrder = new Map<string, LayoutPoint>([
      ['a', { x: -120, y: 240 }],
      ['b', { x: 180, y: 300 }],
    ]);

    const applied = applyManualNodePositions(input, automatic, firstOrder);
    const reversed = applyManualNodePositions(input, automatic, reverseOrder);

    expect(node(applied, 'a').position).toEqual({ x: -120, y: 240 });
    expect(node(applied, 'b').position).toEqual({ x: 180, y: 300 });
    expect(node(applied, 'c').position).toEqual(node(automatic, 'c').position);
    expect(layoutGeometry(applied)).toEqual(layoutGeometry(reversed));
    expect(edge(applied, 'ab').sections[0].startPoint).toEqual(
      node(applied, 'a').ports.find(({ id }) => id === 'a-east')?.position,
    );
    expect(edge(applied, 'ab').sections[0].endPoint).toEqual(
      node(applied, 'b').ports.find(({ id }) => id === 'b-west')?.position,
    );
    expect(automatic.engine).toBe(applied.engine);
    expect(automatic.requestId).toBe(applied.requestId);
  });

  it('returns the automatic result unchanged when no retained position applies', () => {
    const input = request();
    const automatic = automaticResult(input);

    expect(
      applyManualNodePositions(
        input,
        automatic,
        new Map([
          ['removed', { x: 1, y: 2 }],
          ['a', { x: Number.NaN, y: 2 }],
        ]),
      ),
    ).toBe(automatic);
  });
});

function request(): MutableLayoutRequest {
  return {
    requestId: 42,
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
        id: 'a',
        width: 120,
        height: 80,
        position: { x: 0, y: 40 },
        ports: [
          {
            id: 'a-east',
            position: { x: 120, y: 30 },
            width: 1,
            height: 1,
            side: 'east',
          },
          {
            id: 'a-west',
            position: { x: 0, y: 50 },
            width: 1,
            height: 1,
            side: 'west',
          },
        ],
      },
      {
        id: 'b',
        width: 120,
        height: 80,
        position: { x: 300, y: 40 },
        ports: [
          {
            id: 'b-east',
            position: { x: 120, y: 30 },
            width: 1,
            height: 1,
            side: 'east',
          },
          {
            id: 'b-west',
            position: { x: 0, y: 50 },
            width: 1,
            height: 1,
            side: 'west',
          },
        ],
      },
      {
        id: 'c',
        width: 120,
        height: 80,
        position: { x: 600, y: 160 },
        ports: [
          {
            id: 'c-west',
            position: { x: 0, y: 30 },
            width: 1,
            height: 1,
            side: 'west',
          },
        ],
      },
    ],
    edges: [
      {
        id: 'ab',
        semantic: {
          source: { nodeId: 'b', columnId: 'b-a-id' },
          target: { nodeId: 'a', columnId: 'a-id' },
        },
        layout: {
          source: { nodeId: 'a', portId: 'a-east' },
          target: { nodeId: 'b', portId: 'b-west' },
        },
      },
      {
        id: 'bc',
        semantic: {
          source: { nodeId: 'c', columnId: 'c-b-id' },
          target: { nodeId: 'b', columnId: 'b-id' },
        },
        layout: {
          source: { nodeId: 'b', portId: 'b-east' },
          target: { nodeId: 'c', portId: 'c-west' },
        },
      },
    ],
  };
}

function selfEdge(): LayoutEdgeRequest {
  return {
    id: 'a-self',
    semantic: {
      source: { nodeId: 'a', columnId: 'a-parent-id' },
      target: { nodeId: 'a', columnId: 'a-id' },
    },
    layout: {
      source: { nodeId: 'a', portId: 'a-east' },
      target: { nodeId: 'a', portId: 'a-west' },
    },
  };
}

function automaticResult(input: LayoutRequest): LayoutResult {
  return {
    ...runGridLayout(input),
    engine: 'elk',
  };
}

function node(result: LayoutResult, id: string) {
  const placement = result.nodes.find((candidate) => candidate.id === id);
  if (!placement) throw new Error(`Missing node ${id}`);
  return placement;
}

function edge(result: LayoutResult, id: string) {
  const route = result.edges.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`Missing edge ${id}`);
  return route;
}

function sectionPoints(route: LayoutResult['edges'][number]): LayoutPoint[] {
  return route.sections.flatMap((section) => [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint,
  ]);
}

function expectPointInsideBounds(
  point: LayoutPoint,
  result: LayoutResult,
): void {
  expect(point.x).toBeGreaterThanOrEqual(result.bounds.minX);
  expect(point.x).toBeLessThanOrEqual(result.bounds.maxX);
  expect(point.y).toBeGreaterThanOrEqual(result.bounds.minY);
  expect(point.y).toBeLessThanOrEqual(result.bounds.maxY);
}

function layoutGeometry(result: LayoutResult): unknown {
  return {
    nodes: result.nodes,
    edges: result.edges,
    bounds: result.bounds,
    diagnostics: result.diagnostics,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

type MutableLayoutRequest = Omit<LayoutRequest, 'nodes' | 'edges'> & {
  nodes: LayoutRequest['nodes'] extends readonly (infer T)[] ? T[] : never;
  edges: LayoutEdgeRequest[];
};
