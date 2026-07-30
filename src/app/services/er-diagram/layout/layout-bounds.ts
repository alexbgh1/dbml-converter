import {
  LayoutBounds,
  LayoutEdgeRoute,
  LayoutNodePlacement,
  LayoutPoint,
} from './layout-contracts';

/** Calculates the smallest bounds containing every node and routed edge point. */
export function calculateLayoutBounds(
  nodes: readonly LayoutNodePlacement[],
  edges: readonly LayoutEdgeRoute[],
): LayoutBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const include = (point: LayoutPoint): void => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const node of nodes) {
    include(node.position);
    include({
      x: node.position.x + node.width,
      y: node.position.y + node.height,
    });
  }

  for (const edge of edges) {
    for (const section of edge.sections) {
      include(section.startPoint);
      for (const point of section.bendPoints ?? []) include(point);
      include(section.endPoint);
      for (const point of section.junctionPoints ?? []) include(point);
    }
  }

  if (minX === Number.POSITIVE_INFINITY) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
