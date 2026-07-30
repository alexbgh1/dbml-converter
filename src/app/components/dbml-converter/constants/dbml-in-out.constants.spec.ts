import { describe, expect, it } from 'vitest';

import {
  DATABASE_FILE,
  DBML_INPUT_FILE,
  JSON_FILE,
  PRISMA_SCHEMA_FILE,
} from './dbml-in-out.constants';

describe('conversion file descriptors', () => {
  it('keeps every semantic file identity stable', () => {
    expect(DBML_INPUT_FILE).toEqual({
      id: 'input-dbml',
      filename: 'input.dbml',
    });
    expect(JSON_FILE).toEqual({ id: 'schema-json', filename: 'schema.json' });
    expect(PRISMA_SCHEMA_FILE).toEqual({
      id: 'schema-prisma',
      filename: 'schema.prisma',
    });
    expect(DATABASE_FILE).toEqual({
      id: 'database-module',
      filename: 'database.module.ts',
    });
  });
});
