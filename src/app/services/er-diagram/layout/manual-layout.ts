import {
  isFiniteLayoutPoint,
  LayoutDiagnostic,
  LayoutEdgeRoute,
  LayoutNodePlacement,
  LayoutNodeRequest,
  LayoutPoint,
  LayoutRequest,
  LayoutResult,
} from './layout-contracts';
import { calculateLayoutBounds } from './layout-bounds';
import { runGridLayout } from './grid-layout-runner';

export type ManualNodePositions = ReadonlyMap<string, LayoutPoint>;

/**
 * Keeps only finite positions that still belong to the current request.
 * Iterating nodeIds makes the returned map independent from persistence order.
 */
export function retainManualNodePositions(
  positions: ManualNodePositions,
  nodeIds: Iterable<string>,
): Map<string, LayoutPoint> {
  const retained = new Map<string, LayoutPoint>();

  for (const nodeId of nodeIds) {
    const position = positions.get(nodeId);
    if (isFiniteLayoutPoint(position)) {
      retained.set(nodeId, { x: position.x, y: position.y });
    }
  }

  return retained;
}

/**
 * Moves one node while preserving the automatic result and rerouting only the
 * edges that touch it. The deterministic fallback router is intentionally used
 * as a local router; it receives every current node at a fixed position.
 */
export function moveNodeInLayout(
  request: LayoutRequest,
  currentResult: LayoutResult,
  nodeId: string,
  nextPosition: LayoutPoint,
): LayoutResult {
  if (
    !isFiniteLayoutPoint(nextPosition) ||
    !request.nodes.some((node) => node.id === nodeId)
  ) {
    return currentResult;
  }

  const nodeIndex = currentResult.nodes.findIndex((node) => node.id === nodeId);
  if (nodeIndex < 0) {
    return currentResult;
  }

  const currentNode = currentResult.nodes[nodeIndex];
  if (
    currentNode.position.x === nextPosition.x &&
    currentNode.position.y === nextPosition.y
  ) {
    return currentResult;
  }

  const movedNode = translateNode(currentNode, nextPosition);
  const nodes = currentResult.nodes.map((node, index) =>
    index === nodeIndex ? movedNode : node,
  );
  const incidentRequests = request.edges.filter((edge) =>
    touchesNode(edge, nodeId),
  );
  const incidentIds = new Set(incidentRequests.map((edge) => edge.id));

  const rerouted = runGridLayout({
    requestId: request.requestId,
    nodes: nodes.map(toFixedNodeRequest),
    edges: incidentRequests,
    options: request.options,
  });
  const reroutedById = new Map(
    rerouted.edges.map((edge) => [edge.id, edge] as const),
  );
  const edges: LayoutEdgeRoute[] = [];
  const includedIds = new Set<string>();

  for (const edge of currentResult.edges) {
    if (!incidentIds.has(edge.id)) {
      edges.push(edge);
      includedIds.add(edge.id);
      continue;
    }

    const replacement = reroutedById.get(edge.id);
    if (replacement) {
      edges.push(replacement);
      includedIds.add(edge.id);
    }
  }

  for (const edge of rerouted.edges) {
    if (!includedIds.has(edge.id)) {
      edges.push(edge);
      includedIds.add(edge.id);
    }
  }

  return {
    ...currentResult,
    nodes,
    edges,
    bounds: calculateLayoutBounds(nodes, edges),
    diagnostics: mergeDiagnostics(
      currentResult.diagnostics,
      rerouted.diagnostics,
    ),
  };
}

/** Applies retained positions in request-node order for deterministic lanes. */
export function applyManualNodePositions(
  request: LayoutRequest,
  automaticResult: LayoutResult,
  positions: ManualNodePositions,
): LayoutResult {
  const retained = retainManualNodePositions(
    positions,
    request.nodes.map((node) => node.id),
  );
  let result = automaticResult;

  for (const node of request.nodes) {
    const position = retained.get(node.id);
    if (position) {
      result = moveNodeInLayout(request, result, node.id, position);
    }
  }

  return result;
}

function translateNode(
  node: LayoutNodePlacement,
  nextPosition: LayoutPoint,
): LayoutNodePlacement {
  const deltaX = nextPosition.x - node.position.x;
  const deltaY = nextPosition.y - node.position.y;

  return {
    ...node,
    position: { x: nextPosition.x, y: nextPosition.y },
    ports: node.ports.map((port) => ({
      ...port,
      position: {
        x: port.position.x + deltaX,
        y: port.position.y + deltaY,
      },
    })),
  };
}

function toFixedNodeRequest(node: LayoutNodePlacement): LayoutNodeRequest {
  return {
    id: node.id,
    width: node.width,
    height: node.height,
    position: { x: node.position.x, y: node.position.y },
    positionMode: 'fixed',
    ports: node.ports.map((port) => ({
      id: port.id,
      width: port.width,
      height: port.height,
      side: port.side,
      position: {
        x: port.position.x - node.position.x,
        y: port.position.y - node.position.y,
      },
    })),
  };
}

function touchesNode(
  edge: LayoutRequest['edges'][number],
  nodeId: string,
): boolean {
  return (
    edge.layout.source.nodeId === nodeId || edge.layout.target.nodeId === nodeId
  );
}

function mergeDiagnostics(
  current: readonly LayoutDiagnostic[],
  additional: readonly LayoutDiagnostic[],
): LayoutDiagnostic[] {
  const merged = [...current];
  const keys = new Set(current.map(diagnosticKey));

  for (const diagnostic of additional) {
    const key = diagnosticKey(diagnostic);
    if (!keys.has(key)) {
      keys.add(key);
      merged.push(diagnostic);
    }
  }

  return merged;
}

function diagnosticKey(diagnostic: LayoutDiagnostic): string {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.message,
    diagnostic.edgeId ?? null,
  ]);
}
