import { describe, expect, it } from 'vitest';

import type {
  DiagramEdge,
  DiagramEdgeEndpoint,
  DiagramGraph,
  DiagramNode,
} from '../er-diagram.interface';
import type {
  LayoutEdgeRequest,
  LayoutEdgeRoute,
  LayoutNodePlacement,
  LayoutResult,
} from './layout-contracts';
import {
  applyLayoutResult,
  DIAGRAM_LAYOUT_BASELINE,
  diagramToLayoutRequest,
} from './diagram-layout-adapter';

describe('diagramToLayoutRequest', () => {
  it('uses final card dimensions, stable ports, and the deterministic baseline', () => {
    const parent = makeNode('parent', 'parent-id', 10, 20);
    parent.ports.reverse();
    const graph = makeGraph([
      parent,
      makeNode('dependent', 'parent-id', 400, 20),
    ]);

    const request = diagramToLayoutRequest(graph, 17);

    expect(request.requestId).toBe(17);
    expect(request.options).toEqual(DIAGRAM_LAYOUT_BASELINE);
    expect(request.options).toEqual({
      direction: 'right',
      routing: 'orthogonal',
      padding: 48,
      componentSpacing: 80,
      nodeSpacing: 56,
      layerSpacing: 160,
    });
    expect(request.nodes[0]).toEqual({
      id: 'parent',
      width: 280,
      height: 76,
      position: { x: 10, y: 20 },
      positionMode: 'automatic',
      ports: [
        {
          id: 'parent-id-west',
          width: 1,
          height: 1,
          position: { x: 0, y: 60 },
          side: 'west',
        },
        {
          id: 'parent-id-east',
          width: 1,
          height: 1,
          position: { x: 280, y: 60 },
          side: 'east',
        },
      ],
    });
  });

  it('keeps semantic FK-to-parent direction but lays out parent EAST to dependent WEST', () => {
    const parent = makeNode('parent', 'parent-id', 10, 20);
    const dependent = makeNode('dependent', 'dependent-parent-id', 400, 20);
    const edge = makeEdge(
      'relation',
      dependent,
      parent,
      'foreign-key',
      'referenced',
    );
    const request = diagramToLayoutRequest(
      makeGraph([dependent, parent], [edge]),
      1,
    );

    expect(request.edges[0]).toEqual({
      id: 'relation',
      semantic: {
        source: { nodeId: 'dependent', columnId: 'dependent-parent-id' },
        target: { nodeId: 'parent', columnId: 'parent-id' },
      },
      layout: {
        source: { nodeId: 'parent', portId: 'parent-id-east' },
        target: {
          nodeId: 'dependent',
          portId: 'dependent-parent-id-west',
        },
      },
    });
  });

  it('retains parallel edge IDs and lets them share the same stable ports', () => {
    const parent = makeNode('parent', 'parent-id', 10, 20);
    const dependent = makeNode('dependent', 'dependent-parent-id', 400, 20);
    const first = makeEdge(
      'parallel-0',
      dependent,
      parent,
      'foreign-key',
      'referenced',
    );
    const second = { ...first, id: 'parallel-1' };

    const edges = diagramToLayoutRequest(
      makeGraph([dependent, parent], [first, second]),
      2,
    ).edges;

    expect(edges.map((edge) => edge.id)).toEqual(['parallel-0', 'parallel-1']);
    expect(edges[0].layout).toEqual(edges[1].layout);
  });

  it('orders N:N peers by stable identity without assigning a false FK direction', () => {
    const zebra = makeNode('zebra', 'zebra-id', 10, 20);
    const alpha = makeNode('alpha', 'alpha-id', 400, 20);
    const peer = makeEdge('peer', zebra, alpha, 'peer', 'peer', 'N:N');

    const edge = diagramToLayoutRequest(makeGraph([zebra, alpha], [peer]), 3)
      .edges[0];

    expect(edge.semantic.source.nodeId).toBe('zebra');
    expect(edge.semantic.target.nodeId).toBe('alpha');
    expect(edge.layout).toEqual({
      source: { nodeId: 'alpha', portId: 'alpha-id-east' },
      target: { nodeId: 'zebra', portId: 'zebra-id-west' },
    });
  });

  it('uses opposite sides for a self-relation and handles empty/disconnected graphs', () => {
    const node = makeNode('employee', 'manager-id', 10, 20);
    const self = makeEdge('self', node, node, 'foreign-key', 'referenced');

    const selfRequest = diagramToLayoutRequest(makeGraph([node], [self]), 4);
    expect(selfRequest.edges[0].layout).toEqual({
      source: { nodeId: 'employee', portId: 'manager-id-east' },
      target: { nodeId: 'employee', portId: 'manager-id-west' },
    });

    const disconnected = diagramToLayoutRequest(
      makeGraph([
        makeNode('one', 'one-id', 0, 0),
        makeNode('two', 'two-id', 500, 0),
      ]),
      5,
    );
    expect(disconnected.nodes).toHaveLength(2);
    expect(disconnected.edges).toEqual([]);

    const empty = diagramToLayoutRequest(makeGraph([]), 6);
    expect(empty.nodes).toEqual([]);
    expect(empty.edges).toEqual([]);
  });
});

describe('applyLayoutResult', () => {
  it('does not mutate input and applies negative positions, bounds, and every routed section', () => {
    const parent = makeNode('parent', 'parent-id', 10, 20);
    const dependent = makeNode('dependent', 'dependent-parent-id', 400, 20);
    const first = makeEdge(
      'parallel-0',
      dependent,
      parent,
      'foreign-key',
      'referenced',
    );
    const second = {
      ...makeEdge('parallel-1', dependent, parent, 'foreign-key', 'referenced'),
      path: 'M 400 80 C 300 80, 250 80, 290 80',
      layout: {
        ...makeEdge('ignored', dependent, parent, 'foreign-key', 'referenced')
          .layout,
        path: 'M 400 80 C 300 80, 250 80, 290 80',
      },
    };
    const graph = deepFreeze(makeGraph([dependent, parent], [first, second]));
    const request = diagramToLayoutRequest(graph, 11);
    const result = deepFreeze<LayoutResult>({
      requestId: 11,
      engine: 'elk',
      nodes: [placement('parent', -120, -40), placement('dependent', 180, 80)],
      edges: [
        route(request.edges[0], [
          {
            id: 'a',
            startPoint: { x: -20, y: 20 },
            bendPoints: [{ x: 0, y: 20 }],
            endPoint: { x: 0, y: 50 },
          },
          {
            id: 'b',
            startPoint: { x: 0, y: 50 },
            bendPoints: [{ x: 70, y: 50 }],
            endPoint: { x: 70, y: 80 },
            junctionPoints: [{ x: 40, y: 50 }],
          },
        ]),
        route(request.edges[1], []),
      ],
      bounds: {
        minX: -168,
        minY: -88,
        maxX: 508,
        maxY: 204,
        width: 676,
        height: 292,
      },
      diagnostics: [],
    });

    const applied = applyLayoutResult(graph, result);

    expect(applied).not.toBe(graph);
    expect(applied.nodes[1].layout).toEqual({
      x: -120,
      y: -40,
      width: 280,
      height: 76,
    });
    expect(applied.nodes[1].layout.x).toBe(-120);
    expect(applied.edges[0].layout.path).toBe(
      'M -20 20 L -8 20 Q 0 20 0 28 L 0 50 ' +
        'M 0 50 L 62 50 Q 70 50 70 58 L 70 80',
    );
    expect(applied.edges[0].layout).toEqual(
      expect.objectContaining({
        sourceNodeId: 'parent',
        sourcePortId: 'parent-id-east',
        targetNodeId: 'dependent',
        targetPortId: 'dependent-parent-id-west',
        renderCardinality: '1:N',
      }),
    );
    expect(applied.edges[0].fromEndpoint.portIds.east).toBe(
      'dependent-parent-id-east',
    );
    expect(applied.edges[0].toEndpoint.portIds.west).toBe('parent-id-west');
    expect({
      x: applied.edges[0].layout.labelX,
      y: applied.edges[0].layout.labelY,
    }).toEqual({ x: 35, y: 42 });
    expect(applied.edges[1].layout.path).not.toBe(second.layout.path);
    expect(applied.edges[1].layout.path).not.toContain(' C ');
    expect(applied.edges[1].layout.path).toMatch(/^M 160 20 /);
    expect(applied.edges[1].layout.path).toMatch(/ L 180 140$/);
    expect(applied.edges[1].layout.renderCardinality).toBe('1:N');
    expect(applied.edges[1].layout.sourceNodeId).toBe('parent');
    expect(applied.edges[1].layout.targetNodeId).toBe('dependent');
    expect(applied.edges[1]).not.toBe(second);
    expect(applied.edges[1].layout).not.toBe(second.layout);
    expect(applied.layout).toEqual(result.bounds);
    expect(applied.layout.minX).toBe(-168);
    expect(applied.layout.minY).toBe(-88);
    expect(applied.layout.maxX).toBe(508);
    expect(applied.layout.maxY).toBe(204);
  });

  it('reroutes only the malformed edge when another section remains usable', () => {
    const left = makeNode('left', 'left-id', 0, 0);
    const right = makeNode('right', 'right-id', 400, 0);
    const validEdge = makeEdge(
      'valid',
      left,
      right,
      'foreign-key',
      'referenced',
    );
    const invalidEdge = makeEdge(
      'invalid',
      left,
      right,
      'foreign-key',
      'referenced',
    );
    const graph = deepFreeze(
      makeGraph([left, right], [validEdge, invalidEdge]),
    );
    const request = diagramToLayoutRequest(graph, 12);
    const result = deepFreeze<LayoutResult>({
      requestId: 12,
      engine: 'elk',
      nodes: [],
      edges: [
        route(request.edges[0], [
          {
            startPoint: { x: Number.NaN, y: 0 },
            endPoint: { x: 50, y: 0 },
          },
          {
            startPoint: { x: 10, y: 10 },
            bendPoints: [
              { x: 40, y: 10 },
              { x: Number.POSITIVE_INFINITY, y: 10 },
            ],
            endPoint: { x: 40, y: 40 },
          },
        ]),
        route(request.edges[1], [
          {
            startPoint: { x: Number.NaN, y: 0 },
            endPoint: { x: Number.NaN, y: 0 },
          },
        ]),
      ],
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 680,
        maxY: 200,
        width: 680,
        height: 200,
      },
      diagnostics: [],
    });

    const applied = applyLayoutResult(graph, result);

    expect(applied.edges[0].layout.path).toBe(
      'M 10 10 L 32 10 Q 40 10 40 18 L 40 40',
    );
    expect(applied.edges[1].layout.path).not.toBe(invalidEdge.layout.path);
    expect(applied.edges[1].layout.path).not.toContain(' C ');
    expect(applied.edges[1].layout.path).toMatch(/^M 680 60 /);
    expect(applied.edges[1].layout.path).toMatch(/ L 0 60$/);
    expect(applied.edges[1].layout).toEqual(
      expect.objectContaining({
        sourceNodeId: right.id,
        targetNodeId: left.id,
        renderCardinality: '1:N',
      }),
    );
    expect(applied.nodes[0].layout).toEqual(left.layout);
  });

  it('tracks route orientation for normal, reversed self, peer, and 1:1 edges', () => {
    const parent = makeNode('parent', 'parent-id', 0, 0);
    const dependent = makeNode('dependent', 'dependent-id', 400, 0);
    const employee = makeNode('employee', 'manager-id', 0, 200);
    const zebra = makeNode('zebra', 'zebra-id', 0, 400);
    const alpha = makeNode('alpha', 'alpha-id', 400, 400);
    const normal = makeEdge(
      'normal',
      parent,
      dependent,
      'referenced',
      'foreign-key',
      '1:N',
    );
    const self = makeEdge(
      'self-routed',
      employee,
      employee,
      'foreign-key',
      'referenced',
      'N:1',
    );
    const peer = makeEdge('peer-routed', zebra, alpha, 'peer', 'peer', 'N:N');
    const oneToOne = makeEdge(
      'one-to-one',
      dependent,
      parent,
      'foreign-key',
      'referenced',
      '1:1',
    );
    const graph = deepFreeze(
      makeGraph(
        [parent, dependent, employee, zebra, alpha],
        [normal, self, peer, oneToOne],
      ),
    );
    const request = diagramToLayoutRequest(graph, 14);
    const result = deepFreeze<LayoutResult>({
      requestId: 14,
      engine: 'elk',
      nodes: [],
      edges: request.edges.map((edge, index) =>
        route(edge, [
          {
            startPoint: { x: index * 100, y: 20 },
            endPoint: { x: index * 100 + 80, y: 20 },
          },
        ]),
      ),
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 800,
        maxY: 600,
        width: 800,
        height: 600,
      },
      diagnostics: [],
    });

    const applied = applyLayoutResult(graph, result);

    expect(applied.edges[0].layout).toEqual(
      expect.objectContaining({
        sourceNodeId: 'parent',
        sourcePortId: 'parent-id-east',
        targetNodeId: 'dependent',
        targetPortId: 'dependent-id-west',
        renderCardinality: '1:N',
      }),
    );
    expect(applied.edges[1].layout).toEqual(
      expect.objectContaining({
        sourceNodeId: 'employee',
        sourcePortId: 'manager-id-east',
        targetNodeId: 'employee',
        targetPortId: 'manager-id-west',
        renderCardinality: '1:N',
      }),
    );
    expect(applied.edges[2].layout).toEqual(
      expect.objectContaining({
        sourceNodeId: 'alpha',
        targetNodeId: 'zebra',
        renderCardinality: 'N:N',
      }),
    );
    expect(applied.edges[3].layout.renderCardinality).toBe('1:1');
  });

  it('falls back to original bounds when returned bounds are unusable', () => {
    const graph = deepFreeze(makeGraph([makeNode('only', 'only-id', 60, 60)]));
    const result = deepFreeze<LayoutResult>({
      requestId: 13,
      engine: 'fallback',
      nodes: [],
      edges: [],
      bounds: {
        minX: Number.NaN,
        minY: 0,
        maxX: 400,
        maxY: 200,
        width: 400,
        height: 200,
      },
      diagnostics: [],
    });

    expect(applyLayoutResult(graph, result).layout).toEqual(graph.layout);
  });

  it('expands bounds when a cardinality label sits above the routed geometry', () => {
    const left = makeNode('left', 'left-id', 0, 0);
    const right = makeNode('right', 'right-id', 400, 0);
    const edge = makeEdge(
      'top-route',
      left,
      right,
      'foreign-key',
      'referenced',
    );
    const graph = makeGraph([left, right], [edge]);
    const request = diagramToLayoutRequest(graph, 14);
    const result: LayoutResult = {
      requestId: 14,
      engine: 'elk',
      nodes: [placement('left', 0, 0), placement('right', 400, 0)],
      edges: [
        route(request.edges[0], [
          {
            startPoint: { x: 280, y: 0 },
            endPoint: { x: 400, y: 0 },
          },
        ]),
      ],
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 680,
        maxY: 76,
        width: 680,
        height: 76,
      },
      diagnostics: [],
    };

    const applied = applyLayoutResult(graph, result);

    expect(applied.edges[0].layout.labelY).toBe(-8);
    expect(applied.layout.minY).toBe(-18);
    expect(applied.layout.maxY).toBe(76);
  });
});

function makeGraph(
  nodes: DiagramNode[],
  edges: DiagramEdge[] = [],
): DiagramGraph {
  return {
    nodes,
    edges,
    layout: {
      minX: 0,
      minY: 0,
      maxX: 800,
      maxY: 300,
      width: 800,
      height: 300,
    },
  };
}

function makeNode(
  id: string,
  columnId: string,
  x: number,
  y: number,
): DiagramNode {
  const portIds = {
    west: `${columnId}-west`,
    east: `${columnId}-east`,
  };
  const layout = { x, y, width: 280, height: 76 };
  return {
    id,
    label: id,
    alias: null,
    isJunction: false,
    columns: [
      {
        id: columnId,
        name: columnId,
        type: 'int',
        nullable: null,
        badges: [],
        row: { index: 0, y: 44, height: 32, centerY: 60 },
        portIds,
      },
    ],
    ports: [
      {
        id: portIds.west,
        nodeId: id,
        columnId,
        side: 'west',
        order: 0,
        x: 0,
        y: 60,
      },
      {
        id: portIds.east,
        nodeId: id,
        columnId,
        side: 'east',
        order: 0,
        x: 280,
        y: 60,
      },
    ],
    layout,
  };
}

function makeEdge(
  id: string,
  from: DiagramNode,
  to: DiagramNode,
  fromRole: DiagramEdgeEndpoint['role'],
  toRole: DiagramEdgeEndpoint['role'],
  cardinality: DiagramEdge['cardinality'] = 'N:1',
): DiagramEdge {
  const fromColumn = from.columns[0];
  const toColumn = to.columns[0];
  const fromEndpoint = endpoint(from, fromRole);
  const toEndpoint = endpoint(to, toRole);
  const layout = {
    sourceNodeId: from.id,
    sourcePortId: fromColumn.portIds.east,
    targetNodeId: to.id,
    targetPortId: toColumn.portIds.west,
    renderCardinality: cardinality,
    path: `fallback-${id}`,
    labelX: 200,
    labelY: 40,
  };
  return {
    id,
    fromNode: from.id,
    toNode: to.id,
    fromColumnId: fromColumn.id,
    toColumnId: toColumn.id,
    fromColumn: fromColumn.name,
    toColumn: toColumn.name,
    fromEndpoint,
    toEndpoint,
    cardinality,
    selfRelation: from.id === to.id,
    layout,
  };
}

function endpoint(
  node: DiagramNode,
  role: DiagramEdgeEndpoint['role'],
): DiagramEdgeEndpoint {
  const column = node.columns[0];
  return {
    nodeId: node.id,
    nodeName: node.label,
    columnId: column.id,
    columnName: column.name,
    portIds: column.portIds,
    cardinality: role === 'referenced' ? 'one' : 'many',
    role,
    nullable: column.nullable,
  };
}

function placement(id: string, x: number, y: number): LayoutNodePlacement {
  return {
    id,
    position: { x, y },
    width: 280,
    height: 76,
    ports: [],
  };
}

function route(
  request: LayoutEdgeRequest,
  sections: LayoutEdgeRoute['sections'],
): LayoutEdgeRoute {
  return { ...request, sections };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
