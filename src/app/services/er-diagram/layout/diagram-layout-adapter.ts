import type {
  DiagramEdge,
  DiagramEdgeEndpoint,
  DiagramGraph,
  DiagramGraphLayout,
  DiagramNode,
} from '../er-diagram.interface';
import {
  isFiniteLayoutPoint,
  type LayoutBounds,
  type LayoutEdgeRequest,
  type LayoutEdgeRoute,
  type LayoutEngineEndpoint,
  type LayoutNodePlacement,
  type LayoutRequest,
  type LayoutRequestOptions,
  type LayoutResult,
} from './layout-contracts';
import { runGridLayout } from './grid-layout-runner';
import { normalizeRoutedEdgeSections } from './route-normalizer';
import { roundedPolylinePath } from './rounded-path';

export const DIAGRAM_LAYOUT_BASELINE: Readonly<LayoutRequestOptions> =
  Object.freeze({
    direction: 'right',
    routing: 'orthogonal',
    padding: 48,
    componentSpacing: 80,
    nodeSpacing: 56,
    layerSpacing: 160,
  });

const LAYOUT_PORT_SIZE = 1;
const MIN_USABLE_LABEL_SEGMENT = 24;
const LABEL_HALF_WIDTH = 18;
const LABEL_HALF_HEIGHT = 10;

/**
 * Builds an engine-neutral request without changing the schema's relation
 * direction. Layout endpoints are allowed to point in the opposite direction:
 * the parent is placed before the FK/dependent node in a right-facing graph.
 */
export function diagramToLayoutRequest(
  graph: DiagramGraph,
  requestId: number,
): LayoutRequest {
  const availablePorts = new Set(
    graph.nodes.flatMap((node) => node.ports.map((port) => port.id)),
  );

  return {
    requestId,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      width: node.layout.width,
      height: node.layout.height,
      position: { x: node.layout.x, y: node.layout.y },
      positionMode: 'automatic',
      ports: [...node.ports].sort(compareDiagramPorts).map((port) => ({
        id: port.id,
        width: LAYOUT_PORT_SIZE,
        height: LAYOUT_PORT_SIZE,
        position: {
          x: port.side === 'east' ? node.layout.width : 0,
          y: port.y,
        },
        side: port.side,
      })),
    })),
    edges: graph.edges.map((edge) =>
      diagramEdgeToLayoutRequest(edge, availablePorts),
    ),
    options: { ...DIAGRAM_LAYOUT_BASELINE },
  };
}

/**
 * Applies accepted layout geometry while keeping the semantic model detached
 * from engine-owned objects. Invalid or missing geometry degrades per node or
 * edge to the graph's deterministic grid fallback.
 */
export function applyLayoutResult(
  graph: DiagramGraph,
  result: LayoutResult,
): DiagramGraph {
  const placements = indexFirstValidNodePlacement(result.nodes);
  const routes = indexFirstById(result.edges);

  const nodes = graph.nodes.map((node) =>
    cloneNodeWithPlacement(node, placements.get(node.id)),
  );
  let fallbackRoutes: Map<string, LayoutEdgeRoute> | undefined;
  const fallbackRouteFor = (edgeId: string): LayoutEdgeRoute | undefined => {
    fallbackRoutes ??= createPlacementFallbackRoutes(
      graph,
      result.requestId,
      placements,
    );
    return fallbackRoutes.get(edgeId);
  };
  const edges = graph.edges.map((edge) => {
    const route = routes.get(edge.id);
    const routed = route ? cloneEdgeWithRoute(edge, route) : null;
    if (routed) {
      return routed;
    }

    const fallbackRoute = fallbackRouteFor(edge.id);
    return (
      (fallbackRoute ? cloneEdgeWithRoute(edge, fallbackRoute) : null) ??
      cloneEdgeWithLayout(edge, edge.layout)
    );
  });
  const baseLayout = validBounds(result.bounds)
    ? cloneBounds(result.bounds)
    : cloneGraphLayout(graph.layout);
  const layout = expandRenderedBounds(baseLayout, nodes, edges);

  return { nodes, edges, layout };
}

function cloneEdgeWithRoute(
  edge: DiagramEdge,
  route: LayoutEdgeRoute,
): DiagramEdge | null {
  const normalized = normalizeRoutedEdgeSections(route.sections);
  if (normalized.status === 'rejected') return null;

  const sectionPaths = normalized.sections
    .map((section) => roundedPolylinePath(section.points))
    .filter((path) => path.length > 0);
  if (sectionPaths.length === 0) return null;

  const label = findRouteLabel(
    normalized.sections.map((section) => section.points),
  );
  const directionReversed = layoutDirectionIsReversed(edge, route);
  return cloneEdgeWithLayout(edge, {
    ...edge.layout,
    sourceNodeId: route.layout.source.nodeId,
    sourcePortId: route.layout.source.portId ?? null,
    targetNodeId: route.layout.target.nodeId,
    targetPortId: route.layout.target.portId ?? null,
    renderCardinality: directionReversed
      ? reverseCardinality(edge.cardinality)
      : edge.cardinality,
    path: sectionPaths.join(' '),
    labelX: label?.x ?? edge.layout.labelX,
    labelY: label?.y ?? edge.layout.labelY,
  });
}

function createPlacementFallbackRoutes(
  graph: DiagramGraph,
  requestId: number,
  placements: ReadonlyMap<string, LayoutNodePlacement>,
): Map<string, LayoutEdgeRoute> {
  const request = diagramToLayoutRequest(graph, requestId);
  const nodes = request.nodes.map((node) => {
    const placement = placements.get(node.id);
    if (!placement) return node;

    return {
      ...node,
      width: placement.width,
      height: placement.height,
      position: { ...placement.position },
      positionMode: 'fixed' as const,
      ports: node.ports.map((port) => ({
        ...port,
        position: {
          x:
            port.side === 'east'
              ? placement.width
              : port.side === 'west'
                ? 0
                : port.position.x,
          y:
            port.side === 'south'
              ? placement.height
              : port.side === 'north'
                ? 0
                : port.position.y,
        },
      })),
    };
  });

  return indexFirstById(runGridLayout({ ...request, nodes }).edges);
}

function layoutDirectionIsReversed(
  edge: DiagramEdge,
  route: LayoutEdgeRequest,
): boolean {
  const sourceMatchesFrom = engineEndpointMatches(
    route.layout.source,
    edge.fromEndpoint,
  );
  const sourceMatchesTo = engineEndpointMatches(
    route.layout.source,
    edge.toEndpoint,
  );
  if (sourceMatchesFrom !== sourceMatchesTo) {
    return sourceMatchesTo;
  }

  const targetMatchesFrom = engineEndpointMatches(
    route.layout.target,
    edge.fromEndpoint,
  );
  const targetMatchesTo = engineEndpointMatches(
    route.layout.target,
    edge.toEndpoint,
  );
  if (targetMatchesFrom !== targetMatchesTo) {
    return targetMatchesFrom;
  }

  // A same-node/same-column relation cannot be distinguished by identity or
  // port membership. The role order is the remaining semantic signal and
  // matches diagramToLayoutRequest's parent-first rule.
  return (
    edge.fromEndpoint.role === 'foreign-key' &&
    edge.toEndpoint.role === 'referenced'
  );
}

function engineEndpointMatches(
  candidate: LayoutEngineEndpoint,
  endpoint: DiagramEdgeEndpoint,
): boolean {
  if (candidate.nodeId !== endpoint.nodeId) return false;
  if (candidate.portId === undefined) return true;
  return (
    candidate.portId === endpoint.portIds.west ||
    candidate.portId === endpoint.portIds.east
  );
}

function reverseCardinality(
  cardinality: DiagramEdge['cardinality'],
): DiagramEdge['cardinality'] {
  if (cardinality === '1:N') return 'N:1';
  if (cardinality === 'N:1') return '1:N';
  return cardinality;
}

function diagramEdgeToLayoutRequest(
  edge: DiagramEdge,
  availablePorts: ReadonlySet<string>,
): LayoutEdgeRequest {
  const semantic = {
    source: { nodeId: edge.fromNode, columnId: edge.fromColumnId },
    target: { nodeId: edge.toNode, columnId: edge.toColumnId },
  };
  const [layoutSource, layoutTarget] = layoutEndpointOrder(edge);

  return {
    id: edge.id,
    semantic,
    layout: {
      source: engineEndpoint(layoutSource, 'east', availablePorts),
      target: engineEndpoint(layoutTarget, 'west', availablePorts),
    },
  };
}

function layoutEndpointOrder(
  edge: DiagramEdge,
): readonly [DiagramEdgeEndpoint, DiagramEdgeEndpoint] {
  const endpoints = [edge.fromEndpoint, edge.toEndpoint] as const;
  const referenced = endpoints.find(
    (endpoint) => endpoint.role === 'referenced',
  );
  const foreignKey = endpoints.find(
    (endpoint) => endpoint.role === 'foreign-key',
  );

  if (referenced && foreignKey) {
    return [referenced, foreignKey];
  }

  // N:N endpoints are peers. Ordering them by opaque identity keeps layout
  // deterministic without assigning either peer a fictional FK role.
  return [...endpoints].sort((left, right) =>
    endpointKey(left).localeCompare(endpointKey(right)),
  ) as [DiagramEdgeEndpoint, DiagramEdgeEndpoint];
}

function engineEndpoint(
  endpoint: DiagramEdgeEndpoint,
  side: 'east' | 'west',
  availablePorts: ReadonlySet<string>,
): LayoutEngineEndpoint {
  const portId = endpoint.portIds[side];
  return availablePorts.has(portId)
    ? { nodeId: endpoint.nodeId, portId }
    : { nodeId: endpoint.nodeId };
}

function endpointKey(endpoint: DiagramEdgeEndpoint): string {
  return `${endpoint.nodeId.length}:${endpoint.nodeId}${endpoint.columnId.length}:${endpoint.columnId}`;
}

function compareDiagramPorts(
  left: DiagramNode['ports'][number],
  right: DiagramNode['ports'][number],
): number {
  return (
    left.order - right.order ||
    sideRank(left.side) - sideRank(right.side) ||
    left.id.localeCompare(right.id)
  );
}

function sideRank(side: DiagramNode['ports'][number]['side']): number {
  return side === 'west' ? 0 : 1;
}

function indexFirstValidNodePlacement(
  placements: readonly LayoutNodePlacement[],
): Map<string, LayoutNodePlacement> {
  const result = new Map<string, LayoutNodePlacement>();
  for (const placement of placements) {
    if (!result.has(placement.id) && validNodePlacement(placement)) {
      result.set(placement.id, placement);
    }
  }
  return result;
}

function indexFirstById<T extends { readonly id: string }>(
  items: readonly T[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (!result.has(item.id)) {
      result.set(item.id, item);
    }
  }
  return result;
}

function validNodePlacement(placement: LayoutNodePlacement): boolean {
  return (
    isFiniteLayoutPoint(placement.position) &&
    Number.isFinite(placement.width) &&
    placement.width > 0 &&
    Number.isFinite(placement.height) &&
    placement.height > 0
  );
}

function cloneNodeWithPlacement(
  node: DiagramNode,
  placement: LayoutNodePlacement | undefined,
): DiagramNode {
  const layout = placement
    ? {
        x: placement.position.x,
        y: placement.position.y,
        width: placement.width,
        height: placement.height,
      }
    : { ...node.layout };

  return {
    ...node,
    columns: node.columns.map((column) => ({
      ...column,
      badges: [...column.badges],
      row: { ...column.row },
      portIds: { ...column.portIds },
    })),
    ports: node.ports.map((port) => ({ ...port })),
    layout,
  };
}

function cloneEdgeWithLayout(
  edge: DiagramEdge,
  candidateLayout: DiagramEdge['layout'],
): DiagramEdge {
  const layout = { ...candidateLayout };
  return {
    ...edge,
    fromEndpoint: cloneEndpoint(edge.fromEndpoint),
    toEndpoint: cloneEndpoint(edge.toEndpoint),
    layout,
  };
}

function cloneEndpoint(endpoint: DiagramEdgeEndpoint): DiagramEdgeEndpoint {
  return { ...endpoint, portIds: { ...endpoint.portIds } };
}

interface LabelSegment {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly length: number;
  readonly routeMidpoint: number;
  readonly horizontal: boolean;
  readonly order: number;
}

function findRouteLabel(
  sections: readonly (readonly { readonly x: number; readonly y: number }[])[],
): { x: number; y: number } | null {
  const segments: LabelSegment[] = [];
  let travelled = 0;
  let order = 0;

  for (const points of sections) {
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (length > 0 && Number.isFinite(length)) {
        segments.push({
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          length,
          routeMidpoint: travelled + length / 2,
          horizontal: from.y === to.y,
          order,
        });
        travelled += length;
      }
      order += 1;
    }
  }

  if (segments.length === 0) return null;

  const usable = segments.filter(
    (segment) => segment.length >= MIN_USABLE_LABEL_SEGMENT,
  );
  const candidates = usable.length > 0 ? usable : segments;
  const routeCenter = travelled / 2;
  const chosen = [...candidates].sort(
    (left, right) =>
      Math.abs(left.routeMidpoint - routeCenter) -
        Math.abs(right.routeMidpoint - routeCenter) ||
      Number(right.horizontal) - Number(left.horizontal) ||
      right.length - left.length ||
      left.order - right.order,
  )[0];

  const midpointX = (chosen.fromX + chosen.toX) / 2;
  const midpointY = (chosen.fromY + chosen.toY) / 2;
  return chosen.horizontal
    ? { x: midpointX, y: midpointY - 8 }
    : { x: midpointX + 8, y: midpointY };
}

function validBounds(bounds: LayoutBounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.maxX >= bounds.minX &&
    bounds.maxY >= bounds.minY &&
    bounds.width >= 0 &&
    bounds.height >= 0
  );
}

function cloneBounds(bounds: LayoutBounds): DiagramGraphLayout {
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    width: bounds.width,
    height: bounds.height,
  };
}

function cloneGraphLayout(layout: DiagramGraphLayout): DiagramGraphLayout {
  return { ...layout };
}

function expandRenderedBounds(
  initial: DiagramGraphLayout,
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
): DiagramGraphLayout {
  let minX = initial.minX;
  let minY = initial.minY;
  let maxX = initial.maxX;
  let maxY = initial.maxY;

  for (const node of nodes) {
    minX = Math.min(minX, node.layout.x);
    minY = Math.min(minY, node.layout.y);
    maxX = Math.max(maxX, node.layout.x + node.layout.width);
    maxY = Math.max(maxY, node.layout.y + node.layout.height);
  }

  for (const edge of edges) {
    if (
      !Number.isFinite(edge.layout.labelX) ||
      !Number.isFinite(edge.layout.labelY)
    ) {
      continue;
    }
    minX = Math.min(minX, edge.layout.labelX - LABEL_HALF_WIDTH);
    minY = Math.min(minY, edge.layout.labelY - LABEL_HALF_HEIGHT);
    maxX = Math.max(maxX, edge.layout.labelX + LABEL_HALF_WIDTH);
    maxY = Math.max(maxY, edge.layout.labelY + LABEL_HALF_HEIGHT);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
