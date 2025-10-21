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

//   if (type.includes('int')) return 'int';
// if (type.includes('varchar') || type.includes('char')) return 'varchar';
// if (type.includes('text')) return 'text';
// if (type.includes('date')) return 'date';
// if (type.includes('time') && type.includes('stamp')) return 'timestamp';
// if (type.includes('time')) return 'time';
// if (type.includes('bool')) return 'boolean';
// if (type.includes('float') || type.includes('double')) return 'float';
// if (type.includes('decimal')) return 'decimal';
// if (type.includes('json')) return 'json';
