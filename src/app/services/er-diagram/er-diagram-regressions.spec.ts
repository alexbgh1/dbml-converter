import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DbmlParserService } from '../dbml-parser/dbml-parser';
import type { DatabaseSchema } from '../dbml-parser/interfaces/dbml-parser.interface';
import type {
  DiagramColumn,
  DiagramGraph,
  DiagramNode,
} from './er-diagram.interface';
import {
  applyLayoutResult,
  diagramToLayoutRequest,
} from './layout/diagram-layout-adapter';
import type {
  LayoutBounds,
  LayoutPoint,
  LayoutRequest,
  LayoutResult,
} from './layout/layout-contracts';
import { runGridLayout } from './layout/grid-layout-runner';
import { schemaToDiagram } from './schema-to-diagram';

const FIXTURE_NAMES = [
  'isolated-long',
  'chain-diamond',
  'cycles-self',
  'hub-parallel',
  'junction-badges',
  'dense-commerce',
  'invalid-endpoint',
] as const;

type FixtureName = (typeof FIXTURE_NAMES)[number];

interface FixturePipeline {
  schema: DatabaseSchema;
  diagnosticCount: number;
  errorDiagnosticCount: number;
  graph: DiagramGraph;
  request: LayoutRequest;
  result: LayoutResult;
  rendered: DiagramGraph;
}

describe('ER diagram regression fixtures', () => {
  it.each(FIXTURE_NAMES)(
    '%s remains deterministic, immutable and geometrically valid',
    (fixtureName) => {
      const first = buildPipeline(fixtureName);
      const second = buildPipeline(fixtureName);

      expect(identityVector(second.graph)).toEqual(identityVector(first.graph));
      expect(second.graph).toEqual(first.graph);
      expect(second.request).toEqual(first.request);
      expect(second.result).toEqual(first.result);
      expect(second.rendered).toEqual(first.rendered);

      if (fixtureName === 'invalid-endpoint') {
        expect(first.errorDiagnosticCount).toBeGreaterThan(0);
      } else {
        expect(first.errorDiagnosticCount).toBe(0);
      }

      assertUniqueIds(first.graph);
      assertPortAndRowAnchors(first);
      assertSemanticAndLayoutDirections(first);
      assertFiniteGeometry(first);
      assertBoundsContainNodesAndRoutes(first.result);
      assertRoutedEndpointsUseRequestedPorts(first);
    },
  );

  it('keeps an isolated node and anchors a relation below the twelfth long row', () => {
    const pipeline = buildPipeline('isolated-long');
    const longTable = nodeByLabel(
      pipeline.graph,
      'very_long_audit_event_archive_table_name',
    );
    const isolated = nodeByLabel(
      pipeline.graph,
      'completely_isolated_reference_catalog',
    );
    const owner = columnByName(
      longTable,
      'owner_account_identifier_with_long_name',
    );

    expect(longTable.columns.length).toBeGreaterThan(12);
    expect(owner.row.index).toBeGreaterThanOrEqual(12);
    expect(owner.row.centerY).toBeGreaterThan(12 * owner.row.height);
    expect(
      pipeline.graph.edges.some(
        (edge) =>
          edge.fromEndpoint.nodeId === isolated.id ||
          edge.toEndpoint.nodeId === isolated.id,
      ),
    ).toBe(false);

    const ownerEdge = pipeline.graph.edges.find(
      (edge) => edge.fromEndpoint.columnId === owner.id,
    );
    if (!ownerEdge)
      throw new Error('Expected a relation from the long owner row.');
    const requestEdge = pipeline.request.edges.find(
      (edge) => edge.id === ownerEdge.id,
    );
    expect(requestEdge?.layout.target).toEqual({
      nodeId: longTable.id,
      portId: owner.portIds.west,
    });

    const placement = pipeline.result.nodes.find(
      (node) => node.id === longTable.id,
    );
    const placedOwnerPort = placement?.ports.find(
      (port) => port.id === owner.portIds.west,
    );
    expect(placedOwnerPort?.position.y).toBe(
      (placement?.position.y ?? 0) + owner.row.centerY,
    );
  });

  it('preserves the parent-to-dependent diamond and chain layout direction', () => {
    const pipeline = buildPipeline('chain-diamond');
    const labelById = new Map(
      pipeline.graph.nodes.map((node) => [node.id, node.label]),
    );
    const layoutPairs = pipeline.request.edges
      .map(
        (edge) =>
          `${labelById.get(edge.layout.source.nodeId)}->${labelById.get(edge.layout.target.nodeId)}`,
      )
      .sort();

    expect(pipeline.graph.nodes).toHaveLength(5);
    expect(pipeline.graph.edges).toHaveLength(5);
    expect(layoutPairs).toEqual(
      [
        'origins->branch_alpha',
        'origins->branch_beta',
        'branch_alpha->merge_points',
        'branch_beta->merge_points',
        'merge_points->delivery_queue',
      ].sort(),
    );
  });

  it('keeps cycles and multiple self-relations as distinct exterior routes', () => {
    const pipeline = buildPipeline('cycles-self');
    const selfEdges = pipeline.graph.edges.filter((edge) => edge.selfRelation);
    const selfIds = new Set(selfEdges.map((edge) => edge.id));
    const selfRoutes = pipeline.result.edges.filter((edge) =>
      selfIds.has(edge.id),
    );
    const selfPaths = pipeline.rendered.edges
      .filter((edge) => selfIds.has(edge.id))
      .map((edge) => edge.layout.path);
    const minimumNodeX = Math.min(
      ...pipeline.result.nodes.map((node) => node.position.x),
    );

    expect(pipeline.graph.edges).toHaveLength(6);
    expect(selfEdges).toHaveLength(3);
    expect(new Set(selfRoutes.map(routeSignature)).size).toBe(3);
    expect(new Set(selfPaths).size).toBe(3);
    expect(pipeline.result.bounds.minX).toBeLessThan(minimumNodeX);
  });

  it('separates parallel FKs while sharing one FK column port predictably', () => {
    const pipeline = buildPipeline('hub-parallel');
    const documentUserEdges = pipeline.graph.edges.filter(
      (edge) =>
        edge.fromEndpoint.nodeName === 'documents' &&
        edge.toEndpoint.nodeName === 'users',
    );
    const documentUserIds = new Set(documentUserEdges.map((edge) => edge.id));
    const documentUserPaths = pipeline.rendered.edges
      .filter((edge) => documentUserIds.has(edge.id))
      .map((edge) => edge.layout.path);
    const sharedActorEdges = pipeline.graph.edges.filter(
      (edge) =>
        edge.fromEndpoint.nodeName === 'audit_events' &&
        edge.fromEndpoint.columnName === 'actor_id',
    );
    const sharedRequests = pipeline.request.edges.filter((requestEdge) =>
      sharedActorEdges.some((edge) => edge.id === requestEdge.id),
    );

    expect(documentUserEdges).toHaveLength(3);
    expect(new Set(documentUserPaths).size).toBe(3);
    expect(sharedActorEdges).toHaveLength(2);
    expect(
      new Set(sharedActorEdges.map((edge) => edge.fromColumnId)).size,
    ).toBe(1);
    expect(
      new Set(sharedRequests.map((edge) => edge.layout.target.portId)).size,
    ).toBe(1);
    expect(
      new Set(sharedRequests.map((edge) => edge.layout.source.nodeId)).size,
    ).toBe(2);
  });

  it('keeps junction provenance, composite constraints and compact badge rules', () => {
    const pipeline = buildPipeline('junction-badges');
    const junction = nodeByLabel(pipeline.graph, 'account_role_assignments');
    const accountId = columnByName(junction, 'account_id');
    const roleId = columnByName(junction, 'role_id');
    const tenantId = columnByName(junction, 'tenant_id');
    const assignmentCode = columnByName(junction, 'assignment_code');
    const assignmentUuid = columnByName(junction, 'assignment_uuid');
    const manyToMany = pipeline.graph.edges.filter(
      (edge) => edge.cardinality === 'N:N',
    );
    const incidentJunctionEdges = pipeline.graph.edges.filter(
      (edge) => edge.fromNode === junction.id || edge.toNode === junction.id,
    );

    expect(junction.isJunction).toBe(true);
    expect(accountId.badges).toEqual(['PK', 'FK']);
    expect(roleId.badges).toEqual(['PK', 'FK']);
    expect(tenantId.badges).toEqual(['NN']);
    expect(assignmentCode.badges).toEqual(['NN']);
    expect(assignmentUuid.badges).toEqual(['FK', 'UQ', 'NN']);
    expect(manyToMany).toHaveLength(0);
    expect(incidentJunctionEdges).toHaveLength(3);
  });

  it('keeps a moderate dense commerce graph usable without exact-coordinate snapshots', () => {
    const pipeline = buildPipeline('dense-commerce');
    const orderAddressEdges = pipeline.graph.edges.filter(
      (edge) =>
        edge.fromEndpoint.nodeName === 'orders' &&
        edge.toEndpoint.nodeName === 'addresses',
    );
    const orderAddressIds = new Set(orderAddressEdges.map((edge) => edge.id));
    const orderAddressPaths = pipeline.rendered.edges
      .filter((edge) => orderAddressIds.has(edge.id))
      .map((edge) => edge.layout.path);

    expect(pipeline.graph.nodes.length).toBeGreaterThanOrEqual(15);
    expect(pipeline.graph.edges.length).toBeGreaterThanOrEqual(25);
    expect(
      pipeline.graph.edges.filter((edge) => edge.selfRelation).length,
    ).toBe(2);
    expect(orderAddressEdges).toHaveLength(2);
    expect(new Set(orderAddressPaths).size).toBe(2);
  });

  it('isolates one malformed endpoint without dropping valid nodes or routes', () => {
    const pipeline = buildPipeline('invalid-endpoint');

    expect(pipeline.schema.tables).toHaveLength(2);
    expect(pipeline.schema.relations).toHaveLength(2);
    expect(pipeline.diagnosticCount).toBeGreaterThan(0);
    expect(pipeline.graph.nodes).toHaveLength(2);
    expect(pipeline.graph.edges).toHaveLength(1);
    expect(pipeline.graph.edges[0].fromColumn).toBe('parent_id');
    expect(pipeline.result.edges).toHaveLength(1);
    expect(pipeline.rendered.edges).toHaveLength(1);
  });
});

function buildPipeline(fixtureName: FixtureName): FixturePipeline {
  const parser = new DbmlParserService();
  parser.setDbmlContent(loadFixture(fixtureName));
  const schema = parser.schema();

  const schemaBefore = JSON.stringify(schema);
  const graph = schemaToDiagram(schema);
  expect(JSON.stringify(schema)).toBe(schemaBefore);

  const graphBeforeRequest = JSON.stringify(graph);
  const request = diagramToLayoutRequest(graph, 73);
  expect(JSON.stringify(graph)).toBe(graphBeforeRequest);

  const requestBeforeLayout = JSON.stringify(request);
  const result = runGridLayout(request);
  expect(JSON.stringify(request)).toBe(requestBeforeLayout);

  const graphBeforeApply = JSON.stringify(graph);
  const resultBeforeApply = JSON.stringify(result);
  const rendered = applyLayoutResult(graph, result);
  expect(JSON.stringify(graph)).toBe(graphBeforeApply);
  expect(JSON.stringify(result)).toBe(resultBeforeApply);

  return {
    schema,
    diagnosticCount: parser.diagnostics().length,
    errorDiagnosticCount: parser
      .diagnostics()
      .filter((diagnostic) => diagnostic.severity === 'error').length,
    graph,
    request,
    result,
    rendered,
  };
}

function loadFixture(fixtureName: FixtureName): string {
  return readFileSync(
    resolve(
      'src',
      'app',
      'testing',
      'fixtures',
      'er-diagram',
      fixtureName,
      'input.dbml',
    ),
    'utf8',
  )
    .replace(/\r\n/g, '\n')
    .trimEnd();
}

function identityVector(graph: DiagramGraph): string[] {
  return [
    ...graph.nodes.flatMap((node) => [
      node.id,
      ...node.columns.map((column) => column.id),
      ...node.ports.map((port) => port.id),
    ]),
    ...graph.edges.map((edge) => edge.id),
  ];
}

function assertUniqueIds(graph: DiagramGraph): void {
  const identities = identityVector(graph);
  expect(new Set(identities).size).toBe(identities.length);
}

function assertPortAndRowAnchors(pipeline: FixturePipeline): void {
  const requestNodes = new Map(
    pipeline.request.nodes.map((node) => [node.id, node]),
  );
  const placements = new Map(
    pipeline.result.nodes.map((node) => [node.id, node]),
  );

  for (const node of pipeline.graph.nodes) {
    expect(node.ports).toHaveLength(node.columns.length * 2);
    const requestNode = requestNodes.get(node.id);
    const placement = placements.get(node.id);
    if (!requestNode || !placement) {
      throw new Error(`Missing layout node for ${node.label}.`);
    }

    for (const column of node.columns) {
      const west = node.ports.find((port) => port.id === column.portIds.west);
      const east = node.ports.find((port) => port.id === column.portIds.east);
      if (!west || !east) throw new Error(`Missing ports for ${column.name}.`);

      expect(column.row.index).toBe(west.order);
      expect(column.row.index).toBe(east.order);
      expect(column.row.centerY).toBe(west.y);
      expect(column.row.centerY).toBe(east.y);
      expect(west.x).toBe(0);
      expect(east.x).toBe(node.layout.width);

      for (const port of [west, east]) {
        const requested = requestNode.ports.find(
          (candidate) => candidate.id === port.id,
        );
        const placed = placement.ports.find(
          (candidate) => candidate.id === port.id,
        );
        expect(requested?.position).toEqual({ x: port.x, y: port.y });
        expect(placed?.position).toEqual({
          x: placement.position.x + port.x,
          y: placement.position.y + port.y,
        });
      }
    }
  }
}

function assertSemanticAndLayoutDirections(pipeline: FixturePipeline): void {
  const requestEdges = new Map(
    pipeline.request.edges.map((edge) => [edge.id, edge]),
  );

  for (const edge of pipeline.graph.edges) {
    const requestEdge = requestEdges.get(edge.id);
    if (!requestEdge) throw new Error(`Missing request edge ${edge.id}.`);

    expect(requestEdge.semantic.source).toEqual({
      nodeId: edge.fromEndpoint.nodeId,
      columnId: edge.fromEndpoint.columnId,
    });
    expect(requestEdge.semantic.target).toEqual({
      nodeId: edge.toEndpoint.nodeId,
      columnId: edge.toEndpoint.columnId,
    });

    const endpoints = [edge.fromEndpoint, edge.toEndpoint];
    const foreignKey = endpoints.find(
      (endpoint) => endpoint.role === 'foreign-key',
    );
    const referenced = endpoints.find(
      (endpoint) => endpoint.role === 'referenced',
    );
    if (foreignKey && referenced) {
      expect(requestEdge.layout.source).toEqual({
        nodeId: referenced.nodeId,
        portId: referenced.portIds.east,
      });
      expect(requestEdge.layout.target).toEqual({
        nodeId: foreignKey.nodeId,
        portId: foreignKey.portIds.west,
      });
    } else {
      expect(endpoints.every((endpoint) => endpoint.role === 'peer')).toBe(
        true,
      );
      expect(
        [
          requestEdge.layout.source.nodeId,
          requestEdge.layout.target.nodeId,
        ].sort(),
      ).toEqual(endpoints.map((endpoint) => endpoint.nodeId).sort());
    }
  }
}

function assertFiniteGeometry(pipeline: FixturePipeline): void {
  const graphBounds = pipeline.rendered.layout;
  for (const value of [
    graphBounds.minX,
    graphBounds.minY,
    graphBounds.maxX,
    graphBounds.maxY,
    graphBounds.width,
    graphBounds.height,
  ]) {
    expect(Number.isFinite(value)).toBe(true);
  }
  expect(graphBounds.width).toBeCloseTo(
    graphBounds.maxX - graphBounds.minX,
    10,
  );
  expect(graphBounds.height).toBeCloseTo(
    graphBounds.maxY - graphBounds.minY,
    10,
  );

  for (const node of pipeline.rendered.nodes) {
    for (const value of [
      node.layout.x,
      node.layout.y,
      node.layout.width,
      node.layout.height,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(node.layout.width).toBeGreaterThan(0);
    expect(node.layout.height).toBeGreaterThan(0);
    for (const port of node.ports) {
      expect(Number.isFinite(port.x)).toBe(true);
      expect(Number.isFinite(port.y)).toBe(true);
    }
  }

  for (const edge of pipeline.rendered.edges) {
    expect(edge.layout.path.length).toBeGreaterThan(0);
    expect(edge.layout.path).not.toMatch(/NaN|Infinity|undefined/);
    expect(Number.isFinite(edge.layout.labelX)).toBe(true);
    expect(Number.isFinite(edge.layout.labelY)).toBe(true);
  }

  for (const edge of pipeline.result.edges) {
    for (const section of edge.sections) {
      for (const point of sectionPoints(section)) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
      const routePoints = [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ];
      for (let index = 1; index < routePoints.length; index += 1) {
        const previous = routePoints[index - 1];
        const current = routePoints[index];
        expect(previous.x === current.x || previous.y === current.y).toBe(true);
      }
    }
  }
}

function assertBoundsContainNodesAndRoutes(result: LayoutResult): void {
  for (const node of result.nodes) {
    expectPointInBounds(node.position, result.bounds);
    expectPointInBounds(
      {
        x: node.position.x + node.width,
        y: node.position.y + node.height,
      },
      result.bounds,
    );
    for (const port of node.ports) {
      expectPointInBounds(port.position, result.bounds);
    }
  }

  for (const edge of result.edges) {
    for (const section of edge.sections) {
      for (const point of sectionPoints(section)) {
        expectPointInBounds(point, result.bounds);
      }
    }
  }
}

function assertRoutedEndpointsUseRequestedPorts(
  pipeline: FixturePipeline,
): void {
  const requestEdges = new Map(
    pipeline.request.edges.map((edge) => [edge.id, edge]),
  );
  const placedPorts = new Map(
    pipeline.result.nodes.flatMap((node) =>
      node.ports.map((port) => [port.id, port] as const),
    ),
  );

  expect(pipeline.result.edges).toHaveLength(pipeline.request.edges.length);
  for (const route of pipeline.result.edges) {
    const requestEdge = requestEdges.get(route.id);
    const sourcePortId = requestEdge?.layout.source.portId;
    const targetPortId = requestEdge?.layout.target.portId;
    if (!sourcePortId || !targetPortId || route.sections.length === 0) {
      throw new Error(`Missing routed endpoint metadata for ${route.id}.`);
    }
    const sourcePort = placedPorts.get(sourcePortId);
    const targetPort = placedPorts.get(targetPortId);
    if (!sourcePort || !targetPort) {
      throw new Error(`Missing placed endpoint port for ${route.id}.`);
    }

    expect(route.sections[0].startPoint).toEqual(sourcePort.position);
    expect(route.sections[route.sections.length - 1].endPoint).toEqual(
      targetPort.position,
    );
  }
}

function expectPointInBounds(point: LayoutPoint, bounds: LayoutBounds): void {
  const epsilon = 1e-9;
  expect(point.x).toBeGreaterThanOrEqual(bounds.minX - epsilon);
  expect(point.x).toBeLessThanOrEqual(bounds.maxX + epsilon);
  expect(point.y).toBeGreaterThanOrEqual(bounds.minY - epsilon);
  expect(point.y).toBeLessThanOrEqual(bounds.maxY + epsilon);
}

function sectionPoints(section: {
  startPoint: LayoutPoint;
  endPoint: LayoutPoint;
  bendPoints?: readonly LayoutPoint[];
  junctionPoints?: readonly LayoutPoint[];
}): LayoutPoint[] {
  return [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint,
    ...(section.junctionPoints ?? []),
  ];
}

function routeSignature(route: LayoutResult['edges'][number]): string {
  return JSON.stringify(
    route.sections.map((section) => [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ]),
  );
}

function nodeByLabel(graph: DiagramGraph, label: string): DiagramNode {
  const node = graph.nodes.find((candidate) => candidate.label === label);
  if (!node) throw new Error(`Missing fixture node ${label}.`);
  return node;
}

function columnByName(node: DiagramNode, name: string): DiagramColumn {
  const column = node.columns.find((candidate) => candidate.name === name);
  if (!column) throw new Error(`Missing fixture column ${node.label}.${name}.`);
  return column;
}
