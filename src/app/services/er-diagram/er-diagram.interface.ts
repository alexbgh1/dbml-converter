import type { ReferentialAction } from '../dbml-parser/interfaces/dbml-parser.interface';

export type DiagramColumnBadge = 'PK' | 'FK' | 'UQ' | 'NN';

export type DiagramPortSide = 'west' | 'east';

export type DiagramEndpointCardinality = 'one' | 'many';

export type DiagramEndpointRole = 'foreign-key' | 'referenced' | 'peer';

export type DiagramCardinality = '1:1' | '1:N' | 'N:1' | 'N:N';

export interface DiagramColumnPortIds {
  west: string;
  east: string;
}

/** Geometry relative to the top-left corner of the table card. */
export interface DiagramColumnRow {
  index: number;
  y: number;
  height: number;
  centerY: number;
}

/**
 * A stable layout input port. `x` and `y` are offsets relative to the node,
 * so moving a node never mutates schema-derived port data.
 */
export interface DiagramPort {
  id: string;
  nodeId: string;
  columnId: string;
  side: DiagramPortSide;
  order: number;
  x: number;
  y: number;
}

export interface DiagramColumn {
  /** Opaque and deterministic; consumers must not parse schema names from it. */
  id: string;
  name: string;
  type: string;
  /** `null` means the input model did not provide nullability metadata. */
  nullable: boolean | null;
  /** Stable display order: PK, FK, UQ, NN. */
  badges: DiagramColumnBadge[];
  row: DiagramColumnRow;
  portIds: DiagramColumnPortIds;
  sourceLine?: number;
}

/** Position and measured card dimensions used by the current grid fallback. */
export interface DiagramNodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramNode {
  /** Opaque and deterministic; table identity is available separately as `label`. */
  id: string;
  label: string;
  alias: string | null;
  isJunction: boolean;
  sourceLine?: number;
  columns: DiagramColumn[];
  ports: DiagramPort[];
  layout: DiagramNodeLayout;
}

export interface DiagramEdgeEndpoint {
  nodeId: string;
  nodeName: string;
  columnId: string;
  columnName: string;
  portIds: DiagramColumnPortIds;
  cardinality: DiagramEndpointCardinality;
  role: DiagramEndpointRole;
  nullable: boolean | null;
}

/** Routed geometry is intentionally separate from immutable relation semantics. */
export interface DiagramEdgeLayout {
  /** First endpoint in the actual SVG path direction. */
  sourceNodeId: string;
  sourcePortId: string | null;
  /** Last endpoint in the actual SVG path direction. */
  targetNodeId: string;
  targetPortId: string | null;
  /** Cardinality ordered source-to-target in the actual SVG path direction. */
  renderCardinality: DiagramCardinality;
  path: string;
  labelX: number;
  labelY: number;
}

export interface DiagramEdge {
  /** Opaque and deterministic, including for parallel equivalent relations. */
  id: string;
  /** Opaque node IDs, not table names. */
  fromNode: string;
  toNode: string;
  fromColumnId: string;
  toColumnId: string;
  /** Schema names retained for source navigation and display compatibility. */
  fromColumn: string;
  toColumn: string;
  fromEndpoint: DiagramEdgeEndpoint;
  toEndpoint: DiagramEdgeEndpoint;
  /** Cardinality in immutable DBML `from` -> `to` order. */
  cardinality: DiagramCardinality;
  onUpdate?: ReferentialAction;
  onDelete?: ReferentialAction;
  sourceLine?: number;
  selfRelation: boolean;
  layout: DiagramEdgeLayout;
}

export interface DiagramGraphLayout {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface DiagramGraph {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  layout: DiagramGraphLayout;
}
