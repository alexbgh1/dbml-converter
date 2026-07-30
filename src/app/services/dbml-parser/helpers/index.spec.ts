import { describe, expect, it } from 'vitest';

import { parseDbType } from '.';

describe('parseDbType', () => {
  it('normalizes the base type and parses numeric arguments', () => {
    expect(parseDbType('DECIMAL(10, 2)')).toEqual({
      base: 'decimal',
      args: [10, 2],
    });
    expect(parseDbType('VARCHAR(255)')).toEqual({
      base: 'varchar',
      args: [255],
    });
  });

  it('normalizes an unknown type without changing its fallback shape', () => {
    expect(parseDbType('Custom Type')).toEqual({
      base: 'custom type',
      args: [],
    });
  });
});
