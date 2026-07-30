import { describe, expect, it } from 'vitest';

import {
  Table,
  TableIndex,
} from '../../dbml-parser/interfaces/dbml-parser.interface';
import { hasNamedSingleUniqueIndex, stripIdSuffix, toPascalCase } from '.';

function tableWith(index: TableIndex): Table {
  return { name: 'users', alias: null, columns: [], indexes: [index] };
}

describe('hasNamedSingleUniqueIndex', () => {
  it('recognizes an exact named single-column unique index', () => {
    expect(
      hasNamedSingleUniqueIndex(
        tableWith({ columns: ['email'], unique: true, name: 'uq_users_email' }),
        'email',
      ),
    ).toBe(true);
  });

  it.each([
    ['unnamed unique', { columns: ['email'], unique: true }],
    ['empty-name unique', { columns: ['email'], unique: true, name: '' }],
    ['named non-unique', { columns: ['email'], name: 'idx_users_email' }],
    [
      'named composite unique',
      {
        columns: ['tenant_id', 'email'],
        unique: true,
        name: 'uq_users_tenant_email',
      },
    ],
    [
      'different-column unique',
      { columns: ['username'], unique: true, name: 'uq_users_username' },
    ],
  ] satisfies readonly [string, TableIndex][])(
    'rejects %s indexes',
    (_, index) => {
      expect(hasNamedSingleUniqueIndex(tableWith(index), 'email')).toBe(false);
    },
  );

  it('returns false when a table has no indexes', () => {
    expect(
      hasNamedSingleUniqueIndex(
        { name: 'users', alias: null, columns: [] },
        'email',
      ),
    ).toBe(false);
  });
});

describe('stripIdSuffix', () => {
  it.each([
    ['user_id', 'user'],
    ['USER_ID', 'USER'],
    ['_id', '_id'],
    ['id', 'id'],
    ['userId', 'userId'],
  ])('maps %s to %s', (input, expected) => {
    expect(stripIdSuffix(input)).toBe(expected);
  });
});

describe('toPascalCase', () => {
  it.each([
    ['user_profile', 'UserProfile'],
    ['USER_PROFILE', 'USERPROFILE'],
    ['user__profile', 'UserProfile'],
    ['userProfile', 'UserProfile'],
    ['', ''],
  ])('maps %s to %s', (input, expected) => {
    expect(toPascalCase(input)).toBe(expected);
  });
});
