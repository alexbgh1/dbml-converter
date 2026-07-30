import {
  LayoutDiagnostic,
  LayoutEdgeRoute,
  LayoutEdgeSection,
  LayoutNodePlacement,
  LayoutRequest,
  LayoutResult,
} from './layout-contracts';
import { calculateLayoutBounds } from './layout-bounds';
import { normalizeRoutedEdgeSections } from './route-normalizer';

/**
 * Minimal JSON shape exchanged at the ELK boundary. These are deliberately
 * local structural types: the rest of the application never imports ELK's
 * package declarations.
 */
export interface ElkGraphJson {
  id: string;
  layoutOptions: Readonly<Record<string, string>>;
  children: ElkNodeJson[];
  edges: ElkEdgeJson[];
}

interface ElkPortJson {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layoutOptions: Readonly<Record<string, string>>;
}

interface ElkNodeJson {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  ports: ElkPortJson[];
  layoutOptions: Readonly<Record<string, string>>;
}

interface ElkEdgeJson {
  id: string;
  sources: string[];
  targets: string[];
}

export const ELK_LAYERED_OPTIONS: Readonly<Record<string, string>> = {
  // Layered + left-to-right matches the parent-to-dependent reading order.
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  // Orthogonal routes keep long middle runs straight; rounding is renderer-owned.
  'elk.edgeRouting': 'ORTHOGONAL',
  // Disconnected tables remain compact instead of being interleaved with active routes.
  'elk.separateConnectedComponents': 'true',
  // Semantic edges must remain independently addressable for selection/cardinality.
  'elk.layered.mergeEdges': 'false',
  // LAYER_SWEEP reduces crossings while the tiny model-order influence only breaks ties.
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  // Fix the randomized tie-breaker so repeated layouts are reproducible.
  'elk.randomSeed': '1',
  // Explicit whitespace prevents cards, components and routed lanes from touching.
  'elk.padding': '[top=48,left=48,bottom=48,right=48]',
  'elk.spacing.componentComponent': '80',
  'elk.spacing.nodeNode': '56',
  'elk.layered.spacing.nodeNodeBetweenLayers': '160',
  'elk.spacing.edgeNode': '24',
  'elk.layered.spacing.edgeNodeBetweenLayers': '32',
  'elk.spacing.edgeEdge': '14',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.considerModelOrder.crossingCounterNodeInfluence': '0.001',
  'elk.layered.considerModelOrder.crossingCounterPortInfluence': '0.001',
};

export class ElkLayoutAdapterError extends Error {
  override readonly name = 'ElkLayoutAdapterError';
}

export function toElkGraph(request: LayoutRequest): ElkGraphJson {
  return {
    id: `er-layout-${request.requestId}`,
    layoutOptions: optionsFor(request),
    children: request.nodes.map((node) => {
      const sideIndexes = new Map<string, number>();
      return {
        id: node.id,
        width: node.width,
        height: node.height,
        ...(node.positionMode === 'fixed' && node.position
          ? { x: node.position.x, y: node.position.y }
          : {}),
        ports: node.ports.map((port) => {
          const sideIndex = sideIndexes.get(port.side) ?? 0;
          sideIndexes.set(port.side, sideIndex + 1);
          return {
            id: port.id,
            x: port.position.x - port.width / 2,
            y: port.position.y - port.height / 2,
            width: port.width,
            height: port.height,
            layoutOptions: {
              'elk.port.side': port.side.toUpperCase(),
              'elk.port.index': String(sideIndex),
            },
          };
        }),
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      };
    }),
    edges: request.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.layout.source.portId ?? edge.layout.source.nodeId],
      targets: [edge.layout.target.portId ?? edge.layout.target.nodeId],
    })),
  };
}

/** Converts an unknown ELK response into validated, application-owned data. */
export function fromElkGraph(
  value: unknown,
  request: LayoutRequest,
): LayoutResult {
  if (request.nodes.length === 0) {
    return emptyResult(request.requestId);
  }
  if (!isRecord(value)) {
    throw new ElkLayoutAdapterError('ELK returned a non-object graph.');
  }

  const rawChildren = Array.isArray(value['children']) ? value['children'] : [];
  const childById = uniqueRecordsById(rawChildren, 'node');
  const nodes = request.nodes.map<LayoutNodePlacement>((requestedNode) => {
    const raw = childById.get(requestedNode.id);
    if (!raw) {
      throw new ElkLayoutAdapterError(
        `ELK omitted node ${requestedNode.id}.`,
      );
    }

    const x = finiteNumber(raw['x']);
    const y = finiteNumber(raw['y']);
    const width = finitePositiveDimension(raw['width']);
    const height = finitePositiveDimension(raw['height']);
    if (x === null || y === null || width === null || height === null) {
      throw new ElkLayoutAdapterError(
        `ELK returned unusable geometry for node ${requestedNode.id}.`,
      );
    }

    const rawPorts = Array.isArray(raw['ports']) ? raw['ports'] : [];
    const portById = uniqueRecordsById(rawPorts, 'port');
    const ports = requestedNode.ports.map((requestedPort) => {
      const rawPort = portById.get(requestedPort.id);
      const portWidth = rawPort
        ? finiteDimension(rawPort['width'])
        : requestedPort.width;
      const portHeight = rawPort
        ? finiteDimension(rawPort['height'])
        : requestedPort.height;
      const relativeX = rawPort ? finiteNumber(rawPort['x']) : null;
      const relativeY = rawPort ? finiteNumber(rawPort['y']) : null;

      if (
        rawPort &&
        (portWidth === null ||
          portHeight === null ||
          relativeX === null ||
          relativeY === null)
      ) {
        throw new ElkLayoutAdapterError(
          `ELK returned unusable geometry for port ${requestedPort.id}.`,
        );
      }

      return {
        id: requestedPort.id,
        position: rawPort
          ? {
              x: x + (relativeX as number) + (portWidth as number) / 2,
              y: y + (relativeY as number) + (portHeight as number) / 2,
            }
          : {
              x: x + requestedPort.position.x,
              y: y + requestedPort.position.y,
            },
        width: portWidth as number,
        height: portHeight as number,
        side: requestedPort.side,
      };
    });

    return {
      id: requestedNode.id,
      position: { x, y },
      width,
      height,
      ports,
    };
  });

  const diagnostics: LayoutDiagnostic[] = [];
  const rawEdges = Array.isArray(value['edges']) ? value['edges'] : [];
  const edgeById = uniqueRecordsById(rawEdges, 'edge', diagnostics);
  const edges = request.edges.flatMap<LayoutEdgeRoute>((requestedEdge) => {
    const raw = edgeById.get(requestedEdge.id);
    const normalized = normalizeRoutedEdgeSections(raw?.['sections']);
    if (normalized.status === 'rejected') {
      diagnostics.push({
        code: raw ? 'elk-edge-route-missing' : 'elk-edge-missing',
        message: raw
          ? `ELK did not return usable sections for edge ${requestedEdge.id}.`
          : `ELK omitted edge ${requestedEdge.id}.`,
        edgeId: requestedEdge.id,
      });
      return [];
    }

    for (const issue of normalized.issues) {
      diagnostics.push({
        code: `elk-edge-${issue.code}`,
        message: issue.message,
        edgeId: requestedEdge.id,
      });
    }

    const sections: LayoutEdgeSection[] = normalized.sections.map(
      (section) => ({
        id: section.id,
        startPoint: section.startPoint,
        endPoint: section.endPoint,
        bendPoints: section.bendPoints,
        junctionPoints: section.junctionPoints,
      }),
    );
    return [{ ...requestedEdge, sections }];
  });

  return {
    requestId: request.requestId,
    engine: 'elk',
    nodes,
    edges,
    bounds: calculateLayoutBounds(nodes, edges),
    diagnostics,
  };
}

function optionsFor(request: LayoutRequest): Readonly<Record<string, string>> {
  const direction = request.options.direction.toUpperCase();
  return {
    ...ELK_LAYERED_OPTIONS,
    'elk.direction': direction,
    'elk.padding': paddingOption(request.options.padding),
    'elk.spacing.componentComponent': String(
      request.options.componentSpacing,
    ),
    'elk.spacing.nodeNode': String(request.options.nodeSpacing),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(
      request.options.layerSpacing,
    ),
  };
}

function paddingOption(padding: number): string {
  return `[top=${padding},left=${padding},bottom=${padding},right=${padding}]`;
}

function uniqueRecordsById(
  candidates: readonly unknown[],
  kind: 'node' | 'port' | 'edge',
  diagnostics?: LayoutDiagnostic[],
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const candidate of candidates) {
    if (!isRecord(candidate) || typeof candidate['id'] !== 'string') continue;
    if (result.has(candidate['id'])) {
      if (kind !== 'edge' || !diagnostics) {
        throw new ElkLayoutAdapterError(
          `ELK returned duplicate ${kind} ${candidate['id']}.`,
        );
      }
      diagnostics.push({
        code: 'elk-edge-duplicate',
        message: `ELK returned duplicate edge ${candidate['id']}; the first route was kept.`,
        edgeId: candidate['id'],
      });
      continue;
    }
    result.set(candidate['id'], candidate);
  }
  return result;
}

function emptyResult(requestId: number): LayoutResult {
  return {
    requestId,
    engine: 'elk',
    nodes: [],
    edges: [],
    bounds: calculateLayoutBounds([], []),
    diagnostics: [],
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteDimension(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function finitePositiveDimension(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
