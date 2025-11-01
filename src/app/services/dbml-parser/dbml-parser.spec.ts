import { TestBed } from '@angular/core/testing';

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

  function findTable(
    schema: DatabaseSchema | null,
    name: string
  ): Table | undefined {
    return schema?.tables.find((t) => t.name === name);
  }

  function findColumn(
    table: Table | undefined,
    name: string
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
    cardinality: { from: Cardinality; to: Cardinality }
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
    isPk = false
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
        CARDINALITY_MAP[RelationOperator.ManyToOne]
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
        CARDINALITY_MAP[RelationOperator.ManyToOne]
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
      const userIdColumn = findColumn(postsTable, 'users_id');

      expectForeignKey(userIdColumn, 'users', 'id');
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
        CARDINALITY_MAP[RelationOperator.OneToOne]
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
        CARDINALITY_MAP[RelationOperator.OneToOne]
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
        CARDINALITY_MAP[RelationOperator.ManyToMany]
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
        (c) => c.ref?.table === 'users'
      );
      expectForeignKey(usersFK, 'users', 'id', true);

      const rolesFK = junctionTable?.columns.find(
        (c) => c.ref?.table === 'roles'
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
