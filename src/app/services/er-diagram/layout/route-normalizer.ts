import {
  isFiniteLayoutPoint,
  LayoutEdgeSection,
  LayoutPoint,
} from './layout-contracts';

export type RouteNormalizationStatus = 'valid' | 'degraded' | 'rejected';

export type RouteNormalizationIssueCode =
  | 'missing-sections'
  | 'invalid-section'
  | 'invalid-start-point'
  | 'invalid-end-point'
  | 'invalid-point-list'
  | 'invalid-bend-point'
  | 'invalid-junction-point'
  | 'zero-length-section'
  | 'no-usable-sections';

export type RouteNormalizationAction =
  | 'reject-edge'
  | 'drop-section'
  | 'drop-point-list'
  | 'drop-point';

export interface RouteNormalizationIssue {
  readonly code: RouteNormalizationIssueCode;
  readonly action: RouteNormalizationAction;
  readonly message: string;
  readonly sectionIndex: number | null;
  readonly pointIndex?: number;
}

export interface NormalizedLayoutEdgeSection extends LayoutEdgeSection {
  readonly sourceSectionIndex: number;
  readonly bendPoints: readonly LayoutPoint[];
  readonly junctionPoints: readonly LayoutPoint[];
  /** Complete simplified polyline: start, bends, end. */
  readonly points: readonly LayoutPoint[];
}

export interface NormalizedEdgeSections {
  readonly status: RouteNormalizationStatus;
  readonly sections: readonly NormalizedLayoutEdgeSection[];
  readonly issues: readonly RouteNormalizationIssue[];
}

interface PointListResult {
  readonly points: readonly LayoutPoint[];
  readonly issues: readonly RouteNormalizationIssue[];
}

/**
 * Removes only geometry-neutral points: consecutive duplicates and a middle
 * point that continues along the same straight segment. Reversals are kept.
 */
export function simplifyLayoutPolyline(
  points: readonly LayoutPoint[],
): LayoutPoint[] {
  const simplified: LayoutPoint[] = [];

  for (const point of points) {
    const previous = simplified.at(-1);
    if (previous && pointsEqual(previous, point)) {
      continue;
    }

    simplified.push({ x: point.x, y: point.y });

    while (simplified.length >= 3) {
      const end = simplified.length - 1;
      const before = simplified[end - 2];
      const middle = simplified[end - 1];
      const after = simplified[end];

      if (!isRedundantCollinearPoint(before, middle, after)) {
        break;
      }

      simplified.splice(end - 1, 1);
    }
  }

  return simplified;
}

/**
 * Validates and normalizes every routed section independently.
 *
 * A missing/invalid required endpoint rejects only its section. Invalid
 * optional bend or junction points are dropped and reported, keeping the rest
 * of the section usable. The edge is rejected only when no section survives.
 */
export function normalizeRoutedEdgeSections(
  input: unknown,
): NormalizedEdgeSections {
  if (!Array.isArray(input) || input.length === 0) {
    return {
      status: 'rejected',
      sections: [],
      issues: [
        {
          code: 'missing-sections',
          action: 'reject-edge',
          message: 'The routed edge does not contain any sections.',
          sectionIndex: null,
        },
      ],
    };
  }

  const sections: NormalizedLayoutEdgeSection[] = [];
  const issues: RouteNormalizationIssue[] = [];

  input.forEach((candidate, sectionIndex) => {
    if (!isRecord(candidate)) {
      issues.push({
        code: 'invalid-section',
        action: 'drop-section',
        message: `Section ${sectionIndex} is not an object.`,
        sectionIndex,
      });
      return;
    }

    const startPoint = candidate['startPoint'];
    const endPoint = candidate['endPoint'];
    let hasInvalidRequiredPoint = false;

    if (!isFiniteLayoutPoint(startPoint)) {
      issues.push({
        code: 'invalid-start-point',
        action: 'drop-section',
        message: `Section ${sectionIndex} has an invalid start point.`,
        sectionIndex,
      });
      hasInvalidRequiredPoint = true;
    }

    if (!isFiniteLayoutPoint(endPoint)) {
      issues.push({
        code: 'invalid-end-point',
        action: 'drop-section',
        message: `Section ${sectionIndex} has an invalid end point.`,
        sectionIndex,
      });
      hasInvalidRequiredPoint = true;
    }

    if (hasInvalidRequiredPoint) {
      return;
    }

    const bends = normalizeOptionalPointList(
      candidate['bendPoints'],
      'bend',
      sectionIndex,
    );
    const junctions = normalizeOptionalPointList(
      candidate['junctionPoints'],
      'junction',
      sectionIndex,
    );
    issues.push(...bends.issues, ...junctions.issues);

    const points = simplifyLayoutPolyline([
      startPoint as LayoutPoint,
      ...bends.points,
      endPoint as LayoutPoint,
    ]);
    if (!hasNonZeroSegment(points)) {
      issues.push({
        code: 'zero-length-section',
        action: 'drop-section',
        message: `Section ${sectionIndex} has no visible length.`,
        sectionIndex,
      });
      return;
    }

    const normalizedStart = points[0];
    const normalizedEnd = points.at(-1) as LayoutPoint;
    const id =
      typeof candidate['id'] === 'string' ? candidate['id'] : undefined;

    sections.push({
      id,
      sourceSectionIndex: sectionIndex,
      startPoint: normalizedStart,
      endPoint: normalizedEnd,
      bendPoints: points.slice(1, -1),
      junctionPoints: removeConsecutiveDuplicates(junctions.points),
      points,
    });
  });

  if (sections.length === 0) {
    issues.push({
      code: 'no-usable-sections',
      action: 'reject-edge',
      message: 'No routed section contains usable geometry.',
      sectionIndex: null,
    });
    return { status: 'rejected', sections, issues };
  }

  return {
    status: issues.length === 0 ? 'valid' : 'degraded',
    sections,
    issues,
  };
}

function hasNonZeroSegment(points: readonly LayoutPoint[]): boolean {
  return points.slice(1).some((point, index) => {
    const previous = points[index];
    return !pointsEqual(previous, point);
  });
}

function normalizeOptionalPointList(
  value: unknown,
  kind: 'bend' | 'junction',
  sectionIndex: number,
): PointListResult {
  if (value === undefined) {
    return { points: [], issues: [] };
  }

  if (!Array.isArray(value)) {
    return {
      points: [],
      issues: [
        {
          code: 'invalid-point-list',
          action: 'drop-point-list',
          message: `Section ${sectionIndex} has an invalid ${kind} point list.`,
          sectionIndex,
        },
      ],
    };
  }

  const points: LayoutPoint[] = [];
  const issues: RouteNormalizationIssue[] = [];

  value.forEach((point, pointIndex) => {
    if (isFiniteLayoutPoint(point)) {
      points.push({ x: point.x, y: point.y });
      return;
    }

    issues.push({
      code: kind === 'bend' ? 'invalid-bend-point' : 'invalid-junction-point',
      action: 'drop-point',
      message: `Section ${sectionIndex} has an invalid ${kind} point at index ${pointIndex}.`,
      sectionIndex,
      pointIndex,
    });
  });

  return { points, issues };
}

function removeConsecutiveDuplicates(
  points: readonly LayoutPoint[],
): LayoutPoint[] {
  const result: LayoutPoint[] = [];
  for (const point of points) {
    if (!result.length || !pointsEqual(result[result.length - 1], point)) {
      result.push({ x: point.x, y: point.y });
    }
  }
  return result;
}

function isRedundantCollinearPoint(
  before: LayoutPoint,
  middle: LayoutPoint,
  after: LayoutPoint,
): boolean {
  const beforeToMiddleX = middle.x - before.x;
  const beforeToMiddleY = middle.y - before.y;
  const middleToAfterX = after.x - middle.x;
  const middleToAfterY = after.y - middle.y;
  const cross =
    beforeToMiddleX * middleToAfterY - beforeToMiddleY * middleToAfterX;
  const direction =
    beforeToMiddleX * middleToAfterX + beforeToMiddleY * middleToAfterY;

  return cross === 0 && direction >= 0;
}

function pointsEqual(left: LayoutPoint, right: LayoutPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
