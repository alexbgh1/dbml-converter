export const COLUMN_ATTRIBUTES = {
  PrimaryKey: ['pk', 'primary key'],
  Unique: ['unique'],
  NotNull: ['not null', 'nn'],
  Nullable: ['null'],
  Increment: ['increment', 'auto_increment', 'identity'],
} as const;
/*
  Normalized type families with EXACT alias lists (never substring matching:
  'point' contains 'int' but is not an integer). Input is the lowercase base
  type from parseDbType(), i.e. without (args).
*/
export type TypeFamily =
  | 'integer'
  | 'float'
  | 'decimal'
  | 'string'
  | 'uuid'
  | 'boolean'
  | 'date'
  | 'json';

export const TYPE_FAMILIES: Record<TypeFamily, readonly string[]> = {
  integer: [
    'int',
    'integer',
    'int2',
    'int4',
    'int8',
    'smallint',
    'mediumint',
    'tinyint',
    'bigint',
    'serial',
    'smallserial',
    'bigserial',
  ],
  float: ['float', 'float4', 'float8', 'double', 'real'],
  decimal: ['decimal', 'numeric', 'money'],
  string: [
    'varchar',
    'char',
    'character',
    'nvarchar',
    'nchar',
    'text',
    'tinytext',
    'mediumtext',
    'longtext',
    'citext',
    'string',
  ],
  uuid: ['uuid', 'uniqueidentifier'],
  boolean: ['bool', 'boolean', 'bit'],
  date: [
    'date',
    'datetime',
    'datetime2',
    'timestamp',
    'timestamptz',
    'time',
    'timetz',
  ],
  json: ['json', 'jsonb'],
} as const;
