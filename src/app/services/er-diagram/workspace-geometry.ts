import {
  isFiniteLayoutPoint,
  type LayoutPoint,
} from './layout/layout-contracts';

export interface WorkspaceViewportTransform {
  readonly viewportOrigin: LayoutPoint;
  readonly pan: LayoutPoint;
  readonly zoom: number;
  readonly boundsOrigin: LayoutPoint;
}

/** Converts a browser client point into the diagram's absolute world space. */
export function clientPointToWorkspace(
  clientPoint: LayoutPoint,
  transform: WorkspaceViewportTransform,
): LayoutPoint | null {
  if (
    !isFiniteLayoutPoint(clientPoint) ||
    !isFiniteLayoutPoint(transform.viewportOrigin) ||
    !isFiniteLayoutPoint(transform.pan) ||
    !isFiniteLayoutPoint(transform.boundsOrigin) ||
    !Number.isFinite(transform.zoom) ||
    transform.zoom <= 0
  ) {
    return null;
  }

  return {
    x:
      (clientPoint.x - transform.viewportOrigin.x - transform.pan.x) /
        transform.zoom +
      transform.boundsOrigin.x,
    y:
      (clientPoint.y - transform.viewportOrigin.y - transform.pan.y) /
        transform.zoom +
      transform.boundsOrigin.y,
  };
}

/**
 * Keeps every unchanged world point at the same screen coordinate when a
 * moved node expands the graph through its previous minimum bounds.
 */
export function panAfterBoundsOriginChange(
  pan: LayoutPoint,
  previousOrigin: LayoutPoint,
  nextOrigin: LayoutPoint,
  zoom: number,
): LayoutPoint {
  if (
    !isFiniteLayoutPoint(pan) ||
    !isFiniteLayoutPoint(previousOrigin) ||
    !isFiniteLayoutPoint(nextOrigin) ||
    !Number.isFinite(zoom)
  ) {
    return { ...pan };
  }

  return {
    x: pan.x + (nextOrigin.x - previousOrigin.x) * zoom,
    y: pan.y + (nextOrigin.y - previousOrigin.y) * zoom,
  };
}
