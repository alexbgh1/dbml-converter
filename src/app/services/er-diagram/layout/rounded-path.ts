import { isFiniteLayoutPoint, LayoutPoint } from './layout-contracts';
import { simplifyLayoutPolyline } from './route-normalizer';

export const DEFAULT_ROUTE_CORNER_RADIUS = 8;

/**
 * Converts a polyline to an SVG path, rounding each interior corner with a Q
 * command. The corner offset is independently clamped to half of both adjacent
 * segments, so neighboring corners never overlap on a short middle segment.
 */
export function roundedPolylinePath(
  input: readonly LayoutPoint[],
  radius = DEFAULT_ROUTE_CORNER_RADIUS,
): string {
  if (input.some((point) => !isFiniteLayoutPoint(point))) {
    return '';
  }

  const points = simplifyLayoutPolyline(input);
  if (points.length === 0) {
    return '';
  }

  const commands = [`M ${formatPoint(points[0])}`];
  if (points.length === 1) {
    return commands[0];
  }

  const safeRadius = Number.isFinite(radius)
    ? Math.max(0, radius)
    : DEFAULT_ROUTE_CORNER_RADIUS;

  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1];
    const corner = points[index];
    const after = points[index + 1];
    const incomingLength = distance(before, corner);
    const outgoingLength = distance(corner, after);
    const offset = Math.min(safeRadius, incomingLength / 2, outgoingLength / 2);

    if (offset === 0) {
      commands.push(`L ${formatPoint(corner)}`);
      continue;
    }

    const entry = pointAtDistance(corner, before, offset, incomingLength);
    const exit = pointAtDistance(corner, after, offset, outgoingLength);
    commands.push(`L ${formatPoint(entry)}`);
    commands.push(`Q ${formatPoint(corner)} ${formatPoint(exit)}`);
  }

  commands.push(`L ${formatPoint(points[points.length - 1])}`);
  return commands.join(' ');
}

function pointAtDistance(
  origin: LayoutPoint,
  toward: LayoutPoint,
  offset: number,
  segmentLength: number,
): LayoutPoint {
  // Two individually finite coordinates can still have an infinite delta
  // (for example, -Number.MAX_VALUE to Number.MAX_VALUE). At SVG precision a
  // finite corner offset is indistinguishable from the origin in that case;
  // returning it avoids Infinity * 0 producing NaN.
  if (!Number.isFinite(segmentLength)) {
    return { x: origin.x, y: origin.y };
  }

  const ratio = offset / segmentLength;
  return {
    x: origin.x + (toward.x - origin.x) * ratio,
    y: origin.y + (toward.y - origin.y) * ratio,
  };
}

function distance(from: LayoutPoint, to: LayoutPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function formatPoint(point: LayoutPoint): string {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

function formatNumber(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}
