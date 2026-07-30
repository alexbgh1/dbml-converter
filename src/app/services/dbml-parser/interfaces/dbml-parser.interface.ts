export enum ReferentialAction {
  Cascade = 'CASCADE',
  SetNull = 'SET NULL',
  NoAction = 'NO ACTION',
  Restrict = 'RESTRICT',
}

export enum Cardinality {
  One = 'one',
  Many = 'many',
}

export enum RelationOperator {
  OneToOne = '-',
  OneToMany = '<',
  ManyToOne = '>',
  ManyToMany = '<>',
}

export interface RelationCardinality {
  readonly from: Cardinality;
  readonly to: Cardinality;
}

export const CARDINALITY_MAP: Readonly<
  Record<RelationOperator, RelationCardinality>
> = {
  [RelationOperator.ManyToOne]: {
    from: Cardinality.Many,
    to: Cardinality.One,
  },
  [RelationOperator.OneToMany]: {
    from: Cardinality.One,
    to: Cardinality.Many,
  },
  [RelationOperator.ManyToMany]: {
    from: Cardinality.Many,
    to: Cardinality.Many,
  },
  [RelationOperator.OneToOne]: {
    from: Cardinality.One,
    to: Cardinality.One,
  },
};

/* Reference to another column in a relation */
export interface ColumnRef {
  table: string;
  column: string;
  cardinality?: RelationCardinality;
  /* Optional actions for referential integrity */
  onUpdate?: ReferentialAction;
  onDelete?: ReferentialAction;
}

/* Column definition from DBML */
export interface Column {
  name: string;
  type: string;

  /* Primary key flag */
  pk?: boolean;

  /* Unique constraint */
  unique?: boolean;

  /* Whether NULL is allowed */
  nullable?: boolean;

  /* Optional note attached to the column */
  note?: string;

  /* Foreign key reference */
  ref?: ColumnRef;

  /* Default value (could be literal) */
  default?: string | number | boolean;

  /* True when the default is a DB expression (e.g. `now()`), not a literal */
  isExpression?: boolean;

  /* Auto-increment / identity column */
  increment?: boolean;

  /* 1-based line in the DBML source (diagnostics navigation); stripped from JSON output */
  sourceLine?: number;
}

/* Entry of a table-level "indexes { ... }" block */
export interface TableIndex {
  columns: string[];
  unique?: boolean;
  pk?: boolean;
  name?: string;
}

/* DBML "Enum name { ... }" definition */
export interface EnumDef {
  name: string;
  values: string[];

  /* 1-based declaration/value lines; parser bookkeeping, stripped from JSON output */
  sourceLine?: number;
  valueSourceLines?: number[];
}

export interface Table {
  name: string;
  alias: string | null;
  columns: Column[];

  /* Table created (or completed) as a many-to-many junction table */
  isJunction?: boolean;

  /* Table-level note */
  note?: string;

  /* Composite indexes declared in an "indexes { }" block */
  indexes?: TableIndex[];

  /* 1-based line in the DBML source (diagnostics navigation); stripped from JSON output */
  sourceLine?: number;
}

/* Relation definition between tables */
export interface Relation {
  from: { table: string; column: string };
  to: { table: string; column: string };
  cardinality: RelationCardinality;

  /* Optional actions for referential integrity */
  onUpdate?: ReferentialAction;
  onDelete?: ReferentialAction;

  /* 1-based line of the Ref (or inline ref) in the DBML source */
  sourceLine?: number;
}

/* Global schema definition */
export interface DatabaseSchema {
  tables: Table[];
  relations: Relation[];

  /* Enum definitions */
  enums?: EnumDef[];

  /* Optional metadata (e.g., database engine, version, etc.) */
  metadata?: Record<string, any>;
}
