import { describe, expect, it } from 'vitest';

import { projectArchiveEntries } from './editor-mode.helpers';

describe('projectArchiveEntries', () => {
  it('uses generated filenames and the canonical DBML source filename', () => {
    expect(
      projectArchiveEntries(
        [{ id: 'schema-json', filename: 'schema.json', content: '{}' }],
        'Table users {}',
      ),
    ).toEqual([
      { filename: 'schema.json', content: '{}' },
      { filename: 'input.dbml', content: 'Table users {}' },
    ]);
  });

  it('preserves the existing fallback for incomplete generated files', () => {
    expect(
      projectArchiveEntries([{ id: 'json', filename: '', content: '' }], ''),
    ).toEqual([
      { filename: 'untitled.json', content: '' },
      { filename: 'input.dbml', content: '' },
    ]);
  });
});
