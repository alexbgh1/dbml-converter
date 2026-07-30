import { describe, expect, it } from 'vitest';

import { calculateLayoutBounds } from './layout-bounds';
import { LayoutEdgeRoute, LayoutNodePlacement } from './layout-contracts';

describe('calculateLayoutBounds', () => {
  it('returns zero bounds for an empty graph', () => {
    expect(calculateLayoutBounds([], [])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    });
  });

  it('includes node corners at positive and negative coordinates', () => {
    const nodes: LayoutNodePlacement[] = [
      {
        id: 'left',
        position: { x: -20, y: -10 },
        width: 10,
        height: 5,
        ports: [],
      },
      {
        id: 'right',
        position: { x: 5, y: 2 },
        width: 12,
        height: 8,
        ports: [],
      },
    ];

    expect(calculateLayoutBounds(nodes, [])).toEqual({
      minX: -20,
      minY: -10,
      maxX: 17,
      maxY: 10,
      width: 37,
      height: 20,
    });
  });

  it('includes start, bend, end and unordered junction points', () => {
    const edges: LayoutEdgeRoute[] = [
      {
        id: 'users-posts',
        semantic: {
          source: { nodeId: 'users' },
          target: { nodeId: 'posts' },
        },
        layout: {
          source: { nodeId: 'users' },
          target: { nodeId: 'posts' },
        },
        sections: [
          {
            startPoint: { x: 0, y: 0 },
            bendPoints: [{ x: -5, y: 20 }],
            endPoint: { x: 10, y: 10 },
            junctionPoints: [{ x: 25, y: -7 }],
          },
        ],
      },
    ];

    expect(calculateLayoutBounds([], edges)).toEqual({
      minX: -5,
      minY: -7,
      maxX: 25,
      maxY: 20,
      width: 30,
      height: 27,
    });
  });
});
