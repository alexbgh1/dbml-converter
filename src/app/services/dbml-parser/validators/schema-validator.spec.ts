import { describe, expect, it } from 'vitest';

import { validateSchema } from './schema-validator';
import {
  Cardinality,
  DatabaseSchema,
} from '../interfaces/dbml-parser.interface';

const MANY_TO_ONE = { from: Cardinality.Many, to: Cardinality.One };

function table(
  name: string,
  columns: { name: string; type: string; ref?: any }[],
  extra: Partial<DatabaseSchema['tables'][number]> = {},
) {
  return { name, alias: null, columns, ...extra };
}

describe('validateSchema', () => {
  it('should return no diagnostics for a consistent schema', () => {
    const schema: DatabaseSchema = {
      tables: [
        table('users', [{ name: 'id', type: 'int' }]),
        table('posts', [
          { name: 'id', type: 'int' },
          {
            name: 'user_id',
            type: 'int',
            ref: { table: 'users', column: 'id', cardinality: MANY_TO_ONE },
          },
        ]),
      ],
      relations: [
        {
          from: { table: 'posts', column: 'user_id' },
          to: { table: 'users', column: 'id' },
          cardinality: MANY_TO_ONE,
        },
      ],
    };

    expect(validateSchema(schema)).toEqual([]);
  });

  it('should report duplicate tables', () => {
    const schema: DatabaseSchema = {
      tables: [
        table('users', [{ name: 'id', type: 'int' }]),
        table('users', [{ name: 'email', type: 'varchar' }]),
      ],
      relations: [],
    };

    const codes = validateSchema(schema).map((d) => d.code);
    expect(codes).toContain('SCHEMA_DUPLICATE_TABLE');
  });

  it('should report duplicate columns with their index', () => {
    const schema: DatabaseSchema = {
      tables: [
        table('users', [
          { name: 'email', type: 'varchar' },
          { name: 'email', type: 'text' },
        ]),
      ],
      relations: [],
    };

    const duplicate = validateSchema(schema).find(
      (d) => d.code === 'SCHEMA_DUPLICATE_COLUMN',
    );
    expect(duplicate).toBeTruthy();
    expect(duplicate?.details?.['columnIndex']).toBe(1);
  });

  it('should report unknown reference tables', () => {
    const schema: DatabaseSchema = {
      tables: [
        table('orders', [
          {
            name: 'customer_id',
            type: 'uuid',
            ref: {
              table: 'customers',
              column: 'id',
              cardinality: MANY_TO_ONE,
            },
          },
        ]),
      ],
      relations: [],
    };
    const unknown = validateSchema(schema).find(
      (d) => d.code === 'SCHEMA_UNKNOWN_REFERENCE_TABLE',
    );
    expect(unknown).toBeTruthy();
    expect(unknown?.severity).toBe('error');
  });

  it('should report unknown reference columns with candidates', () => {
    const schema: DatabaseSchema = {
      tables: [
        table('customers', [{ name: 'customer_uuid', type: 'uuid' }]),
        table('orders', [
          {
            name: 'customer_id',
            type: 'uuid',
            ref: {
              table: 'customers',
              column: 'id',
              cardinality: MANY_TO_ONE,
            },
          },
        ]),
      ],
      relations: [],
    };
    schema.tables[1].columns[0].sourceLine = 6;

    const unknown = validateSchema(schema).find(
      (d) => d.code === 'SCHEMA_UNKNOWN_REFERENCE_COLUMN',
    );
    expect(unknown).toBeTruthy();
    expect(unknown?.suggestion).toContain('customers.customer_uuid');
    expect(unknown?.details?.['availableTargetColumns']).toEqual([
      'customer_uuid',
    ]);
    expect(unknown?.repairs).toEqual([
      expect.objectContaining({
        kind: 'replace-reference-target',
        expectedText: 'customers.id',
        replacementText: 'customers.customer_uuid',
      }),
    ]);
  });

  it('should expose each available reference target as an explicit repair choice', () => {
    const schema: DatabaseSchema = {
      tables: [
        table('customers', [
          { name: 'id', type: 'uuid' },
          { name: 'legacy_id', type: 'uuid' },
        ]),
        table('orders', [
          {
            name: 'customer_id',
            type: 'uuid',
            ref: { table: 'customers', column: 'missing' },
          },
        ]),
      ],
      relations: [],
    };
    schema.tables[1].columns[0].sourceLine = 7;

    const diagnostic = validateSchema(schema).find(
      (d) => d.code === 'SCHEMA_UNKNOWN_REFERENCE_COLUMN',
    );
    expect(
      diagnostic?.repairs?.map((repair) => repair.replacementText),
    ).toEqual(['customers.id', 'customers.legacy_id']);
  });

  it('should report indexes over missing columns', () => {
    const schema: DatabaseSchema = {
      tables: [
        table('users', [{ name: 'id', type: 'int' }], {
          indexes: [{ columns: ['id', 'missing_col'] }],
        }),
      ],
      relations: [],
    };

    const codes = validateSchema(schema).map((d) => d.code);
    expect(codes).toContain('SCHEMA_UNKNOWN_INDEX_COLUMN');
  });

  it('should warn on FK/target type family mismatch', () => {
    const schema: DatabaseSchema = {
      tables: [
        table('users', [{ name: 'id', type: 'uuid' }]),
        table('orders', [
          {
            name: 'user_id',
            type: 'int',
            ref: { table: 'users', column: 'id', cardinality: MANY_TO_ONE },
          },
        ]),
      ],
      relations: [],
    };
    schema.tables[1].columns[0].sourceLine = 6;

    const mismatch = validateSchema(schema).find(
      (d) => d.code === 'SCHEMA_REFERENCE_TYPE_MISMATCH',
    );
    expect(mismatch).toBeTruthy();
    expect(mismatch?.severity).toBe('warning');
    expect(mismatch?.message).toContain('users.id');
    expect(mismatch?.repairs?.[0]).toEqual(
      expect.objectContaining({
        kind: 'change-column-type',
        expectedText: 'user_id int',
        replacementText: 'user_id uuid',
      }),
    );
  });

  it('should treat compatible integer aliases as matching', () => {
    const schema: DatabaseSchema = {
      tables: [
        table('users', [{ name: 'id', type: 'bigint' }]),
        table('orders', [
          {
            name: 'user_id',
            type: 'int',
            ref: { table: 'users', column: 'id', cardinality: MANY_TO_ONE },
          },
        ]),
      ],
      relations: [],
    };

    const codes = validateSchema(schema).map((d) => d.code);
    expect(codes).not.toContain('SCHEMA_REFERENCE_TYPE_MISMATCH');
  });

  it('should report duplicate enum names and values case-sensitively', () => {
    const schema: DatabaseSchema = {
      tables: [],
      relations: [],
      enums: [
        {
          name: 'status',
          values: ['pending', 'pending', 'Pending'],
          sourceLine: 1,
          valueSourceLines: [2, 3, 4],
        },
        { name: 'status', values: ['active'], sourceLine: 6 },
        { name: 'Status', values: ['active'], sourceLine: 9 },
      ],
    };

    const diagnostics = validateSchema(schema);
    expect(
      diagnostics.filter((d) => d.code === 'SCHEMA_DUPLICATE_ENUM'),
    ).toHaveLength(1);
    const duplicateValue = diagnostics.find(
      (d) => d.code === 'SCHEMA_DUPLICATE_ENUM_VALUE',
    );
    expect(duplicateValue?.line).toBe(3);
    expect(duplicateValue?.details?.['caseSensitive']).toBe(true);
  });

  it('should validate enum type casing and literal defaults', () => {
    const schema: DatabaseSchema = {
      tables: [
        table('orders', [
          { name: 'status', type: 'order_status' },
          { name: 'legacy_status', type: 'Order_Status' },
        ]),
      ],
      relations: [],
      enums: [{ name: 'order_status', values: ['pending', 'active'] }],
    };
    schema.tables[0].columns[0].default = 'archived';

    const diagnostics = validateSchema(schema);
    const invalidDefault = diagnostics.find(
      (d) => d.code === 'SCHEMA_INVALID_ENUM_DEFAULT',
    );
    expect(invalidDefault?.suggestion).toContain('pending, active');
    expect(
      diagnostics.some((d) => d.code === 'SCHEMA_ENUM_TYPE_CASE_MISMATCH'),
    ).toBe(true);
  });

  it('should report an enum type as ambiguous when its declaration is duplicated', () => {
    const schema: DatabaseSchema = {
      tables: [table('orders', [{ name: 'status', type: 'status' }])],
      relations: [],
      enums: [
        { name: 'status', values: ['pending'] },
        { name: 'status', values: ['active'] },
      ],
    };

    expect(
      validateSchema(schema).some(
        (d) => d.code === 'SCHEMA_AMBIGUOUS_ENUM_TYPE',
      ),
    ).toBe(true);
  });
});
