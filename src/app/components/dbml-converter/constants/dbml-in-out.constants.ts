export const INPUT = 'input';
export const OUTPUT = 'output';

export const DBML_INPUT_FILE = {
  id: 'input-dbml',
  filename: 'input.dbml',
} as const;

export const JSON_FILE = {
  id: 'schema-json',
  filename: 'schema.json',
} as const;

export const PRISMA_SCHEMA_FILE = {
  id: 'schema-prisma',
  filename: 'schema.prisma',
} as const;

export const DATABASE_FILE = {
  id: 'database-module',
  filename: 'database.module.ts',
} as const;
