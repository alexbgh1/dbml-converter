import { describe, expect, it } from 'vitest';

import {
  Cardinality,
  DatabaseSchema,
  ReferentialAction,
} from '../dbml-parser/interfaces/dbml-parser.interface';
import { DbmlParserService } from '../dbml-parser/dbml-parser';
import { schemaToDiagram } from './schema-to-diagram';

describe('schemaToDiagram', () => {
  it('maps an empty schema to an empty graph and layout', () => {
    expect(schemaToDiagram({ tables: [], relations: [] })).toEqual({
      nodes: [],
      edges: [],
      layout: {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        width: 0,
        height: 0,
      },
    });
  });

  it('maps semantic metadata separately from deterministic fallback positions', () => {
    const schema: DatabaseSchema = {
      tables: [
        {
          name: 'users',
          alias: 'U',
          sourceLine: 1,
          columns: [
            {
              name: 'id',
              type: 'uuid',
              pk: true,
              nullable: false,
              sourceLine: 2,
            },
          ],
        },
        {
          name: 'posts',
          alias: null,
          columns: [{ name: 'id', type: 'int' }],
        },
      ],
      relations: [],
    };

    const first = schemaToDiagram(schema);
    const second = schemaToDiagram(schema);

    expect(first).toEqual(second);
    expect(first.nodes[0]).toEqual(
      expect.objectContaining({
        alias: 'U',
        label: 'users',
        layout: { x: 60, y: 60, width: 280, height: 76 },
      }),
    );
    expect(first.nodes[0].id).toMatch(/^er-node-/);
    expect(first.nodes[0].id).not.toBe('users');
    expect(first.nodes[0].columns[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^er-column-/),
        nullable: false,
        badges: ['PK'],
        sourceLine: 2,
      }),
    );
    expect(first.nodes[1].columns[0].nullable).toBeNull();
    expect(first.layout).toEqual({
      minX: 0,
      minY: 0,
      maxX: 830,
      maxY: 196,
      width: 830,
      height: 196,
    });
  });

  it('orders combined PK/FK/UQ/NN constraints without adding NN to a PK', () => {
    const graph = schemaToDiagram({
      tables: [
        {
          name: 'memberships',
          alias: null,
          columns: [
            {
              name: 'tenant_id',
              type: 'uuid',
              pk: true,
              unique: true,
              nullable: true,
            },
            {
              name: 'user_id',
              type: 'uuid',
              unique: true,
              nullable: false,
              ref: { table: 'users', column: 'id' },
            },
            { name: 'description', type: 'varchar(255)', nullable: true },
            { name: 'legacy_value', type: 'text' },
          ],
        },
        {
          name: 'tenants',
          alias: null,
          columns: [{ name: 'id', type: 'uuid', pk: true }],
        },
        {
          name: 'users',
          alias: null,
          columns: [{ name: 'id', type: 'uuid', pk: true }],
        },
      ],
      relations: [
        {
          from: { table: 'memberships', column: 'tenant_id' },
          to: { table: 'tenants', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.One,
          },
        },
        {
          from: { table: 'memberships', column: 'user_id' },
          to: { table: 'users', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.One,
          },
        },
      ],
    });
    const columns = graph.nodes[0].columns;

    expect(columns[0]).toEqual(
      expect.objectContaining({
        nullable: false,
        badges: ['PK', 'FK', 'UQ'],
      }),
    );
    expect(columns[1].badges).toEqual(['FK', 'UQ', 'NN']);
    expect(columns[2].badges).toEqual([]);
    expect(columns[3]).toEqual(
      expect.objectContaining({ nullable: null, badges: [] }),
    );
  });

  it('recognizes inline and single-column unique indexes but not composite indexes', () => {
    const graph = schemaToDiagram({
      tables: [
        {
          name: 'catalog',
          alias: null,
          columns: [
            { name: 'inline_uq', type: 'text', unique: true },
            { name: 'named_uq', type: 'text' },
            { name: 'unnamed_uq', type: 'text' },
            { name: 'composite_a', type: 'text' },
            { name: 'composite_b', type: 'text' },
            { name: 'plain_index', type: 'text' },
          ],
          indexes: [
            {
              columns: ['named_uq'],
              unique: true,
              name: 'uq_catalog_named',
            },
            { columns: ['unnamed_uq'], unique: true },
            {
              columns: ['composite_a', 'composite_b'],
              unique: true,
              name: 'uq_catalog_pair',
            },
            { columns: ['plain_index'], name: 'idx_catalog_plain' },
          ],
        },
      ],
      relations: [],
    });
    const byName = new Map(
      graph.nodes[0].columns.map((column) => [column.name, column]),
    );

    expect(byName.get('inline_uq')?.badges).toContain('UQ');
    expect(byName.get('named_uq')?.badges).toContain('UQ');
    expect(byName.get('unnamed_uq')?.badges).toContain('UQ');
    expect(byName.get('composite_a')?.badges).not.toContain('UQ');
    expect(byName.get('composite_b')?.badges).not.toContain('UQ');
    expect(byName.get('plain_index')?.badges).not.toContain('UQ');
  });

  it('renders two distinct junction rows and edges for a self-referential many-to-many relation', () => {
    const parser = new DbmlParserService();
    parser.setDbmlContent(
      [
        'Table users {',
        '  id int [pk]',
        '}',
        'Ref: users.id <> users.id',
      ].join('\n'),
    );

    const graph = schemaToDiagram(parser.schema());
    const users = graph.nodes.find((node) => node.label === 'users');
    const junction = graph.nodes.find((node) => node.label === 'users_users');
    const junctionEdges = graph.edges.filter(
      (edge) =>
        edge.fromNode === junction?.id &&
        edge.toNode === users?.id,
    );

    expect(junction?.columns.map((column) => column.name)).toEqual([
      'users_source_id',
      'users_target_id',
    ]);
    expect(junctionEdges).toHaveLength(2);
    expect(new Set(junctionEdges.map((edge) => edge.id)).size).toBe(2);
    expect(new Set(junctionEdges.map((edge) => edge.fromColumn))).toEqual(
      new Set(['users_source_id', 'users_target_id']),
    );
  });

  it('uses stable collision-safe IDs when valid names contain delimiters', () => {
    const schema: DatabaseSchema = {
      tables: [
        {
          name: 'a.b',
          alias: null,
          columns: [
            {
              name: 'c',
              type: 'a very long custom type name that remains untouched',
            },
          ],
        },
        {
          name: 'a',
          alias: null,
          columns: [{ name: 'b.c', type: 'text' }],
        },
      ],
      relations: [
        {
          from: { table: 'a.b', column: 'c' },
          to: { table: 'a', column: 'b.c' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.One,
          },
          sourceLine: 50,
        },
      ],
    };
    const first = schemaToDiagram(schema);
    const second = schemaToDiagram({
      ...schema,
      relations: schema.relations.map((relation) => ({
        ...relation,
        sourceLine: 99,
      })),
    });

    expect(new Set(first.nodes.map((node) => node.id)).size).toBe(2);
    expect(first.nodes[0].columns[0].id).not.toBe(first.nodes[1].columns[0].id);
    expect(first.nodes[0].columns[0].type).toBe(
      'a very long custom type name that remains untouched',
    );
    expect(first.edges[0].id).toBe(second.edges[0].id);
    expect(first.nodes.map((node) => node.id)).toEqual(
      second.nodes.map((node) => node.id),
    );
  });

  it('creates ordered west/east row ports shared by multiple relations', () => {
    const graph = schemaToDiagram({
      tables: [
        {
          name: 'orders',
          alias: null,
          columns: [
            { name: 'id', type: 'uuid', pk: true },
            { name: 'owner_id', type: 'uuid', nullable: false },
          ],
        },
        {
          name: 'users',
          alias: null,
          columns: [{ name: 'id', type: 'uuid', pk: true }],
        },
        {
          name: 'placeholder',
          alias: null,
          columns: [{ name: 'id', type: 'uuid', pk: true }],
        },
        {
          name: 'accounts',
          alias: null,
          columns: [{ name: 'id', type: 'uuid', pk: true }],
        },
      ],
      relations: [
        {
          from: { table: 'orders', column: 'owner_id' },
          to: { table: 'users', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.One,
          },
        },
        {
          from: { table: 'orders', column: 'owner_id' },
          to: { table: 'accounts', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.One,
          },
        },
      ],
    });
    const orders = graph.nodes[0];
    const owner = orders.columns[1];
    const ownerPorts = orders.ports.filter(
      (port) => port.columnId === owner.id,
    );

    expect(owner.row).toEqual({ index: 1, y: 76, height: 32, centerY: 92 });
    expect(ownerPorts).toEqual([
      expect.objectContaining({
        id: owner.portIds.west,
        side: 'west',
        order: 1,
        x: 0,
        y: 92,
      }),
      expect.objectContaining({
        id: owner.portIds.east,
        side: 'east',
        order: 1,
        x: 280,
        y: 92,
      }),
    ]);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0].id).not.toBe(graph.edges[1].id);
    expect(graph.edges[0].fromColumnId).toBe(owner.id);
    expect(graph.edges[1].fromColumnId).toBe(owner.id);
    expect(graph.edges[0].layout.sourcePortId).toBe(owner.portIds.east);
    expect(graph.edges[1].layout.sourcePortId).toBe(owner.portIds.east);
    expect(graph.edges[0].layout.path).toMatch(/^M 340 152 /);
    expect(graph.edges[1].layout.path).toMatch(/^M 340 152 /);
  });

  it('expands tall tables so every row and port anchor remains stable', () => {
    const columns = Array.from({ length: 15 }, (_, index) => ({
      name: `column_${index}`,
      type: 'varchar(255)',
      nullable: index % 2 === 0,
    }));
    const graph = schemaToDiagram({
      tables: [
        { name: 'events', alias: null, columns },
        {
          name: 'targets',
          alias: null,
          columns: [{ name: 'id', type: 'varchar(255)', pk: true }],
        },
      ],
      relations: [
        {
          from: { table: 'events', column: 'column_14' },
          to: { table: 'targets', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.One,
          },
        },
      ],
    });
    const events = graph.nodes[0];
    const lastColumn = events.columns[14];
    const eastPort = events.ports.find(
      (port) => port.id === lastColumn.portIds.east,
    );

    expect(events.layout.height).toBe(44 + 15 * 32);
    expect(events.layout.height).toBe(524);
    expect(events.ports).toHaveLength(30);
    expect(lastColumn.row).toEqual({
      index: 14,
      y: 492,
      height: 32,
      centerY: 508,
    });
    expect(eastPort).toEqual(expect.objectContaining({ x: 280, y: 508 }));
    expect(graph.edges[0].layout.path).toMatch(/^M 340 568 /);
    expect(graph.layout.height).toBe(644);
  });

  it.each([
    [Cardinality.One, Cardinality.One, '1:1'],
    [Cardinality.Many, Cardinality.One, 'N:1'],
    [Cardinality.One, Cardinality.Many, '1:N'],
    [Cardinality.Many, Cardinality.Many, 'N:N'],
  ] as const)('maps %s to %s cardinalities', (from, to, expected) => {
    const graph = schemaToDiagram({
      tables: [
        { name: 'a', alias: null, columns: [{ name: 'id', type: 'int' }] },
        { name: 'b', alias: null, columns: [{ name: 'id', type: 'int' }] },
      ],
      relations: [
        {
          from: { table: 'a', column: 'id' },
          to: { table: 'b', column: 'id' },
          cardinality: { from, to },
        },
      ],
    });

    expect(graph.edges[0].cardinality).toBe(expected);
    expect(graph.edges[0].layout).toEqual(
      expect.objectContaining({
        sourceNodeId: graph.edges[0].fromNode,
        sourcePortId: graph.edges[0].layout.sourcePortId,
        targetNodeId: graph.edges[0].toNode,
        targetPortId: graph.edges[0].layout.targetPortId,
        renderCardinality: expected,
      }),
    );
    expect(graph.edges[0].fromEndpoint.cardinality).toBe(from);
    expect(graph.edges[0].toEndpoint.cardinality).toBe(to);
  });

  it('retains exact endpoint roles, nullability and referential actions', () => {
    const graph = schemaToDiagram({
      tables: [
        {
          name: 'posts',
          alias: null,
          columns: [{ name: 'author_id', type: 'uuid', nullable: true }],
        },
        {
          name: 'users',
          alias: null,
          columns: [{ name: 'id', type: 'uuid', pk: true }],
        },
      ],
      relations: [
        {
          from: { table: 'posts', column: 'author_id' },
          to: { table: 'users', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.One,
          },
          onDelete: ReferentialAction.SetNull,
          onUpdate: ReferentialAction.Cascade,
          sourceLine: 12,
        },
      ],
    });
    const edge = graph.edges[0];

    expect(edge.fromEndpoint).toEqual(
      expect.objectContaining({
        nodeId: graph.nodes[0].id,
        nodeName: 'posts',
        columnId: graph.nodes[0].columns[0].id,
        columnName: 'author_id',
        cardinality: 'many',
        role: 'foreign-key',
        nullable: true,
      }),
    );
    expect(edge.toEndpoint).toEqual(
      expect.objectContaining({
        role: 'referenced',
        nullable: false,
      }),
    );
    expect(edge).toEqual(
      expect.objectContaining({
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        sourceLine: 12,
      }),
    );
  });

  it('keeps direct N:N endpoints as peers instead of misbadging either as FK', () => {
    const graph = schemaToDiagram({
      tables: [
        { name: 'users', alias: null, columns: [{ name: 'id', type: 'int' }] },
        { name: 'roles', alias: null, columns: [{ name: 'id', type: 'int' }] },
      ],
      relations: [
        {
          from: { table: 'users', column: 'id' },
          to: { table: 'roles', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.Many,
          },
        },
      ],
    });

    expect(graph.nodes[0].columns[0].badges).not.toContain('FK');
    expect(graph.nodes[1].columns[0].badges).not.toContain('FK');
    expect(graph.edges[0].fromEndpoint.role).toBe('peer');
    expect(graph.edges[0].toEndpoint.role).toBe('peer');
  });

  it('routes an auto-created junction through its FKs without a duplicate N:N edge', () => {
    const graph = schemaToDiagram({
      tables: [
        { name: 'users', alias: null, columns: [{ name: 'id', type: 'int' }] },
        { name: 'roles', alias: null, columns: [{ name: 'id', type: 'int' }] },
        {
          name: 'users_roles',
          alias: null,
          isJunction: true,
          columns: [
            {
              name: 'users_id',
              type: 'int',
              pk: true,
              ref: {
                table: 'users',
                column: 'id',
                cardinality: {
                  from: Cardinality.Many,
                  to: Cardinality.One,
                },
              },
            },
            {
              name: 'roles_id',
              type: 'int',
              pk: true,
              ref: {
                table: 'roles',
                column: 'id',
                cardinality: {
                  from: Cardinality.Many,
                  to: Cardinality.One,
                },
              },
            },
          ],
        },
      ],
      relations: [
        {
          from: { table: 'users', column: 'id' },
          to: { table: 'roles', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.Many,
          },
        },
      ],
    });

    const junction = graph.nodes.find((node) => node.label === 'users_roles');
    expect(junction).toBeDefined();
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.every((edge) => edge.cardinality === 'N:1')).toBe(true);
    expect(graph.edges.every((edge) => edge.fromNode === junction?.id)).toBe(
      true,
    );
    expect(
      new Set(graph.edges.map((edge) => edge.toEndpoint.nodeName)),
    ).toEqual(new Set(['users', 'roles']));
  });

  it('renders self-relations as loops and degrades malformed endpoints per edge', () => {
    const graph = schemaToDiagram({
      tables: [
        {
          name: 'users',
          alias: null,
          columns: [
            { name: 'id', type: 'int' },
            { name: 'manager_id', type: 'int', nullable: true },
          ],
        },
      ],
      relations: [
        {
          from: { table: 'users', column: 'manager_id' },
          to: { table: 'users', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.One,
          },
        },
        {
          from: { table: 'users', column: 'missing_column' },
          to: { table: 'users', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.One,
          },
        },
        {
          from: { table: 'missing_table', column: 'id' },
          to: { table: 'users', column: 'id' },
          cardinality: {
            from: Cardinality.Many,
            to: Cardinality.One,
          },
        },
      ],
    });

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].selfRelation).toBe(true);
    expect(graph.edges[0].layout.path).toContain(' C ');
    expect(graph.edges[0].layout.sourcePortId).toBe(
      graph.nodes[0].columns[1].portIds.east,
    );
    expect(graph.edges[0].layout.targetPortId).toBe(
      graph.nodes[0].columns[0].portIds.east,
    );
    expect(graph.edges[0].layout).toEqual(
      expect.objectContaining({
        sourceNodeId: graph.edges[0].fromNode,
        sourcePortId: graph.edges[0].layout.sourcePortId,
        targetNodeId: graph.edges[0].toNode,
        targetPortId: graph.edges[0].layout.targetPortId,
        renderCardinality: 'N:1',
      }),
    );
  });

  it('gives equivalent parallel relations distinct stable edge IDs', () => {
    const schema: DatabaseSchema = {
      tables: [
        { name: 'a', alias: null, columns: [{ name: 'id', type: 'int' }] },
        { name: 'b', alias: null, columns: [{ name: 'id', type: 'int' }] },
      ],
      relations: Array.from({ length: 2 }, () => ({
        from: { table: 'a', column: 'id' },
        to: { table: 'b', column: 'id' },
        cardinality: {
          from: Cardinality.Many,
          to: Cardinality.One,
        },
      })),
    };

    const first = schemaToDiagram(schema);
    const second = schemaToDiagram(schema);
    expect(first.edges[0].id).not.toBe(first.edges[1].id);
    expect(first.edges.map((edge) => edge.id)).toEqual(
      second.edges.map((edge) => edge.id),
    );
    expect(first.edges[0].layout.sourcePortId).toBe(
      first.edges[1].layout.sourcePortId,
    );
    expect(first.edges[0].layout.targetPortId).toBe(
      first.edges[1].layout.targetPortId,
    );
  });
});
