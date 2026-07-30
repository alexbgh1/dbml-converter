import {
  isFiniteLayoutPoint,
  LayoutDiagnostic,
  LayoutEdgeRoute,
  LayoutNodePlacement,
  LayoutNodeRequest,
  LayoutPoint,
  LayoutPortPlacement,
  LayoutRequest,
  LayoutResult,
} from './layout-contracts';
import { calculateLayoutBounds } from './layout-bounds';
import { simplifyLayoutPolyline } from './route-normalizer';

const FALLBACK_COLUMNS = 4;
const EDGE_STUB = 28;
const PARALLEL_LANE_GAP = 12;
const SELF_LOOP_CLEARANCE = 44;

/** Deterministic, synchronous fallback implementing the same route contract. */
export function runGridLayout(request: LayoutRequest): LayoutResult {
  if (request.nodes.length === 0) {
    return {
      requestId: request.requestId,
      engine: 'fallback',
      nodes: [],
      edges: [],
      bounds: calculateLayoutBounds([], []),
      diagnostics: [],
    };
  }

  const nodes = placeNodes(request.nodes, request);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const portById = new Map(
    nodes.flatMap((node) => node.ports.map((port) => [port.id, port] as const)),
  );
  const diagnostics: LayoutDiagnostic[] = [];
  const pairLanes = new Map<string, number>();
  const selfLanes = new Map<string, number>();
  const edges = request.edges.flatMap<LayoutEdgeRoute>((edge) => {
    const sourceNode = nodeById.get(edge.layout.source.nodeId);
    const targetNode = nodeById.get(edge.layout.target.nodeId);
    if (!sourceNode || !targetNode) {
      diagnostics.push({
        code: 'fallback-edge-endpoint-missing',
        message: `Fallback routing skipped edge ${edge.id} because a node endpoint is missing.`,
        edgeId: edge.id,
      });
      return [];
    }

    const source = endpointPoint(
      sourceNode,
      edge.layout.source.portId,
      portById,
      'east',
    );
    const target = endpointPoint(
      targetNode,
      edge.layout.target.portId,
      portById,
      'west',
    );
    const selfRelation = sourceNode.id === targetNode.id;
    const laneKey = selfRelation
      ? sourceNode.id
      : [...[sourceNode.id, targetNode.id]].sort().join('\u0000');
    const lane = nextLane(selfRelation ? selfLanes : pairLanes, laneKey);
    const points = selfRelation
      ? selfLoopPoints(sourceNode, source, target, lane)
      : orthogonalPoints(sourceNode, targetNode, source, target, lane);
    const simplified = simplifyLayoutPolyline(points);
    if (simplified.length < 2) {
      diagnostics.push({
        code: 'fallback-edge-route-missing',
        message: `Fallback routing could not produce geometry for edge ${edge.id}.`,
        edgeId: edge.id,
      });
      return [];
    }

    return [
      {
        ...edge,
        sections: [
          {
            id: `${edge.id}-fallback`,
            startPoint: simplified[0],
            bendPoints: simplified.slice(1, -1),
            endPoint: simplified[simplified.length - 1],
          },
        ],
      },
    ];
  });

  return {
    requestId: request.requestId,
    engine: 'fallback',
    nodes,
    edges,
    bounds: calculateLayoutBounds(nodes, edges),
    diagnostics,
  };
}

function placeNodes(
  requested: readonly LayoutNodeRequest[],
  request: LayoutRequest,
): LayoutNodePlacement[] {
  const columns = Math.min(
    FALLBACK_COLUMNS,
    Math.max(1, Math.ceil(Math.sqrt(requested.length))),
  );
  const rowHeights: number[] = [];
  requested.forEach((node, index) => {
    const row = Math.floor(index / columns);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, node.height);
  });
  const rowOffsets: number[] = [];
  let nextY = request.options.padding;
  for (const height of rowHeights) {
    rowOffsets.push(nextY);
    nextY += height + request.options.nodeSpacing;
  }

  const columnWidths = Array.from({ length: columns }, () => 0);
  requested.forEach((node, index) => {
    const column = index % columns;
    columnWidths[column] = Math.max(columnWidths[column], node.width);
  });
  const columnOffsets: number[] = [];
  let nextX = request.options.padding;
  for (const width of columnWidths) {
    columnOffsets.push(nextX);
    nextX += width + request.options.layerSpacing;
  }

  return requested.map((node, index) => {
    const gridPosition = {
      x: columnOffsets[index % columns],
      y: rowOffsets[Math.floor(index / columns)],
    };
    const position =
      node.position && isFiniteLayoutPoint(node.position)
        ? { ...node.position }
        : gridPosition;
    return {
      id: node.id,
      position,
      width: node.width,
      height: node.height,
      ports: node.ports.map((port) => ({
        id: port.id,
        position: {
          x: position.x + port.position.x,
          y: position.y + port.position.y,
        },
        width: port.width,
        height: port.height,
        side: port.side,
      })),
    };
  });
}

function endpointPoint(
  node: LayoutNodePlacement,
  portId: string | undefined,
  ports: ReadonlyMap<string, LayoutPortPlacement>,
  fallbackSide: 'east' | 'west',
): LayoutPortPlacement {
  const port = portId ? ports.get(portId) : undefined;
  if (port) return port;
  return {
    id: `${node.id}-${fallbackSide}-fallback`,
    position: {
      x: node.position.x + (fallbackSide === 'east' ? node.width : 0),
      y: node.position.y + node.height / 2,
    },
    width: 0,
    height: 0,
    side: fallbackSide,
  };
}

function orthogonalPoints(
  sourceNode: LayoutNodePlacement,
  targetNode: LayoutNodePlacement,
  source: LayoutPortPlacement,
  target: LayoutPortPlacement,
  lane: number,
): LayoutPoint[] {
  const sourceDirection = horizontalDirection(source.side, 1);
  const targetDirection = horizontalDirection(target.side, -1);
  const sourceStub = {
    x: source.position.x + sourceDirection * EDGE_STUB,
    y: source.position.y,
  };
  const targetStub = {
    x: target.position.x + targetDirection * EDGE_STUB,
    y: target.position.y,
  };

  const sourceFacesTarget = (targetStub.x - sourceStub.x) * sourceDirection > 0;
  const targetFacesSource = (sourceStub.x - targetStub.x) * targetDirection > 0;
  if (!sourceFacesTarget || !targetFacesSource) {
    return exteriorBackEdgePoints(
      sourceNode,
      targetNode,
      source,
      target,
      sourceStub,
      targetStub,
      lane,
    );
  }

  const laneOffset = alternatingLaneOffset(lane);
  const middleX = (sourceStub.x + targetStub.x) / 2 + laneOffset;
  return [
    source.position,
    sourceStub,
    { x: middleX, y: sourceStub.y },
    { x: middleX, y: targetStub.y },
    targetStub,
    target.position,
  ];
}

function exteriorBackEdgePoints(
  sourceNode: LayoutNodePlacement,
  targetNode: LayoutNodePlacement,
  source: LayoutPortPlacement,
  target: LayoutPortPlacement,
  sourceStub: LayoutPoint,
  targetStub: LayoutPoint,
  lane: number,
): LayoutPoint[] {
  const laneDistance = EDGE_STUB + Math.floor(lane / 2) * PARALLEL_LANE_GAP;
  const exteriorY =
    lane % 2 === 0
      ? Math.min(sourceNode.position.y, targetNode.position.y) - laneDistance
      : Math.max(
          sourceNode.position.y + sourceNode.height,
          targetNode.position.y + targetNode.height,
        ) + laneDistance;

  return [
    source.position,
    sourceStub,
    { x: sourceStub.x, y: exteriorY },
    { x: targetStub.x, y: exteriorY },
    targetStub,
    target.position,
  ];
}

function selfLoopPoints(
  node: LayoutNodePlacement,
  source: LayoutPortPlacement,
  target: LayoutPortPlacement,
  lane: number,
): LayoutPoint[] {
  const clearance = SELF_LOOP_CLEARANCE + lane * 18;
  const rightX = node.position.x + node.width + clearance;
  const leftX = node.position.x - clearance;
  const topY = node.position.y - clearance;
  return [
    source.position,
    { x: rightX, y: source.position.y },
    { x: rightX, y: topY },
    { x: leftX, y: topY },
    { x: leftX, y: target.position.y },
    target.position,
  ];
}

function horizontalDirection(
  side: LayoutPortPlacement['side'],
  fallback: 1 | -1,
): 1 | -1 {
  if (side === 'east') return 1;
  if (side === 'west') return -1;
  return fallback;
}

function alternatingLaneOffset(lane: number): number {
  if (lane === 0) return 0;
  const distance = Math.ceil(lane / 2) * PARALLEL_LANE_GAP;
  return lane % 2 === 1 ? distance : -distance;
}

function nextLane(lanes: Map<string, number>, key: string): number {
  const lane = lanes.get(key) ?? 0;
  lanes.set(key, lane + 1);
  return lane;
}
