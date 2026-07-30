import { describe, expect, it } from 'vitest';

import { MAX_DBML_FILE_SIZE, validateDbmlFile } from './import-dbml-file';

describe('validateDbmlFile', () => {
  it('accepts a non-empty .dbml file case-insensitively', () => {
    expect(validateDbmlFile({ name: 'schema.DBML', size: 20 })).toBeNull();
  });

  it('rejects wrong extensions, empty files and oversized files', () => {
    expect(validateDbmlFile({ name: 'schema.txt', size: 20 })).toContain(
      '.dbml',
    );
    expect(validateDbmlFile({ name: 'schema.dbml', size: 0 })).toContain(
      'empty',
    );
    expect(
      validateDbmlFile({
        name: 'schema.dbml',
        size: MAX_DBML_FILE_SIZE + 1,
      }),
    ).toContain('2 MiB');
  });
});
