import { describe, expect, it } from 'vitest';

import { LayoutRequest } from './layout-contracts';
import { runGridLayout } from './grid-layout-runner';

describe('runGridLayout', () => {
  it('preserves supplied fallback positions and makes ports absolute', () => {
    const result = runGridLayout(request());

    expect(result.engine).toBe('fallback');
    expect(result.nodes[0]).toMatchObject({
      position: { x: -40, y: 20 },
      ports: [expect.objectContaining({ position: { x: 240, y: 80 } })],
    });
    expect(result.bounds.minX).toBe(-40);
  });

  it('routes parallel edges separately while sharing exact row ports', () => {
    const input = request();
    input.edges = [input.edges[0], { ...input.edges[0], id: 'edge-2' }];
    const result = runGridLayout(input);

    expect(result.edges).toHaveLength(2);
    expect(result.edges[0].sections[0].startPoint).toEqual(
      result.edges[1].sections[0].startPoint,
    );
    expect(result.edges[0].sections[0].bendPoints).not.toEqual(
      result.edges[1].sections[0].bendPoints,
    );
  });

  it('routes a back edge outside both cards when fixed ports face away', () => {
    const input = request();
    input.nodes = [
      { ...input.nodes[0], position: { x: 400, y: 20 } },
      { ...input.nodes[1], position: { x: -40, y: 20 } },
    ];

    const result = runGridLayout(input);
    const section = result.edges[0].sections[0];
    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ];

    expect(Math.min(...points.map((point) => point.y))).toBeLessThan(20);
    expect(result.bounds.minY).toBeLessThan(20);
    expect(
      points.slice(1).every((point, index) => {
        const previous = points[index];
        return point.x === previous.x || point.y === previous.y;
      }),
    ).toBe(true);
  });

  it('routes outside when facing stubs do not fit in the gap between cards', () => {
    const input = request();
    input.nodes = [
      { ...input.nodes[0], position: { x: 0, y: 20 } },
      { ...input.nodes[1], position: { x: 300, y: 20 } },
    ];

    const result = runGridLayout(input);
    const section = result.edges[0].sections[0];
    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ];

    expect(Math.min(...points.map((point) => point.y))).toBeLessThan(20);
    expect(result.bounds.minY).toBeLessThan(20);
  });

  it('gives self-relations an exterior route included in bounds', () => {
    const input = request();
    input.nodes = [input.nodes[0]];
    input.edges = [
      {
        id: 'self',
        semantic: {
          source: { nodeId: 'parent' },
          target: { nodeId: 'parent' },
        },
        layout: {
          source: { nodeId: 'parent', portId: 'parent-east' },
          target: { nodeId: 'parent', portId: 'parent-east' },
        },
      },
    ];

    const result = runGridLayout(input);

    expect(result.edges[0].sections[0].bendPoints?.length ?? 0).toBeGreaterThan(
      2,
    );
    expect(result.bounds.minY).toBeLessThan(result.nodes[0].position.y);
    expect(result.bounds.maxX).toBeGreaterThan(
      result.nodes[0].position.x + result.nodes[0].width,
    );
  });

  it('places nodes without positions deterministically and handles empty input', () => {
    const input = request();
    input.nodes = input.nodes.map(({ position: _position, ...node }) => node);

    expect(runGridLayout(input).nodes.map((node) => node.position)).toEqual([
      { x: 48, y: 48 },
      { x: 488, y: 48 },
    ]);

    expect(runGridLayout({ ...input, nodes: [], edges: [] })).toMatchObject({
      nodes: [],
      edges: [],
      bounds: { width: 0, height: 0 },
    });
  });
});

function request(): LayoutRequest & {
  nodes: LayoutRequest['nodes'] extends readonly (infer T)[] ? T[] : never;
  edges: LayoutRequest['edges'] extends readonly (infer T)[] ? T[] : never;
} {
  return {
    requestId: 1,
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
        height: 76,
        position: { x: -40, y: 20 },
        positionMode: 'automatic',
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
        height: 76,
        position: { x: 400, y: 100 },
        positionMode: 'automatic',
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
        id: 'edge',
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
