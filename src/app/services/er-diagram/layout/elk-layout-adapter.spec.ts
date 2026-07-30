import { describe, expect, it } from 'vitest';

import {
  ElkLayoutAdapterError,
  fromElkGraph,
  toElkGraph,
} from './elk-layout-adapter';
import { LayoutRequest } from './layout-contracts';

describe('ELK layout JSON adapter', () => {
  it('emits the deterministic layered baseline and fixed ordered ports', () => {
    const graph = toElkGraph(request());

    expect(graph.layoutOptions).toMatchObject({
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.separateConnectedComponents': 'true',
      'elk.layered.mergeEdges': 'false',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.randomSeed': '1',
      'elk.padding': '[top=48,left=48,bottom=48,right=48]',
      'elk.spacing.componentComponent': '80',
      'elk.spacing.nodeNode': '56',
      'elk.layered.spacing.nodeNodeBetweenLayers': '160',
      'elk.spacing.edgeNode': '24',
      'elk.layered.spacing.edgeNodeBetweenLayers': '32',
      'elk.spacing.edgeEdge': '14',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    });
    expect(graph.children[0].layoutOptions).toEqual({
      'elk.portConstraints': 'FIXED_POS',
    });
    expect(graph.children[0].ports).toEqual([
      expect.objectContaining({
        id: 'parent-east',
        x: 279.5,
        y: 59.5,
        layoutOptions: {
          'elk.port.side': 'EAST',
          'elk.port.index': '0',
        },
      }),
    ]);
    expect(graph.edges[0]).toEqual({
      id: 'relation',
      sources: ['parent-east'],
      targets: ['child-west'],
    });
  });

  it('matches reordered ELK output by opaque IDs and makes ports absolute', () => {
    const result = fromElkGraph(rawGraph(), request());

    expect(result.nodes.map((node) => node.id)).toEqual(['parent', 'child']);
    expect(result.nodes[0]).toMatchObject({
      id: 'parent',
      position: { x: -300, y: -40 },
      ports: [
        {
          id: 'parent-east',
          position: { x: -20, y: 20 },
          width: 1,
          height: 1,
          side: 'east',
        },
      ],
    });
    expect(result.edges[0].semantic).toEqual(request().edges[0].semantic);
    expect(result.edges[0].sections).toHaveLength(2);
    expect(result.bounds).toEqual({
      minX: -300,
      minY: -40,
      maxX: 420,
      maxY: 76,
      width: 720,
      height: 116,
    });
  });

  it('isolates a missing edge route without rejecting valid nodes', () => {
    const raw = rawGraph() as Record<string, unknown>;
    raw['edges'] = [];

    const result = fromElkGraph(raw, request());

    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'elk-edge-missing',
        edgeId: 'relation',
      }),
    );
  });

  it('rejects non-finite or missing node geometry so the controller can fall back', () => {
    const raw = rawGraph() as { children: Record<string, unknown>[] };
    raw.children[0]['x'] = Number.NaN;

    expect(() => fromElkGraph(raw, request())).toThrow(ElkLayoutAdapterError);

    raw.children = raw.children.slice(1);
    expect(() => fromElkGraph(raw, request())).toThrow('omitted node');
  });

  it('rejects zero-sized node geometry while allowing zero-sized ports', () => {
    const zeroWidth = rawGraph() as { children: Record<string, unknown>[] };
    zeroWidth.children[0]['width'] = 0;

    expect(() => fromElkGraph(zeroWidth, request())).toThrow(
      ElkLayoutAdapterError,
    );

    const zeroPort = rawGraph() as {
      children: Array<{ id: string; ports: Record<string, unknown>[] }>;
    };
    const parent = zeroPort.children.find((node) => node.id === 'parent');
    expect(parent).toBeDefined();
    parent!.ports[0]['width'] = 0;
    parent!.ports[0]['height'] = 0;

    expect(
      fromElkGraph(zeroPort, request()).nodes.find(
        (node) => node.id === 'parent',
      )?.ports[0],
    ).toMatchObject({ width: 0, height: 0 });
  });

  it('handles an empty request without depending on response shape', () => {
    const empty: LayoutRequest = { ...request(), nodes: [], edges: [] };

    expect(toElkGraph(empty)).toMatchObject({ children: [], edges: [] });
    expect(fromElkGraph(null, empty)).toMatchObject({
      engine: 'elk',
      nodes: [],
      edges: [],
      bounds: { width: 0, height: 0 },
    });
  });
});

function request(): LayoutRequest {
  return {
    requestId: 7,
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
        id: 'relation',
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

function rawGraph(): unknown {
  return {
    id: 'root',
    children: [
      {
        id: 'child',
        x: 140,
        y: 0,
        width: 280,
        height: 76,
        ports: [{ id: 'child-west', x: -0.5, y: 59.5, width: 1, height: 1 }],
      },
      {
        id: 'parent',
        x: -300,
        y: -40,
        width: 280,
        height: 76,
        ports: [{ id: 'parent-east', x: 279.5, y: 59.5, width: 1, height: 1 }],
      },
    ],
    edges: [
      {
        id: 'relation',
        sections: [
          {
            id: 'first',
            startPoint: { x: -20, y: 20 },
            bendPoints: [{ x: 60, y: 20 }],
            endPoint: { x: 60, y: 60 },
          },
          {
            id: 'second',
            startPoint: { x: 60, y: 60 },
            endPoint: { x: 140, y: 60 },
            junctionPoints: [{ x: 60, y: 60 }],
          },
        ],
      },
    ],
  };
}
