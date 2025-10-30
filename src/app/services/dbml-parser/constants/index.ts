import { Cardinality } from '../interfaces/dbml-parser.interface';

export const COLUMN_ATTRIBUTES = {
  PrimaryKey: ['pk', 'primary key'],
  Unique: ['unique'],
  NotNull: ['not null', 'nn'],
  Increment: ['increment', 'auto_increment', 'identity'],
} as const;

export const DATA_TYPES = {
  Integer: ['int', 'integer', 'bigint', 'smallint', 'tinyint'],
  String: ['varchar', 'char', 'text', 'string'],
  Date: ['date', 'datetime', 'timestamp', 'time'],
  Boolean: ['bool', 'boolean'],
  Float: ['float', 'double', 'decimal', 'real'],
  Json: ['json', 'jsonb'],
} as const;

export const DEFAULT_CARDINALITY = {
  from: Cardinality.One,
  to: Cardinality.One,
};

/*
  Special handle col names for better default value mapping
*/
export const CREATED_AT_FIELDS = ['created_at', 'createdat', 'creation_date'];
export const UPDATED_AT_FIELDS = [
  'updated_at',
  'updatedat',
  'modification_date',
];
export const DELETED_AT_FIELDS = ['deleted_at', 'deletedat', 'deletion_date'];
export const TIME_FIELD = ['time', 'timestamp', 'timestamptz', 'datetime'];
