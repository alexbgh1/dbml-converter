import { COLUMN_ATTRIBUTES } from '../constants';

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

export const CARDINALITY_MAP: Record<
  RelationOperator,
  { from: Cardinality; to: Cardinality }
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

export type ColumnAttribute =
  (typeof COLUMN_ATTRIBUTES)[keyof typeof COLUMN_ATTRIBUTES][number];

/* Reference to another column in a relation */
export interface ColumnRef {
  table: string;
  column: string;
  cardinality?: {
    from: Cardinality;
    to: Cardinality;
  };
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

  /* Auto-increment / identity column */
  increment?: boolean;
}

export interface Table {
  name: string;
  alias: string | null;
  columns: Column[];
}

/* Relation definition between tables */
export interface Relation {
  from: { table: string; column: string };
  to: { table: string; column: string };
  cardinality: {
    from: Cardinality;
    to: Cardinality;
  };

  /* Optional actions for referential integrity */
  onUpdate?: 'CASCADE' | 'SET NULL' | 'NO ACTION' | 'RESTRICT';
  onDelete?: 'CASCADE' | 'SET NULL' | 'NO ACTION' | 'RESTRICT';
}

/* Global schema definition */
export interface DatabaseSchema {
  tables: Table[];
  relations: Relation[];

  /* Optional metadata (e.g., database engine, version, etc.) */
  metadata?: Record<string, any>;
}
