import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DbmlParserService } from './dbml-parser';

import {
  Cardinality,
  DatabaseSchema,
  Table,
  Column,
  Relation,
  CARDINALITY_MAP,
  RelationOperator,
} from './interfaces/dbml-parser.interface';
import { COLUMN_ATTRIBUTES } from './constants';

const EMPTY_SCHEMA: DatabaseSchema = { tables: [], relations: [] };

describe('DbmlParserService', () => {
  let service: DbmlParserService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DbmlParserService);
  });

  /* Common functions */
  function parseDbml(dbml: string): DatabaseSchema | null {
    service.setDbmlContent(dbml);
    TestBed.flushEffects();
    return service.schema();
  }

  function parseDiagnostics(dbml: string) {
    service.setDbmlContent(dbml);
    TestBed.flushEffects();
    return service.diagnostics();
  }

  function findTable(
    schema: DatabaseSchema | null,
    name: string,
  ): Table | undefined {
    return schema?.tables.find((t) => t.name === name);
  }

  function findColumn(
    table: Table | undefined,
    name: string,
  ): Column | undefined {
    return table?.columns.find((c) => c.name === name);
  }

  /*
      'expectRelation' expects a relation with the structure:
        relations: [
          {
            from: { table: from.table, column: from.column },
            to: { table: to.table, column: to.column },
            cardinality: { from: cardinality.from, to: cardinality.to },
            },
          ],
    */
  function expectRelation(
    relation: Relation | undefined,
    from: { table: string; column: string },
    to: { table: string; column: string },
    cardinality: { from: Cardinality; to: Cardinality },
  ): void {
    expect(relation?.from.table).toBe(from.table);
    expect(relation?.from.column).toBe(from.column);

    expect(relation?.to.table).toBe(to.table);
    expect(relation?.to.column).toBe(to.column);

    expect(relation?.cardinality.from).toBe(cardinality.from);
    expect(relation?.cardinality.to).toBe(cardinality.to);
  }

  /*
      'expectForeignKey' expects a column with a foreign key reference to another table.column
        {
          ref: { table: refTable, column: refColumn },
        }
  */
  function expectForeignKey(
    column: Column | undefined,
    refTable: string,
    refColumn: string,
    isPk = false,
  ): void {
    expect(column).toBeTruthy();

    expect(column?.ref).toBeTruthy();

    expect(column?.ref?.table).toBe(refTable);
    expect(column?.ref?.column).toBe(refColumn);
    if (isPk) {
      expect(column?.pk).toBe(true);
    }
  }

  it('Service should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Basic parsing', () => {
    it('should parse simple table definition', () => {
      /*
      Expects:
      - The parser to return a valid schema
      - The schema to include one table named 'users'
      - The table should have two columns: 'id' (pk) and 'name'
    */
      const schema = parseDbml(`
        Table users {
          id int [pk]
          name varchar
        }
      `);

      expect(schema).toBeTruthy();

      expect(schema?.tables.length).toBe(1);
      expect(schema?.tables[0].name).toBe('users');
      expect(schema?.tables[0].columns[0].name).toBe('id');
      expect(schema?.tables[0].columns[1].name).toBe('name');
      expect(schema?.tables[0].columns[0].pk).toBe(true);
      expect(schema?.tables[0].columns.length).toBe(2);
    });

    it('should handle empty DBML content', () => {
      const schema = parseDbml('');
      expect(schema).toEqual(EMPTY_SCHEMA);
    });

    it('should parse multiple tables', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table posts {
          id int [pk]
        }
      `);

      expect(schema?.tables.length).toBe(2);
      expect(schema?.tables[0].name).toBe('users');
      expect(schema?.tables[1].name).toBe('posts');
    });
  });

  describe('Column attributes', () => {
    it('should parse column with primary key', () => {
      COLUMN_ATTRIBUTES.PrimaryKey.forEach((attr) => {
        const schema = parseDbml(`
        Table users {
          id int [${attr}]
        }
      `);

        const column = findColumn(findTable(schema, 'users'), 'id');
        expect(column?.pk).toBe(true);
      });
    });

    it('should parse column with increment flag', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk, increment]
        }
      `);

      const column = findColumn(findTable(schema, 'users'), 'id');
      expect(column?.pk).toBe(true);
      expect(column?.increment).toBe(true);
    });

    it('should parse column with unique flag', () => {
      const schema = parseDbml(`
        Table users {
          email varchar [unique]
        }
      `);

      const column = findColumn(findTable(schema, 'users'), 'email');
      expect(column?.unique).toBe(true);
    });

    it('should parse column with not null flag', () => {
      COLUMN_ATTRIBUTES.NotNull.forEach((attr) => {
        const schema = parseDbml(`
        Table users {
          name varchar [${attr}]
        }
      `);

        const column = findColumn(findTable(schema, 'users'), 'name');
        expect(column?.nullable).toBe(false);
      });
    });

    it('should parse column with default string value', () => {
      const schema = parseDbml(`
        Table users {
          name varchar [default: "John"]
        }
      `);

      const column = findColumn(findTable(schema, 'users'), 'name');
      expect(column?.default).toBe('John');
    });

    it('should parse column with default number value', () => {
      const schema = parseDbml(`
        Table users {
          age int [default: 18]
        }
      `);

      const column = findColumn(findTable(schema, 'users'), 'age');
      expect(column?.default).toBe(18);
    });

    it('should parse column with default boolean value', () => {
      const schema = parseDbml(`
        Table users {
          active boolean [default: true]
        }
      `);

      const column = findColumn(findTable(schema, 'users'), 'active');
      expect(column?.default).toBe(true);
    });

    it('should parse column with note', () => {
      const schema = parseDbml(`
        Table users {
          email varchar [note: 'User email address']
        }
      `);

      const column = findColumn(findTable(schema, 'users'), 'email');
      expect(column?.note).toBe('User email address');
    });
  });

  describe('Relationships - ', () => {
    it('should parse inline many-to-one reference', () => {
      const schema = parseDbml(`
        Table posts {
          id int [pk]
          user_id int [ref: > users.id]
        }
        Table users {
          id int [pk]
        }
      `);

      expect(schema?.relations.length).toBe(1);

      expectRelation(
        schema?.relations[0],
        { table: 'posts', column: 'user_id' },
        { table: 'users', column: 'id' },
        CARDINALITY_MAP[RelationOperator.ManyToOne],
      );
    });

    it('should parse external many-to-one reference', () => {
      const schema = parseDbml(`
        Table posts {
          id int [pk]
          user_id int
        }
        Table users {
          id int [pk]
        }
        Ref: posts.user_id > users.id
      `);

      expect(schema?.relations.length).toBe(1);

      const relation = schema?.relations[0];
      expect(relation?.cardinality).toEqual(
        CARDINALITY_MAP[RelationOperator.ManyToOne],
      );
    });

    it('should add missing foreign key column from external relation', () => {
      const schema = parseDbml(`
        Table posts {
          id int [pk]
        }
        Table users {
          id int [pk]
        }
        Ref: posts.user_id > users.id
      `);

      const postsTable = findTable(schema, 'posts');

      // The created column keeps the exact name written in the Ref
      const userIdColumn = findColumn(postsTable, 'user_id');
      expectForeignKey(userIdColumn, 'users', 'id');
      expect(schema?.relations[0].from.column).toBe('user_id');
    });
  });

  describe('Relationships - One-to-One (1:1)', () => {
    it('should parse inline one-to-one reference', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table profiles {
          id int [pk]
          user_id int [ref: - users.id]
        }
      `);

      expect(schema?.relations.length).toBe(1);

      const relation = schema?.relations[0];
      expect(relation?.cardinality).toEqual(
        CARDINALITY_MAP[RelationOperator.OneToOne],
      );
    });

    it('should parse external one-to-one reference', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table profiles {
          id int [pk]
          user_id int
        }
        Ref: profiles.user_id - users.id
      `);

      expect(schema?.relations.length).toBe(1);

      const relation = schema?.relations[0];
      expect(relation?.cardinality).toEqual(
        CARDINALITY_MAP[RelationOperator.OneToOne],
      );
    });
  });

  describe('Relationships - Many-to-Many (N:M)', () => {
    it('should parse inline many-to-many reference', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table roles {
          id int [pk]
        }
        Ref: users.id <> roles.id
      `);

      expect(schema?.relations.length).toBe(1);

      const relation = schema?.relations[0];
      expect(relation?.cardinality).toEqual(
        CARDINALITY_MAP[RelationOperator.ManyToMany],
      );
    });

    it('should create junction table for many-to-many relationship', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table roles {
          id int [pk]
        }
        Ref: users.id <> roles.id
      `);

      const junctionTable = findTable(schema, 'users_roles');

      expect(junctionTable).toBeTruthy();
      expect(junctionTable?.columns.length).toBe(2);

      const usersFK = junctionTable?.columns.find(
        (c) => c.ref?.table === 'users',
      );
      expectForeignKey(usersFK, 'users', 'id', true);

      const rolesFK = junctionTable?.columns.find(
        (c) => c.ref?.table === 'roles',
      );
      expectForeignKey(rolesFK, 'roles', 'id', true);
    });

    it('should use named junction table if provided', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table roles {
          id int [pk]
        }
        Ref user_roles: users.id <> roles.id
      `);

      const junctionTable = findTable(schema, 'user_roles');
      expect(junctionTable).toBeTruthy();
    });

    it('should enhance existing junction table', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table roles {
          id int [pk]
        }
        Table users_roles {
          time timestamp
        }
        Ref: users.id <> roles.id
      `);

      const junctionTable = findTable(schema, 'users_roles');

      expect(junctionTable).toBeTruthy();
      expect(junctionTable?.columns.length).toBe(3);

      const timeColumn = findColumn(junctionTable, 'time');
      expect(timeColumn).toBeTruthy();
      expect(timeColumn?.type).toBe('timestamp');

      const usersIdColumn = findColumn(junctionTable, 'users_id');
      expectForeignKey(usersIdColumn, 'users', 'id', true);

      const rolesIdColumn = findColumn(junctionTable, 'roles_id');
      expectForeignKey(rolesIdColumn, 'roles', 'id', true);
    });

    it('should give distinct role-aware columns to a self-referential junction', () => {
      const schema = parseDbml(
        [
          'Table users {',
          '  id int [pk]',
          '}',
          'Ref: users.id <> users.id',
        ].join('\n'),
      );
      const junctionTable = findTable(schema, 'users_users');

      expect(junctionTable?.columns.map((column) => column.name)).toEqual([
        'users_source_id',
        'users_target_id',
      ]);
      expectForeignKey(
        findColumn(junctionTable, 'users_source_id'),
        'users',
        'id',
        true,
      );
      expectForeignKey(
        findColumn(junctionTable, 'users_target_id'),
        'users',
        'id',
        true,
      );
      expect(
        service
          .diagnostics()
          .filter((diagnostic) => diagnostic.code === 'SCHEMA_DUPLICATE_COLUMN'),
      ).toHaveLength(0);
    });

    it.each([
      [
        'short form',
        [
          'Table users {',
          '  id int [pk]',
          '}',
          'Ref friendships: users.id <> users.id',
        ].join('\n'),
      ],
      [
        'long form',
        [
          'Table users {',
          '  id int [pk]',
          '}',
          'Ref friendships {',
          '  users.id <> users.id',
          '}',
        ].join('\n'),
      ],
    ])(
      'should preserve distinct self-junction roles in named %s relations',
      (_syntax, dbml) => {
        const junctionTable = findTable(parseDbml(dbml), 'friendships');

        expect(junctionTable?.columns.map((column) => column.name)).toEqual([
          'users_source_id',
          'users_target_id',
        ]);
      },
    );

    it('should require two distinct endpoint FKs when completing a self-junction', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table friendships {
          requester_id int [ref: > users.id]
        }
        Ref friendships: users.id <> users.id
      `);
      const junctionTable = findTable(schema, 'friendships');

      expect(junctionTable?.columns.map((column) => column.name)).toEqual([
        'requester_id',
        'users_target_id',
      ]);
      expectForeignKey(
        findColumn(junctionTable, 'requester_id'),
        'users',
        'id',
        true,
      );
      expectForeignKey(
        findColumn(junctionTable, 'users_target_id'),
        'users',
        'id',
        true,
      );
    });

    it('should avoid colliding with an existing payload column while completing a self-junction', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table friendships {
          users_target_id varchar
        }
        Ref friendships: users.id <> users.id
      `);
      const junctionTable = findTable(schema, 'friendships');

      expect(junctionTable?.columns.map((column) => column.name)).toEqual([
        'users_target_id',
        'users_source_id',
        'users_target_id_2',
      ]);
      expect(findColumn(junctionTable, 'users_target_id')?.ref).toBeUndefined();
      expectForeignKey(
        findColumn(junctionTable, 'users_source_id'),
        'users',
        'id',
        true,
      );
      expectForeignKey(
        findColumn(junctionTable, 'users_target_id_2'),
        'users',
        'id',
        true,
      );
      expect(
        service
          .diagnostics()
          .filter((diagnostic) => diagnostic.code === 'SCHEMA_DUPLICATE_COLUMN'),
      ).toHaveLength(0);
    });

    it('should keep conventional names when self-junction endpoints use different columns', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
          external_id int [unique]
        }
        Ref: users.id <> users.external_id
      `);
      const junctionTable = findTable(schema, 'users_users');

      expect(junctionTable?.columns.map((column) => column.name)).toEqual([
        'users_id',
        'users_external_id',
      ]);
    });

    it('should preserve distinct existing FKs when different endpoints derive the same name', () => {
      const schema = parseDbml(`
        Table a_b {
          c int [pk]
        }
        Table a {
          b_c int [pk]
        }
        Table links {
          left_key int [ref: > a_b.c]
          right_key int [ref: > a.b_c]
        }
        Ref links: a_b.c <> a.b_c
      `);
      const junctionTable = findTable(schema, 'links');

      expect(junctionTable?.columns.map((column) => column.name)).toEqual([
        'left_key',
        'right_key',
      ]);
      expectForeignKey(findColumn(junctionTable, 'left_key'), 'a_b', 'c', true);
      expectForeignKey(
        findColumn(junctionTable, 'right_key'),
        'a',
        'b_c',
        true,
      );
    });
  });

  describe('Types with arguments', () => {
    it('should keep full type and attributes for decimal(10,2)', () => {
      const schema = parseDbml(`
        Table products {
          price decimal(10,2) [not null]
        }
      `);

      const column = findColumn(findTable(schema, 'products'), 'price');
      expect(column?.type).toBe('decimal(10,2)');
      expect(column?.nullable).toBe(false);
    });
  });

  describe('Nullability defaults', () => {
    it('should default columns to nullable (DBML spec)', () => {
      const schema = parseDbml(`
        Table products {
          description text
        }
      `);

      const column = findColumn(findTable(schema, 'products'), 'description');
      expect(column?.nullable).toBe(true);
    });

    it('should mark primary keys as not nullable', () => {
      const schema = parseDbml(`
        Table products {
          id int [pk]
        }
      `);

      const column = findColumn(findTable(schema, 'products'), 'id');
      expect(column?.nullable).toBe(false);
    });
  });

  describe('Notes', () => {
    it('should parse table-level note without creating a column', () => {
      const schema = parseDbml(`
        Table logs {
          id int [pk]
          note: 'Vital para ganar disputas, con comas'
        }
      `);

      const table = findTable(schema, 'logs');
      expect(table?.note).toBe('Vital para ganar disputas, con comas');
      expect(table?.columns.length).toBe(1);
    });

    it('should keep commas inside column notes', () => {
      const schema = parseDbml(`
        Table user_roles {
          name varchar [note: 'admin, customer, moderator']
        }
      `);

      const column = findColumn(findTable(schema, 'user_roles'), 'name');
      expect(column?.note).toBe('admin, customer, moderator');
    });
  });

  describe('Default expressions', () => {
    it('should flag backtick defaults as expressions', () => {
      const schema = parseDbml(`
        Table logs {
          created_at timestamp [default: \`now()\`]
        }
      `);

      const column = findColumn(findTable(schema, 'logs'), 'created_at');
      expect(column?.default).toBe('now()');
      expect(column?.isExpression).toBe(true);
    });

    it('should flag unquoted function calls as expressions', () => {
      const schema = parseDbml(`
        Table logs {
          id uuid [default: gen_random_uuid()]
        }
      `);

      const column = findColumn(findTable(schema, 'logs'), 'id');
      expect(column?.isExpression).toBe(true);
    });
  });

  describe('Relationships - One-to-Many normalization', () => {
    it('should normalize "<" so the FK side is always "from"', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table orders {
          id int [pk]
          user_id int
        }
        Ref: users.id < orders.user_id
      `);

      expect(schema?.relations.length).toBe(1);
      expectRelation(
        schema?.relations[0],
        { table: 'orders', column: 'user_id' },
        { table: 'users', column: 'id' },
        CARDINALITY_MAP[RelationOperator.ManyToOne],
      );

      // The FK ref must land on orders.user_id, not on users.id
      const userIdColumn = findColumn(findTable(schema, 'orders'), 'user_id');
      expectForeignKey(userIdColumn, 'users', 'id');
      expect(findColumn(findTable(schema, 'users'), 'id')?.ref).toBeUndefined();
    });

    it('should normalize inline "ref: <" the same way', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk, ref: < orders.user_id]
        }
        Table orders {
          id int [pk]
          user_id int
        }
      `);

      expect(schema?.relations.length).toBe(1);
      expectRelation(
        schema?.relations[0],
        { table: 'orders', column: 'user_id' },
        { table: 'users', column: 'id' },
        CARDINALITY_MAP[RelationOperator.ManyToOne],
      );
      expect(findColumn(findTable(schema, 'users'), 'id')?.ref).toBeUndefined();
    });
  });

  describe('Junction table provenance', () => {
    it('should tag created junction tables with isJunction', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table roles {
          id int [pk]
        }
        Ref: users.id <> roles.id
      `);

      expect(findTable(schema, 'users_roles')?.isJunction).toBe(true);
    });

    it('should NOT tag regular multi-FK tables as junction', () => {
      const schema = parseDbml(`
        Table orders {
          id uuid [pk]
          user_id uuid [ref: > users.id]
          status_id int [ref: > statuses.id]
        }
        Table users {
          id uuid [pk]
        }
        Table statuses {
          id int [pk]
        }
      `);

      expect(findTable(schema, 'orders')?.isJunction).toBeUndefined();
    });
  });

  describe('Enums', () => {
    it('should parse enum definitions', () => {
      const schema = parseDbml(`
        Enum order_status {
          pending
          approved
          rejected
        }
        Table orders {
          id int [pk]
          status order_status
        }
      `);

      expect(schema?.enums?.length).toBe(1);
      expect(schema?.enums?.[0].name).toBe('order_status');
      expect(schema?.enums?.[0].values).toEqual([
        'pending',
        'approved',
        'rejected',
      ]);
      expect(schema?.enums?.[0].sourceLine).toBe(2);
      expect(schema?.enums?.[0].valueSourceLines).toEqual([3, 4, 5]);
      expect(findTable(schema, 'orders')?.columns.length).toBe(2);
    });

    it('should report invalid enum values at their exact source line', () => {
      const diagnostics = parseDiagnostics(
        ['Enum order_status {', '  pending', '  2_archived', '}'].join('\n'),
      );

      const invalid = diagnostics.find(
        (d) => d.code === 'PARSE_INVALID_ENUM_VALUE',
      );
      expect(invalid?.severity).toBe('error');
      expect(invalid?.line).toBe(3);
      expect(invalid?.schemaPath).toBe('enums.order_status');
    });

    it('should report an unterminated enum at its declaration line', () => {
      const diagnostics = parseDiagnostics(
        ['Enum order_status {', '  pending'].join('\n'),
      );

      const unterminated = diagnostics.find(
        (d) => d.code === 'PARSE_UNTERMINATED_BLOCK',
      );
      expect(unterminated?.line).toBe(1);
      expect(unterminated?.message).toContain('order_status');
    });
  });

  describe('Indexes block', () => {
    it('should parse composite pk, unique and plain indexes without breaking the table', () => {
      const schema = parseDbml(`
        Table order_items {
          order_id int
          product_id int
          email varchar
          created_at timestamp

          indexes {
            (order_id, product_id) [pk]
            email [unique]
            (created_at) [name: 'idx_created']
          }

          extra_col int
        }
      `);

      const table = findTable(schema, 'order_items');
      // the "}" of indexes must not terminate the table
      expect(findColumn(table, 'extra_col')).toBeTruthy();

      expect(findColumn(table, 'order_id')?.pk).toBe(true);
      expect(findColumn(table, 'product_id')?.pk).toBe(true);
      expect(findColumn(table, 'email')?.unique).toBe(true);
      expect(table?.indexes?.length).toBe(1);
      expect(table?.indexes?.[0].columns).toEqual(['created_at']);
      expect(table?.indexes?.[0].name).toBe('idx_created');
    });

    it('should retain names for primary and single-column unique indexes', () => {
      const schema = parseDbml(`
        Table users {
          id int
          email varchar

          indexes {
            id [pk, name: 'pk_users']
            email [unique, name: 'uq_users_email']
          }
        }
      `);

      const table = findTable(schema, 'users');
      expect(findColumn(table, 'id')?.pk).toBe(true);
      expect(findColumn(table, 'email')?.unique).toBe(true);
      expect(table?.indexes).toEqual([
        { columns: ['id'], pk: true, name: 'pk_users' },
        {
          columns: ['email'],
          unique: true,
          name: 'uq_users_email',
        },
      ]);
    });
  });

  describe('Table aliases', () => {
    it('should resolve alias references to the real table name', () => {
      const schema = parseDbml(`
        Table users as U {
          id int [pk]
        }
        Table posts {
          id int [pk]
          user_id int [ref: > U.id]
        }
      `);

      const table = findTable(schema, 'users');
      expect(table?.alias).toBe('U');

      const userIdColumn = findColumn(findTable(schema, 'posts'), 'user_id');
      expectForeignKey(userIdColumn, 'users', 'id');
      expect(schema?.relations[0].to.table).toBe('users');
    });
  });

  describe('Referential actions', () => {
    it('should parse delete/update actions on inline refs', () => {
      const schema = parseDbml(`
        Table posts {
          user_id int [ref: > users.id, delete: cascade, update: no action]
        }
        Table users {
          id int [pk]
        }
      `);

      const column = findColumn(findTable(schema, 'posts'), 'user_id');
      expect(column?.ref?.onDelete).toBe('CASCADE');
      expect(column?.ref?.onUpdate).toBe('NO ACTION');
      expect(schema?.relations[0].onDelete).toBe('CASCADE');
      expect(schema?.relations[0].onUpdate).toBe('NO ACTION');
    });

    it('should parse and attach actions from a short-form Ref', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table posts {
          user_id int
        }
        Ref: posts.user_id > users.id [delete: restrict, update: set null]
      `);

      const relation = schema?.relations[0];
      const column = findColumn(findTable(schema, 'posts'), 'user_id');

      expect(relation?.onDelete).toBe('RESTRICT');
      expect(relation?.onUpdate).toBe('SET NULL');
      expect(column?.ref?.onDelete).toBe('RESTRICT');
      expect(column?.ref?.onUpdate).toBe('SET NULL');
    });

    it('should preserve long-form Ref actions when creating the FK column', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table posts {
          id int [pk]
        }
        Ref post_owner {
          posts.user_id > users.id [delete: cascade, update: no action]
        }
      `);

      const relation = schema?.relations[0];
      const column = findColumn(findTable(schema, 'posts'), 'user_id');

      expect(relation?.onDelete).toBe('CASCADE');
      expect(relation?.onUpdate).toBe('NO ACTION');
      expect(column?.type).toBe('int');
      expect(column?.ref?.onDelete).toBe('CASCADE');
      expect(column?.ref?.onUpdate).toBe('NO ACTION');
    });

    it('should keep actions on the normalized FK side for a short-form < Ref', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk]
        }
        Table posts {
          user_id int
        }
        Ref: users.id < posts.user_id [delete: cascade, update: restrict]
      `);

      const relation = schema?.relations[0];
      const column = findColumn(findTable(schema, 'posts'), 'user_id');

      expectRelation(
        relation,
        { table: 'posts', column: 'user_id' },
        { table: 'users', column: 'id' },
        CARDINALITY_MAP[RelationOperator.ManyToOne],
      );
      expect(relation?.onDelete).toBe('CASCADE');
      expect(relation?.onUpdate).toBe('RESTRICT');
      expect(column?.ref?.onDelete).toBe('CASCADE');
      expect(column?.ref?.onUpdate).toBe('RESTRICT');
    });

    it('should preserve actions when an inline < Ref moves the FK side', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk, ref: < posts.user_id, delete: cascade, update: restrict]
        }
        Table posts {
          user_id int
        }
      `);

      const usersId = findColumn(findTable(schema, 'users'), 'id');
      const postsUserId = findColumn(findTable(schema, 'posts'), 'user_id');

      expect(usersId?.ref).toBeUndefined();
      expect(postsUserId?.ref?.table).toBe('users');
      expect(postsUserId?.ref?.column).toBe('id');
      expect(postsUserId?.ref?.onDelete).toBe('CASCADE');
      expect(postsUserId?.ref?.onUpdate).toBe('RESTRICT');
    });
  });

  describe('Unsupported blocks', () => {
    it('should skip Project blocks gracefully', () => {
      const schema = parseDbml(`
        Project my_db {
          database_type: 'PostgreSQL'
        }
        Table users {
          id int [pk]
        }
      `);

      expect(schema?.tables.length).toBe(1);
      expect(findTable(schema, 'users')).toBeTruthy();
    });
  });

  describe('Diagnostics', () => {
    it('should return no diagnostics for a clean schema', () => {
      const diagnostics = parseDiagnostics(`
        Table users {
          id int [pk]
          name varchar
        }
      `);

      expect(diagnostics).toEqual([]);
    });

    it('should emit an info diagnostic when an FK column is created', () => {
      const diagnostics = parseDiagnostics(`
        Table posts {
          id int [pk]
        }
        Table users {
          id int [pk]
        }
        Ref: posts.user_id > users.id
      `);

      const created = diagnostics.find(
        (d) => d.code === 'SCHEMA_FK_COLUMN_CREATED',
      );
      expect(created).toBeTruthy();
      expect(created?.severity).toBe('info');
      expect(created?.message).toContain('posts.user_id');
    });

    it('should emit an info diagnostic when a junction table is created', () => {
      const diagnostics = parseDiagnostics(`
        Table users {
          id int [pk]
        }
        Table roles {
          id int [pk]
        }
        Ref: users.id <> roles.id
      `);

      const created = diagnostics.find(
        (d) => d.code === 'SCHEMA_JUNCTION_TABLE_CREATED',
      );
      expect(created).toBeTruthy();
      expect(created?.severity).toBe('info');
      expect(created?.message).toContain('users_roles');
    });

    it('should emit an info diagnostic when a junction table is completed', () => {
      const diagnostics = parseDiagnostics(`
        Table users {
          id int [pk]
        }
        Table roles {
          id int [pk]
        }
        Table users_roles {
          time timestamp
        }
        Ref: users.id <> roles.id
      `);

      const completed = diagnostics.find(
        (d) => d.code === 'SCHEMA_JUNCTION_TABLE_CREATED',
      );
      expect(completed).toBeTruthy();
      expect(completed?.message).toContain('Completed');
    });

    it('should warn about unrecognized lines inside a table', () => {
      const diagnostics = parseDiagnostics(`
        Table users {
          id int [pk]
          !!! not a column !!!
        }
      `);

      const warning = diagnostics.find(
        (d) => d.code === 'PARSE_UNRECOGNIZED_LINE',
      );
      expect(warning).toBeTruthy();
      expect(warning?.severity).toBe('warning');
      expect(warning?.message).toContain('users');
    });

    it('should warn about an unknown column attribute without dropping the column', () => {
      const dbml = [
        'Table users {',
        "  id int [pk, primary, note: 'identifier, external']",
        '  nickname varchar [null]',
        "  description text [note: '']",
        '}',
      ].join('\n');

      const schema = parseDbml(dbml);
      const column = findColumn(findTable(schema, 'users'), 'id');
      const nullableColumn = findColumn(
        findTable(schema, 'users'),
        'nickname',
      );
      const emptyNoteColumn = findColumn(
        findTable(schema, 'users'),
        'description',
      );
      const warnings = service
        .diagnostics()
        .filter((d) => d.code === 'PARSE_UNKNOWN_ATTRIBUTE');
      const warning = warnings[0];

      expect(column?.pk).toBe(true);
      expect(column?.note).toBe('identifier, external');
      expect(nullableColumn?.nullable).toBe(true);
      expect(emptyNoteColumn?.note).toBe('');
      expect(warnings).toHaveLength(1);
      expect(warning?.severity).toBe('warning');
      expect(warning?.line).toBe(2);
      expect(warning?.schemaPath).toBe('tables.users.columns.id');
      expect(warning?.details?.['attribute']).toBe('primary');
    });

    it('should warn about invalid short and long-form Ref lines', () => {
      const diagnostics = parseDiagnostics(
        [
          'Table users {',
          '  id int [pk]',
          '}',
          'Ref: posts.user_id users.id',
          'Ref post_owner {',
          '  posts.user_id ? users.id',
          '}',
        ].join('\n'),
      ).filter((d) => d.code === 'PARSE_UNRECOGNIZED_LINE');

      expect(diagnostics).toHaveLength(2);
      expect(diagnostics.map((d) => d.line)).toEqual([4, 6]);
      expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
      expect(diagnostics.every((d) => d.schemaPath === 'relations')).toBe(
        true,
      );
    });

    it('should warn about an unrecognized top-level line', () => {
      const diagnostics = parseDiagnostics(
        ['This is not DBML', 'Table users {', '  id int [pk]', '}'].join(
          '\n',
        ),
      );

      const warning = diagnostics.find(
        (d) => d.code === 'PARSE_UNRECOGNIZED_LINE',
      );
      expect(warning?.severity).toBe('warning');
      expect(warning?.line).toBe(1);
      expect(warning?.message).toContain('top-level');
    });

    it('should warn about an invalid line inside an indexes block', () => {
      const diagnostics = parseDiagnostics(
        [
          'Table users {',
          '  id int [pk]',
          '  indexes {',
          '    (id,,) [unique',
          '  }',
          '}',
        ].join('\n'),
      );

      const warning = diagnostics.find(
        (d) => d.code === 'PARSE_UNRECOGNIZED_LINE',
      );
      expect(warning?.severity).toBe('warning');
      expect(warning?.line).toBe(4);
      expect(warning?.schemaPath).toBe('tables.users.indexes');
      expect(warning?.message).toContain('invalid index');
    });

    it('should stamp source lines on tables, columns and diagnostics', () => {
      const dbml = [
        'Table users {', // line 1
        '  id int [pk]', // line 2
        '  !!! garbage !!!', // line 3
        '}', // line 4
      ].join('\n');

      const schema = parseDbml(dbml);
      const table = findTable(schema, 'users');
      expect(table?.sourceLine).toBe(1);
      expect(findColumn(table, 'id')?.sourceLine).toBe(2);

      const warning = service
        .diagnostics()
        .find((d) => d.code === 'PARSE_UNRECOGNIZED_LINE');
      expect(warning?.line).toBe(3);
    });

    it('should report schema validation problems (missing ref target)', () => {
      const diagnostics = parseDiagnostics(`
        Table customers {
          customer_uuid uuid [pk]
        }
        Table orders {
          id int [pk]
          customer_id uuid [ref: > customers.id]
        }
      `);

      const unknown = diagnostics.find(
        (d) => d.code === 'SCHEMA_UNKNOWN_REFERENCE_COLUMN',
      );
      expect(unknown).toBeTruthy();
      expect(unknown?.severity).toBe('error');
      expect(unknown?.suggestion).toContain('customers.customer_uuid');
    });

    it('should report unterminated blocks as errors', () => {
      const diagnostics = parseDiagnostics(`
        Table users {
          id int [pk]
      `);

      const error = diagnostics.find(
        (d) => d.code === 'PARSE_UNTERMINATED_BLOCK',
      );
      expect(error).toBeTruthy();
      expect(error?.severity).toBe('error');
      expect(error?.message).toContain('users');
    });
  });

  describe('Edge cases', () => {
    it('should deduplicate relations', () => {
      const schema = parseDbml(`
        Table posts {
          user_id int [ref: > users.id]
        }
        Table users {
          id int [pk]
        }
        Ref: posts.user_id > users.id
      `);

      expect(schema?.relations.length).toBe(1);
    });

    it('should ignore comments', () => {
      const schema = parseDbml(`
        // This is a comment
        Table users {
          id int [pk]
          // Another comment
          name varchar
        }
      `);

      expect(schema?.tables.length).toBe(1);
      expect(schema?.tables[0].columns.length).toBe(2);
    });

    it('should handle multiple attributes on same column', () => {
      const schema = parseDbml(`
        Table users {
          id int [pk, increment, not null]
        }
      `);

      const column = findColumn(findTable(schema, 'users'), 'id');

      expect(column?.pk).toBe(true);
      expect(column?.increment).toBe(true);
      expect(column?.nullable).toBe(false);
    });
  });
});
