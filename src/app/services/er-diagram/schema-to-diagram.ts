import {
  CARDINALITY_MAP,
  Cardinality,
  DatabaseSchema,
  Relation,
  RelationOperator,
  Table,
} from '../dbml-parser/interfaces/dbml-parser.interface';
import {
  DiagramColumn,
  DiagramColumnBadge,
  DiagramEdge,
  DiagramEdgeEndpoint,
  DiagramGraph,
  DiagramNode,
  DiagramPort,
  DiagramPortSide,
} from './er-diagram.interface';
import { ER_DIAGRAM_CARD_GEOMETRY } from './er-diagram-card-geometry';

const GAP_X = 150;
const GAP_Y = 100;
const PADDING = 60;

interface NodeRecord {
  node: DiagramNode;
  columnsByName: Map<string, DiagramColumn>;
  portsById: Map<string, DiagramPort>;
}

export function schemaToDiagram(schema: DatabaseSchema): DiagramGraph {
  if (!schema.tables.length) {
    const layout = {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    };
    return { nodes: [], edges: [], layout };
  }

  const relations = relationsForDiagram(schema);
  const columnsPerRow = Math.min(4, Math.ceil(Math.sqrt(schema.tables.length)));
  const rowHeights: number[] = [];
  const tableOccurrences = new Map<string, number>();
  const foreignKeys = relationForeignKeys(relations);
  const recordsByTableName = new Map<string, NodeRecord>();

  const records: NodeRecord[] = schema.tables.map((table, index) => {
    const tableOccurrence = nextOccurrence(tableOccurrences, table.name);
    const nodeId = opaqueId('node', table.name, String(tableOccurrence));
    const columnOccurrences = new Map<string, number>();
    const columnsByName = new Map<string, DiagramColumn>();
    const portsById = new Map<string, DiagramPort>();
    const ports: DiagramPort[] = [];

    const columns = table.columns.map((column, columnIndex) => {
      const columnOccurrence = nextOccurrence(columnOccurrences, column.name);
      const columnId = opaqueId(
        'column',
        nodeId,
        column.name,
        String(columnOccurrence),
      );
      const primaryKey =
        column.pk === true ||
        !!table.indexes?.some(
          (tableIndex) =>
            tableIndex.pk === true && tableIndex.columns.includes(column.name),
        );
      const nullable = primaryKey ? false : (column.nullable ?? null);
      const unique = isIndividuallyUnique(table, column.name, column.unique);
      const foreignKey =
        column.ref !== undefined ||
        (foreignKeys.get(table.name)?.has(column.name) ?? false);
      const row = {
        index: columnIndex,
        y:
          ER_DIAGRAM_CARD_GEOMETRY.headerHeight +
          columnIndex * ER_DIAGRAM_CARD_GEOMETRY.rowHeight,
        height: ER_DIAGRAM_CARD_GEOMETRY.rowHeight,
        centerY:
          ER_DIAGRAM_CARD_GEOMETRY.headerHeight +
          columnIndex * ER_DIAGRAM_CARD_GEOMETRY.rowHeight +
          ER_DIAGRAM_CARD_GEOMETRY.rowHeight / 2,
      };
      const portIds = {
        west: opaqueId('port', columnId, 'west'),
        east: opaqueId('port', columnId, 'east'),
      };
      const diagramColumn: DiagramColumn = {
        id: columnId,
        name: column.name,
        type: column.type,
        nullable,
        badges: columnBadges(primaryKey, foreignKey, unique, nullable),
        row,
        portIds,
        sourceLine: column.sourceLine,
      };

      const westPort = makePort(
        portIds.west,
        nodeId,
        columnId,
        'west',
        columnIndex,
        row.centerY,
      );
      const eastPort = makePort(
        portIds.east,
        nodeId,
        columnId,
        'east',
        columnIndex,
        row.centerY,
      );
      ports.push(westPort, eastPort);
      portsById.set(westPort.id, westPort);
      portsById.set(eastPort.id, eastPort);

      // Invalid duplicate columns are diagnosed elsewhere. Relations resolve to
      // the first declaration just as the rest of the schema pipeline does.
      if (!columnsByName.has(column.name)) {
        columnsByName.set(column.name, diagramColumn);
      }
      return diagramColumn;
    });

    const height =
      ER_DIAGRAM_CARD_GEOMETRY.headerHeight +
      Math.max(
        ER_DIAGRAM_CARD_GEOMETRY.emptyBodyHeight,
        table.columns.length * ER_DIAGRAM_CARD_GEOMETRY.rowHeight,
      );
    const rowIndex = Math.floor(index / columnsPerRow);
    rowHeights[rowIndex] = Math.max(rowHeights[rowIndex] ?? 0, height);
    const layout = {
      x: 0,
      y: 0,
      width: ER_DIAGRAM_CARD_GEOMETRY.width,
      height,
    };
    const node: DiagramNode = {
      id: nodeId,
      label: table.name,
      alias: table.alias,
      isJunction: table.isJunction === true,
      sourceLine: table.sourceLine,
      columns,
      ports,
      layout,
    };
    const record = { node, columnsByName, portsById };
    if (!recordsByTableName.has(table.name)) {
      recordsByTableName.set(table.name, record);
    }
    return record;
  });

  const rowOffsets: number[] = [];
  let currentY = PADDING;
  for (const rowHeight of rowHeights) {
    rowOffsets.push(currentY);
    currentY += rowHeight + GAP_Y;
  }

  records.forEach(({ node }, index) => {
    const column = index % columnsPerRow;
    const row = Math.floor(index / columnsPerRow);
    const x = PADDING + column * (ER_DIAGRAM_CARD_GEOMETRY.width + GAP_X);
    const y = rowOffsets[row];
    node.layout = { ...node.layout, x, y };
  });

  const edgeOccurrences = new Map<string, number>();
  const selfRelationLanes = new Map<string, number>();
  const pairLanes = new Map<string, number>();
  const edges = relations.flatMap<DiagramEdge>((relation) => {
    const fromRecord = recordsByTableName.get(relation.from.table);
    const toRecord = recordsByTableName.get(relation.to.table);
    const fromColumn = fromRecord?.columnsByName.get(relation.from.column);
    const toColumn = toRecord?.columnsByName.get(relation.to.column);

    // Diagnostics own malformed references. One invalid relation must not make
    // otherwise valid nodes or edges disappear.
    if (!fromRecord || !toRecord || !fromColumn || !toColumn) return [];

    const selfRelation = fromRecord.node.id === toRecord.node.id;
    const fromSide = endpointSide(
      fromRecord.node,
      toRecord.node,
      true,
      selfRelation,
    );
    const toSide = endpointSide(
      fromRecord.node,
      toRecord.node,
      false,
      selfRelation,
    );
    const fromPortId = fromColumn.portIds[fromSide];
    const toPortId = toColumn.portIds[toSide];
    const fromPort = fromRecord.portsById.get(fromPortId);
    const toPort = toRecord.portsById.get(toPortId);
    if (!fromPort || !toPort) return [];

    const relationSignature = opaqueId(
      'relation-signature',
      fromRecord.node.id,
      fromColumn.id,
      toRecord.node.id,
      toColumn.id,
      relation.cardinality.from,
      relation.cardinality.to,
    );
    const occurrence = nextOccurrence(edgeOccurrences, relationSignature);
    const edgeId = opaqueId('edge', relationSignature, String(occurrence));
    const laneKey = selfRelation
      ? fromRecord.node.id
      : opaqueId('node-pair', ...[fromRecord.node.id, toRecord.node.id].sort());
    const lane = nextOccurrence(
      selfRelation ? selfRelationLanes : pairLanes,
      laneKey,
    );
    const geometry = edgeEndpoints(
      fromRecord.node,
      toRecord.node,
      fromPort,
      toPort,
      lane,
      selfRelation,
    );
    const cardinality = cardinalityLabel(
      relation.cardinality.from,
      relation.cardinality.to,
    );
    // The grid fallback path follows immutable DBML from -> to semantics. ELK
    // may later reverse only this routed orientation to place parents first.
    const layout = {
      sourceNodeId: fromRecord.node.id,
      sourcePortId: fromPortId,
      targetNodeId: toRecord.node.id,
      targetPortId: toPortId,
      renderCardinality: cardinality,
      ...geometry,
    };
    const peerRelation =
      relation.cardinality.from === Cardinality.Many &&
      relation.cardinality.to === Cardinality.Many;
    const fromEndpoint = makeEndpoint(
      fromRecord.node,
      fromColumn,
      relation.cardinality.from,
      peerRelation ? 'peer' : 'foreign-key',
    );
    const toEndpoint = makeEndpoint(
      toRecord.node,
      toColumn,
      relation.cardinality.to,
      peerRelation ? 'peer' : 'referenced',
    );

    return [
      {
        id: edgeId,
        fromNode: fromRecord.node.id,
        toNode: toRecord.node.id,
        fromColumnId: fromColumn.id,
        toColumnId: toColumn.id,
        fromColumn: relation.from.column,
        toColumn: relation.to.column,
        fromEndpoint,
        toEndpoint,
        cardinality,
        onUpdate: relation.onUpdate,
        onDelete: relation.onDelete,
        sourceLine: relation.sourceLine,
        selfRelation,
        layout,
      },
    ];
  });

  const usedColumns = Math.min(columnsPerRow, records.length);
  const width =
    PADDING * 2 +
    usedColumns * ER_DIAGRAM_CARD_GEOMETRY.width +
    Math.max(0, usedColumns - 1) * GAP_X;
  const height = currentY - GAP_Y + PADDING;
  const layout = {
    minX: 0,
    minY: 0,
    maxX: width,
    maxY: height,
    width,
    height,
  };
  return { nodes: records.map(({ node }) => node), edges, layout };
}

function relationsForDiagram(schema: DatabaseSchema): Relation[] {
  const directRelations = schema.relations.filter(
    (relation) =>
      !isManyToMany(relation) ||
      !relationIsRepresentedByJunction(schema.tables, relation),
  );
  const knownRelations = new Set(schema.relations.map(relationIdentity));
  const junctionRelations: Relation[] = [];

  for (const table of schema.tables) {
    if (table.isJunction !== true) continue;

    for (const column of table.columns) {
      if (!column.ref) continue;

      const relation: Relation = {
        from: { table: table.name, column: column.name },
        to: { table: column.ref.table, column: column.ref.column },
        cardinality:
          column.ref.cardinality ?? CARDINALITY_MAP[RelationOperator.ManyToOne],
        onUpdate: column.ref.onUpdate,
        onDelete: column.ref.onDelete,
        sourceLine: column.sourceLine ?? table.sourceLine,
      };
      const identity = relationIdentity(relation);
      if (knownRelations.has(identity)) continue;

      knownRelations.add(identity);
      junctionRelations.push(relation);
    }
  }

  return [...directRelations, ...junctionRelations];
}

function relationIsRepresentedByJunction(
  tables: readonly Table[],
  relation: Relation,
): boolean {
  return tables.some((table) => {
    if (table.isJunction !== true) return false;

    const endpoints = table.columns.flatMap((column, index) =>
      column.ref
        ? [
            {
              index,
              table: column.ref.table,
              column: column.ref.column,
            },
          ]
        : [],
    );
    return endpoints.some(
      (from) =>
        endpointMatches(from, relation.from) &&
        endpoints.some(
          (to) => to.index !== from.index && endpointMatches(to, relation.to),
        ),
    );
  });
}

function endpointMatches(
  left: { readonly table: string; readonly column: string },
  right: { readonly table: string; readonly column: string },
): boolean {
  return left.table === right.table && left.column === right.column;
}

function relationIdentity(relation: Relation): string {
  return opaqueId(
    'diagram-relation',
    relation.from.table,
    relation.from.column,
    relation.to.table,
    relation.to.column,
    relation.cardinality.from,
    relation.cardinality.to,
  );
}

function isManyToMany(relation: Relation): boolean {
  return (
    relation.cardinality.from === Cardinality.Many &&
    relation.cardinality.to === Cardinality.Many
  );
}

function relationForeignKeys(relations: Relation[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const relation of relations) {
    // A direct N:N relation has peer endpoints; neither original column is an FK.
    if (
      relation.cardinality.from === Cardinality.Many &&
      relation.cardinality.to === Cardinality.Many
    ) {
      continue;
    }
    let columns = result.get(relation.from.table);
    if (!columns) {
      columns = new Set<string>();
      result.set(relation.from.table, columns);
    }
    columns.add(relation.from.column);
  }
  return result;
}

function isIndividuallyUnique(
  table: Table,
  columnName: string,
  inlineUnique: boolean | undefined,
): boolean {
  return (
    inlineUnique === true ||
    !!table.indexes?.some(
      (index) =>
        index.unique === true &&
        index.columns.length === 1 &&
        index.columns[0] === columnName,
    )
  );
}

function columnBadges(
  primaryKey: boolean,
  foreignKey: boolean,
  unique: boolean,
  nullable: boolean | null,
): DiagramColumnBadge[] {
  const badges: DiagramColumnBadge[] = [];
  if (primaryKey) badges.push('PK');
  if (foreignKey) badges.push('FK');
  if (unique) badges.push('UQ');
  if (!primaryKey && nullable === false) badges.push('NN');
  return badges;
}

function makePort(
  id: string,
  nodeId: string,
  columnId: string,
  side: DiagramPortSide,
  order: number,
  y: number,
): DiagramPort {
  return {
    id,
    nodeId,
    columnId,
    side,
    order,
    x: side === 'west' ? 0 : ER_DIAGRAM_CARD_GEOMETRY.width,
    y,
  };
}

function makeEndpoint(
  node: DiagramNode,
  column: DiagramColumn,
  cardinality: Cardinality,
  role: DiagramEdgeEndpoint['role'],
): DiagramEdgeEndpoint {
  return {
    nodeId: node.id,
    nodeName: node.label,
    columnId: column.id,
    columnName: column.name,
    portIds: column.portIds,
    cardinality,
    role,
    nullable: column.nullable,
  };
}

function endpointSide(
  from: DiagramNode,
  to: DiagramNode,
  isFrom: boolean,
  selfRelation: boolean,
): DiagramPortSide {
  if (selfRelation) return 'east';
  const fromIsLeft = from.layout.x <= to.layout.x;
  if (isFrom) return fromIsLeft ? 'east' : 'west';
  return fromIsLeft ? 'west' : 'east';
}

function edgeEndpoints(
  from: DiagramNode,
  to: DiagramNode,
  fromPort: DiagramPort,
  toPort: DiagramPort,
  lane: number,
  selfRelation: boolean,
): { path: string; labelX: number; labelY: number } {
  const startX = from.layout.x + fromPort.x;
  const startY = from.layout.y + fromPort.y;
  const endX = to.layout.x + toPort.x;
  const endY = to.layout.y + toPort.y;

  if (selfRelation) {
    const clearance = 70 + lane * 18;
    const sameAnchor = startX === endX && startY === endY;
    const firstControlY = sameAnchor ? startY - 44 : startY;
    const secondControlY = sameAnchor ? endY + 44 : endY;
    return {
      path: `M ${startX} ${startY} C ${startX + clearance} ${firstControlY}, ${endX + clearance} ${secondControlY}, ${endX} ${endY}`,
      labelX: Math.max(startX, endX) + clearance,
      labelY: (startY + endY) / 2 - 8,
    };
  }

  const direction = startX <= endX ? 1 : -1;
  const control = Math.max(60, Math.abs(endX - startX) / 2);
  // Parallel edges keep their exact row anchors; only their interior lane moves.
  const laneOffset =
    lane === 0 ? 0 : Math.ceil(lane / 2) * (lane % 2 ? 10 : -10);
  const control1 = startX + direction * control;
  const control2 = endX - direction * control;

  return {
    path: `M ${startX} ${startY} C ${control1} ${startY + laneOffset}, ${control2} ${endY + laneOffset}, ${endX} ${endY}`,
    labelX: (startX + endX) / 2,
    labelY: (startY + endY) / 2 + laneOffset - 8,
  };
}

function cardinalityLabel(
  from: Cardinality,
  to: Cardinality,
): DiagramEdge['cardinality'] {
  const left = from === Cardinality.Many ? 'N' : '1';
  const right = to === Cardinality.Many ? 'N' : '1';
  return `${left}:${right}` as DiagramEdge['cardinality'];
}

function nextOccurrence(counts: Map<string, number>, key: string): number {
  const occurrence = counts.get(key) ?? 0;
  counts.set(key, occurrence + 1);
  return occurrence;
}

/** Length-prefixing makes every valid DBML name collision-safe without escaping. */
function opaqueId(kind: string, ...parts: string[]): string {
  return `er-${kind}-${parts.map((part) => `${part.length}:${part}`).join('')}`;
}
