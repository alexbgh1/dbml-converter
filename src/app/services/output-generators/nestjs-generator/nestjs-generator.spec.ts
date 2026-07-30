import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DbmlParserService } from '../../dbml-parser/dbml-parser';
import { NestjsGeneratorService } from './nestjs-generator.service';
import { GeneratedCode } from './interfaces/nestjs-generator.interface';

describe('NestjsGeneratorService', () => {
  let parser: DbmlParserService;
  let generator: NestjsGeneratorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    parser = TestBed.inject(DbmlParserService);
    generator = TestBed.inject(NestjsGeneratorService);
  });

  function generate(dbml: string): GeneratedCode {
    parser.setDbmlContent(dbml);
    TestBed.flushEffects();
    return generator.generateCode(parser.schema()!);
  }

  describe('Column types', () => {
    it('should generate uuid primary keys with @PrimaryGeneratedColumn', () => {
      const { entities } = generate(`
        Table users {
          id uuid [pk]
        }
      `);

      expect(entities['users.entity.ts']).toContain(
        "@PrimaryGeneratedColumn('uuid')",
      );
    });

    it('should keep explicit type and length on plain primary keys', () => {
      const { entities } = generate(`
        Table locales {
          code varchar(10) [pk]
        }
        Table counters {
          id bigint [pk]
        }
      `);

      expect(entities['locales.entity.ts']).toContain(
        "@PrimaryColumn({ type: 'varchar', length: 10 })",
      );
      expect(entities['counters.entity.ts']).toContain(
        "@PrimaryColumn({ type: 'bigint' })",
      );
    });

    it('should generate decimal with precision and scale (not float)', () => {
      const { entities } = generate(`
        Table products {
          price decimal(10,2) [not null]
        }
      `);

      expect(entities['products.entity.ts']).toContain(
        "@Column({ type: 'decimal', precision: 10, scale: 2 })",
      );
    });

    it('should mark nullable columns explicitly (DBML default)', () => {
      const { entities } = generate(`
        Table products {
          description text
        }
      `);

      expect(entities['products.entity.ts']).toContain('nullable: true');
      expect(entities['products.entity.ts']).toContain(
        'description!: string | null;',
      );
    });

    it('should keep unique and nullability as independent constraints', () => {
      const { entities } = generate(`
        Table users {
          email varchar [unique]
          username varchar [unique, not null]
        }
      `);

      const users = entities['users.entity.ts'];
      expect(users).toContain(
        "@Column({ type: 'varchar', nullable: true, unique: true })",
      );
      expect(users).toContain('email!: string | null;');
      expect(users).toContain("@Column({ type: 'varchar', unique: true })");
      expect(users).toContain('username!: string;');
    });

    it('should emit expression defaults as functions', () => {
      const { entities } = generate(`
        Table logs {
          logged_at timestamp [default: \`now()\`]
        }
      `);

      expect(entities['logs.entity.ts']).toContain("default: () => 'now()'");
    });

    it('should use definite assignment for all generated properties', () => {
      const { entities } = generate(`
        Table users {
          id int [pk]
          email varchar [not null]
        }
        Table posts {
          id int [pk]
          user_id int [ref: > users.id]
        }
      `);

      expect(entities['users.entity.ts']).toContain('id!: number;');
      expect(entities['users.entity.ts']).toContain('email!: string;');
      expect(entities['users.entity.ts']).toContain('posts!: Posts[];');
      expect(entities['posts.entity.ts']).toContain('users!: Users | null;');
      expect(entities['users.entity.ts']).not.toMatch(/\n {2}\w+: /);
    });

    it('should not classify unknown types by substring (point is not int)', () => {
      const { entities } = generate(`
        Table places {
          id int [pk]
          location point
        }
      `);

      expect(entities['places.entity.ts']).toContain(
        "@Column({ type: 'varchar', nullable: true })",
      );
      expect(entities['places.entity.ts']).toContain(
        'location!: string | null;',
      );
    });

    it('should apply lifecycle decorators only to recognized timestamp names and types', () => {
      const { entities } = generate(`
        Table audits {
          creation_date timestamp
          modification_date datetime
          deletion_date timestamptz
          updated_at varchar
        }
      `);

      const audits = entities['audits.entity.ts'];
      expect(audits).toContain('@CreateDateColumn');
      expect(audits).toContain('@UpdateDateColumn');
      expect(audits).toContain('@DeleteDateColumn');
      expect(audits).toContain(
        "@Column({ type: 'varchar', nullable: true })\n  updated_at!: string | null;",
      );
    });
  });

  describe('Many-to-many junction tables', () => {
    const dbml = `
      Table users {
        id int [pk]
      }
      Table roles {
        id int [pk]
      }
      Ref: users.id <> roles.id
    `;

    it('should model pure junctions as @ManyToMany instead of an entity', () => {
      const { entities, module } = generate(dbml);

      expect(entities['users_roles.entity.ts']).toBeUndefined();
      expect(module).not.toContain('UsersRoles');

      expect(entities['users.entity.ts']).toContain(
        '@ManyToMany(() => Roles, roles => roles.users)',
      );
      expect(entities['users.entity.ts']).toContain(
        [
          '@JoinTable({',
          "    name: 'users_roles',",
          "    joinColumn: { name: 'users_id', referencedColumnName: 'id' },",
          "    inverseJoinColumn: { name: 'roles_id', referencedColumnName: 'id' },",
          '  })',
        ].join('\n'),
      );

      expect(entities['roles.entity.ts']).toContain(
        '@ManyToMany(() => Users, users => users.roles)',
      );
      expect(entities['roles.entity.ts']).not.toContain('@JoinTable');
    });

    it('should name join columns declared with non-conventional names', () => {
      const { entities } = generate(`
        Table users {
          id uuid [pk]
        }
        Table roles {
          id uuid [pk]
        }
        Table user_role_links {
          account_uuid uuid [ref: > users.id]
          permission_uuid uuid [ref: > roles.id]

          indexes {
            (account_uuid, permission_uuid) [pk]
          }
        }
        Ref user_role_links: users.id <> roles.id
      `);

      expect(entities['user_role_links.entity.ts']).toBeUndefined();

      expect(entities['users.entity.ts']).toContain(
        [
          '@JoinTable({',
          "    name: 'user_role_links',",
          "    joinColumn: { name: 'account_uuid', referencedColumnName: 'id' },",
          "    inverseJoinColumn: { name: 'permission_uuid', referencedColumnName: 'id' },",
          '  })',
        ].join('\n'),
      );

      expect(entities['roles.entity.ts']).not.toContain('@JoinTable');
    });

    it('should use distinct physical join columns for a self-referential junction', () => {
      const { entities, diagnostics } = generate(`
        Table users {
          id int [pk]
        }
        Ref: users.id <> users.id
      `);
      const users = entities['users.entity.ts'];

      expect(entities['users_users.entity.ts']).toBeUndefined();
      expect(users).toContain('@ManyToMany(() => Users, users => users.users)');
      expect(users).toContain(
        [
          '@JoinTable({',
          "    name: 'users_users',",
          "    joinColumn: { name: 'users_source_id', referencedColumnName: 'id' },",
          "    inverseJoinColumn: { name: 'users_target_id', referencedColumnName: 'id' },",
          '  })',
        ].join('\n'),
      );
      expect(
        diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === 'OUTPUT_PROPERTY_COLLISION' ||
            diagnostic.code === 'OUTPUT_NAME_COLLISION',
        ),
      ).toHaveLength(0);
    });

    it('should support a named long-form DBML relation with non-id referenced columns', () => {
      const { entities } = generate(`
        Table accounts {
          account_uuid uuid [pk]
        }
        Table permissions {
          permission_code varchar [pk]
        }
        Ref account_permissions {
          accounts.account_uuid <> permissions.permission_code
        }
      `);

      const junction = parser
        .schema()
        ?.tables.find((table) => table.name === 'account_permissions');

      expect(junction?.isJunction).toBe(true);
      expect(
        junction?.columns.map((column) => ({
          name: column.name,
          type: column.type,
          ref: column.ref && {
            table: column.ref.table,
            column: column.ref.column,
          },
        })),
      ).toEqual([
        {
          name: 'accounts_account_uuid',
          type: 'uuid',
          ref: { table: 'accounts', column: 'account_uuid' },
        },
        {
          name: 'permissions_permission_code',
          type: 'varchar',
          ref: { table: 'permissions', column: 'permission_code' },
        },
      ]);

      expect(entities['account_permissions.entity.ts']).toBeUndefined();
      expect(entities['accounts.entity.ts']).toContain(
        [
          '@JoinTable({',
          "    name: 'account_permissions',",
          "    joinColumn: { name: 'accounts_account_uuid', referencedColumnName: 'account_uuid' },",
          "    inverseJoinColumn: { name: 'permissions_permission_code', referencedColumnName: 'permission_code' },",
          '  })',
        ].join('\n'),
      );
      expect(entities['permissions.entity.ts']).not.toContain('@JoinTable');
    });

    it('should use the first declared junction FK as owner when its order is reversed', () => {
      const { entities } = generate(`
        Table users {
          user_uuid uuid [pk]
        }
        Table roles {
          role_code varchar [pk]
        }
        Table user_role_links {
          permission_code varchar [ref: > roles.role_code]
          account_uuid uuid [ref: > users.user_uuid]

          indexes {
            (permission_code, account_uuid) [pk]
          }
        }
        Ref user_role_links: users.user_uuid <> roles.role_code
      `);

      const junction = parser
        .schema()
        ?.tables.find((table) => table.name === 'user_role_links');

      expect(junction?.isJunction).toBe(true);
      expect(
        junction?.columns.map((column) => ({
          name: column.name,
          refTable: column.ref?.table,
          refColumn: column.ref?.column,
        })),
      ).toEqual([
        {
          name: 'permission_code',
          refTable: 'roles',
          refColumn: 'role_code',
        },
        {
          name: 'account_uuid',
          refTable: 'users',
          refColumn: 'user_uuid',
        },
      ]);

      expect(entities['user_role_links.entity.ts']).toBeUndefined();
      expect(entities['roles.entity.ts']).toContain(
        [
          '@JoinTable({',
          "    name: 'user_role_links',",
          "    joinColumn: { name: 'permission_code', referencedColumnName: 'role_code' },",
          "    inverseJoinColumn: { name: 'account_uuid', referencedColumnName: 'user_uuid' },",
          '  })',
        ].join('\n'),
      );
      expect(entities['users.entity.ts']).not.toContain('@JoinTable');
    });

    it('should keep a junction with payload columns as its own entity', () => {
      const { entities, module } = generate(`
        Table users {
          id int [pk]
        }
        Table roles {
          id int [pk]
        }
        Table user_role_memberships {
          user_id int [ref: > users.id]
          role_id int [ref: > roles.id]
          granted_at timestamp [not null]

          indexes {
            (user_id, role_id) [pk]
          }
        }
        Ref user_role_memberships: users.id <> roles.id
      `);

      expect(
        parser
          .schema()
          ?.tables.find((table) => table.name === 'user_role_memberships')
          ?.isJunction,
      ).toBe(true);
      expect(entities['user_role_memberships.entity.ts']).toBeDefined();
      expect(module).toContain('UserRoleMemberships');
      expect(entities['users.entity.ts']).not.toContain('@ManyToMany');
      expect(entities['roles.entity.ts']).not.toContain('@ManyToMany');
      expect(entities['users.entity.ts']).not.toContain('@JoinTable');
      expect(entities['roles.entity.ts']).not.toContain('@JoinTable');

      const membership = entities['user_role_memberships.entity.ts'];
      expect(membership).toContain(
        [
          "@PrimaryColumn({ type: 'int', name: 'user_id' })",
          '  user_id!: number;',
          '',
          '  @ManyToOne(() => Users, users => users.userRoleMemberships, { nullable: false })',
          "  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })",
          '  users!: Users;',
        ].join('\n'),
      );
      expect(membership).toContain(
        [
          "@PrimaryColumn({ type: 'int', name: 'role_id' })",
          '  role_id!: number;',
          '',
          '  @ManyToOne(() => Roles, roles => roles.userRoleMemberships, { nullable: false })',
          "  @JoinColumn({ name: 'role_id', referencedColumnName: 'id' })",
          '  roles!: Roles;',
        ].join('\n'),
      );
    });
  });

  describe('Foreign-key primary columns', () => {
    it('should separate scalar ids from both self-referential relations', () => {
      const { entities, diagnostics } = generate(`
        Table users {
          id integer [pk, increment]
          username varchar [not null, unique]
          created_at timestamp [default: \`now()\`]
        }

        Table user_follows {
          follower_id integer [not null]
          followed_id integer [not null]
          created_at timestamp [default: \`now()\`]

          indexes {
            (follower_id, followed_id) [pk]
          }
        }

        Ref: users.id < user_follows.follower_id
        Ref: users.id < user_follows.followed_id
      `);

      const users = entities['users.entity.ts'];
      const userFollows = entities['user_follows.entity.ts'];

      expect(userFollows).toContain(
        [
          "@PrimaryColumn({ type: 'int', name: 'follower_id' })",
          '  follower_id!: number;',
          '',
          '  @ManyToOne(() => Users, users => users.userFollowsFollower, { nullable: false })',
          "  @JoinColumn({ name: 'follower_id', referencedColumnName: 'id' })",
          '  follower!: Users;',
        ].join('\n'),
      );
      expect(userFollows).toContain(
        [
          "@PrimaryColumn({ type: 'int', name: 'followed_id' })",
          '  followed_id!: number;',
          '',
          '  @ManyToOne(() => Users, users => users.userFollowsFollowed, { nullable: false })',
          "  @JoinColumn({ name: 'followed_id', referencedColumnName: 'id' })",
          '  followed!: Users;',
        ].join('\n'),
      );
      expect(users).toContain(
        '@OneToMany(() => UserFollows, userFollows => userFollows.follower)',
      );
      expect(users).toContain(
        '@OneToMany(() => UserFollows, userFollows => userFollows.followed)',
      );
      expect(userFollows).toContain('PrimaryColumn');
      expect(userFollows).not.toContain('PrimaryGeneratedColumn');
      expect(userFollows).not.toMatch(
        /@PrimaryColumn\([^\n]*\)\n {2}@(?:ManyToOne|OneToOne)/,
      );
      expect(
        diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === 'OUTPUT_PROPERTY_COLLISION' ||
            diagnostic.code === 'OUTPUT_INVALID_IDENTIFIER',
        ),
      ).toEqual([]);
    });

    it('should preserve named composite keys, scalar indexes and column types', () => {
      const { entities } = generate(`
        Table orders {
          id uuid [pk]
        }
        Table products {
          id int [pk]
        }
        Table order_items {
          order_id uuid [not null, ref: > orders.id, delete: cascade]
          product_id int [not null, ref: > products.id]
          quantity int [not null]

          indexes {
            (order_id, product_id) [pk, name: 'pk_order_items']
            product_id [name: 'idx_order_items_product']
          }
        }
      `);

      const orderItems = entities['order_items.entity.ts'];
      expect(orderItems).toContain(
        "@Index(\"idx_order_items_product\", ['product_id'])",
      );
      expect(orderItems).toContain(
        `@PrimaryColumn({ type: 'uuid', name: 'order_id', primaryKeyConstraintName: "pk_order_items" })`,
      );
      expect(orderItems).toContain('order_id!: string;');
      expect(orderItems).toContain(
        `@PrimaryColumn({ type: 'int', name: 'product_id', primaryKeyConstraintName: "pk_order_items" })`,
      );
      expect(orderItems).toContain('product_id!: number;');
      expect(orderItems).toContain(
        "{ nullable: false, onDelete: 'CASCADE' }",
      );
      expect(orderItems.match(/primaryKeyConstraintName/g)).toHaveLength(2);
      expect(orderItems).not.toContain('PrimaryGeneratedColumn');
    });

    it('should support shared string primary keys that reference a non-id column', () => {
      const { entities } = generate(`
        Table accounts {
          code varchar(32) [pk]
        }
        Table account_profiles {
          account_code varchar(32) [pk, ref: - accounts.code]
        }
      `);

      const accountProfiles = entities['account_profiles.entity.ts'];
      expect(accountProfiles).toContain(
        "import { Entity, PrimaryColumn, OneToOne, JoinColumn } from 'typeorm';",
      );
      expect(accountProfiles).not.toContain('Entity, Column');
      expect(accountProfiles).toContain(
        "@PrimaryColumn({ type: 'varchar', name: 'account_code', length: 32 })",
      );
      expect(accountProfiles).toContain('account_code!: string;');
      expect(accountProfiles).toContain(
        '@OneToOne(() => Accounts, accounts => accounts.accountProfiles, { nullable: false })',
      );
      expect(accountProfiles).toContain(
        "@JoinColumn({ name: 'account_code', referencedColumnName: 'code' })",
      );
      expect(accountProfiles).toContain('accounts!: Accounts;');
    });

    it('should mirror a collision-safe OneToOne name on the inverse side', () => {
      const { entities, diagnostics } = generate(`
        Table accounts {
          id int [pk]
        }
        Table profiles {
          accounts int [pk, ref: - accounts.id]
        }
      `);

      const profiles = entities['profiles.entity.ts'];
      const accounts = entities['accounts.entity.ts'];

      expect(profiles).toContain('accounts!: number;');
      expect(profiles).toContain('accountsRelation!: Accounts;');
      expect(accounts).toContain(
        '@OneToOne(() => Profiles, profiles => profiles.accountsRelation)',
      );
      expect(
        diagnostics.some(
          (diagnostic) =>
            diagnostic.code === 'OUTPUT_PROPERTY_COLLISION' &&
            diagnostic.details?.['generatedPropertyName'] ===
              'accountsRelation',
        ),
      ).toBe(true);
    });

    it('should allocate distinct fallback names for ambiguous sibling FKs', () => {
      const { entities, diagnostics } = generate(`
        Table users {
          id int [pk]
        }
        Table user_links {
          user int [pk, ref: > users.id]
          user_id int [pk, ref: > users.id]
        }
      `);

      const userLinks = entities['user_links.entity.ts'];
      const users = entities['users.entity.ts'];

      expect(userLinks).toContain('user!: number;');
      expect(userLinks).toContain('user_id!: number;');
      expect(userLinks).toContain('userRelation!: Users;');
      expect(userLinks).toContain('userRelation2!: Users;');
      expect(users).toContain(
        '@OneToMany(() => UserLinks, userLinks => userLinks.userRelation)',
      );
      expect(users).toContain(
        '@OneToMany(() => UserLinks, userLinks => userLinks.userRelation2)',
      );
      expect(
        diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === 'OUTPUT_PROPERTY_COLLISION' &&
            ['userRelation', 'userRelation2'].includes(
              diagnostic.details?.['generatedPropertyName'] as string,
            ),
        ),
      ).toHaveLength(2);
    });

    it('should preserve ordinary non-primary foreign-key output', () => {
      const { entities } = generate(`
        Table users {
          id int [pk]
        }
        Table posts {
          id int [pk]
          user_id int [ref: > users.id]
        }
      `);

      const posts = entities['posts.entity.ts'];
      expect(posts).toContain('@ManyToOne(() => Users');
      expect(posts).toContain("@JoinColumn({ name: 'user_id' })");
      expect(posts).toContain('users!: Users | null;');
      expect(posts).not.toContain('user_id!: number');
      expect(posts).not.toContain("referencedColumnName: 'id'");
    });
  });

  describe('Enums', () => {
    it('should generate an enums file and typed columns', () => {
      const { entities } = generate(`
        Enum order_status {
          pending
          approved
        }
        Table orders {
          id int [pk]
          status order_status
        }
      `);

      expect(entities['enums.ts']).toContain('export enum OrderStatus');
      expect(entities['orders.entity.ts']).toContain(
        "import { OrderStatus } from './enums';",
      );
      expect(entities['orders.entity.ts']).toContain(
        "type: 'enum', enum: OrderStatus",
      );
    });

    it('should deduplicate enum imports per entity and reuse enums across entities', () => {
      const { entities } = generate(`
        Enum status {
          active
        }
        Table users {
          status status
          previous_status status
        }
        Table orders {
          status status
        }
      `);

      expect(
        entities['users.entity.ts'].match(
          /import \{ Status \} from '\.\/enums';/g,
        ),
      ).toHaveLength(1);
      expect(entities['orders.entity.ts']).toContain(
        "import { Status } from './enums';",
      );
    });
  });

  describe('Named indexes', () => {
    const dbml = `
      Table users {
        id int
        tenant_id int
        email varchar

        indexes {
          id [pk, name: 'pk_users']
          email [unique, name: 'uq_users_email']
          (tenant_id, email) [name: 'idx_users_tenant_email']
        }
      }
    `;

    it('should preserve primary, unique and plain index names', () => {
      const entities = generate(dbml).entities;
      const users = entities['users.entity.ts'];

      expect(users).toContain(
        '@PrimaryColumn({ type: \'int\', primaryKeyConstraintName: "pk_users" })',
      );
      expect(users).toContain(
        '@Index("uq_users_email", [\'email\'], { unique: true })',
      );
      expect(users).toContain(
        "@Index(\"idx_users_tenant_email\", ['tenant_id', 'email'])",
      );
      expect(users).not.toContain(
        "type: 'varchar', nullable: true, unique: true",
      );
    });
  });

  describe('Relation disambiguation', () => {
    it('should derive property names from FK columns when needed', () => {
      const { entities } = generate(`
        Table users {
          id int [pk]
        }
        Table messages {
          id int [pk]
          sender_id int [ref: > users.id]
          receiver_id int [ref: > users.id]
        }
      `);

      const messages = entities['messages.entity.ts'];
      expect(messages).toContain('sender!: Users | null;');
      expect(messages).toContain('receiver!: Users | null;');

      const users = entities['users.entity.ts'];
      expect(users).toContain('messagesSender!: Messages[];');
      expect(users).toContain('messagesReceiver!: Messages[];');
    });
  });

  describe('One-to-one relation classification', () => {
    it('should import OneToOne on both sides of an explicit inline relation', () => {
      const { entities } = generate(`
        Table users {
          id int [pk]
        }
        Table profiles {
          id int [pk]
          user_id int [ref: - users.id]
        }
      `);

      const profiles = entities['profiles.entity.ts'];
      const users = entities['users.entity.ts'];

      expect(profiles).toContain('OneToOne');
      expect(profiles).toContain('@OneToOne(() => Users');
      expect(profiles).not.toContain('ManyToOne');
      expect(users).toContain('OneToOne');
      expect(users).toContain('@OneToOne(() => Profiles');
      expect(users).not.toContain('OneToMany');
    });

    it('should classify an explicit global one-to-one relation consistently', () => {
      const { entities } = generate(`
        Table users {
          id int [pk]
        }
        Table profiles {
          id int [pk]
          user_id int
        }
        Ref: profiles.user_id - users.id
      `);

      expect(entities['profiles.entity.ts']).toContain('@OneToOne(() => Users');
      expect(entities['profiles.entity.ts']).not.toContain('ManyToOne');
      expect(entities['users.entity.ts']).toContain('@OneToOne(() => Profiles');
      expect(entities['users.entity.ts']).not.toContain('OneToMany');
    });

    it('should preserve unique and ordinary many-to-one classification', () => {
      const { entities } = generate(`
        Table users {
          id int [pk]
        }
        Table profiles {
          id int [pk]
          user_id int [unique, ref: > users.id]
        }
        Table posts {
          id int [pk]
          user_id int [ref: > users.id]
        }
      `);

      expect(entities['profiles.entity.ts']).toContain('@OneToOne(() => Users');
      expect(entities['posts.entity.ts']).toContain('@ManyToOne(() => Users');
      expect(entities['users.entity.ts']).toContain('@OneToOne(() => Profiles');
      expect(entities['users.entity.ts']).toContain('@OneToMany(() => Posts');
    });

    it('should import OneToOne for an explicit self relation', () => {
      const { entities } = generate(`
        Table employees {
          id int [pk]
          manager_id int [ref: - employees.id]
        }
      `);

      const employees = entities['employees.entity.ts'];
      expect(employees).toContain('OneToOne');
      expect(employees).toContain('@OneToOne(() => Employees');
      expect(employees).not.toContain('ManyToOne');
      expect(employees).not.toContain('OneToMany');
    });
  });

  describe('Output validation diagnostics', () => {
    function diagnosticsFor(dbml: string) {
      parser.setDbmlContent(dbml);
      TestBed.flushEffects();
      return generator.generateCode(parser.schema()!).diagnostics;
    }

    it('should return no diagnostics for a clean schema', () => {
      const diagnostics = diagnosticsFor(`
        Table users {
          id int [pk]
          email varchar
        }
      `);
      expect(diagnostics).toEqual([]);
    });

    it('should report class names that collide with TypeORM imports', () => {
      const diagnostics = diagnosticsFor(`
        Table entity {
          id int [pk]
        }
      `);
      const collision = diagnostics.find(
        (d) => d.code === 'TYPEORM_IMPORT_NAME_COLLISION',
      );
      expect(collision).toBeTruthy();
      expect(collision?.target).toBe('typeorm');
    });

    it('should report enum imports that collide with TypeORM imports', () => {
      const diagnostics = diagnosticsFor(`
        Enum column {
          active
        }
        Table users {
          status column
        }
      `);

      expect(
        diagnostics.some((d) => d.code === 'TYPEORM_IMPORT_NAME_COLLISION'),
      ).toBe(true);
    });

    it('should validate TypeScript enum names and members', () => {
      const result = generator.generateCode({
        tables: [],
        relations: [],
        enums: [
          {
            name: '1_status',
            values: ['2_invalid'],
            sourceLine: 1,
            valueSourceLines: [2],
          },
        ],
      });

      expect(
        result.diagnostics.filter(
          (d) => d.code === 'OUTPUT_INVALID_IDENTIFIER',
        ),
      ).toHaveLength(2);
    });

    it('should report generated class name collisions', () => {
      const diagnostics = diagnosticsFor(`
        Table user_profiles {
          id int [pk]
        }
        Table user__profiles {
          id int [pk]
        }
      `);
      const collision = diagnostics.find(
        (d) => d.code === 'OUTPUT_NAME_COLLISION',
      );
      expect(collision).toBeTruthy();
      expect(collision?.message).toContain('UserProfiles');
    });

    it('should report scalar/relation property collisions', () => {
      const diagnostics = diagnosticsFor(`
        Table users {
          id int [pk]
          posts text
        }
        Table posts {
          id int [pk]
          user_id int [ref: > users.id]
        }
      `);
      const collision = diagnostics.find(
        (d) => d.code === 'OUTPUT_PROPERTY_COLLISION',
      );
      expect(collision).toBeTruthy();
      expect(collision?.details?.['propertyName']).toBe('posts');
    });

    it('should report a collision between FK primary scalar and relation names', () => {
      const { diagnostics, entities } = generate(`
        Table users {
          id int [pk]
        }
        Table memberships {
          users int [pk, ref: > users.id]
          usersRelation text [not null]
        }
      `);

      const collision = diagnostics.find(
        (diagnostic) =>
          diagnostic.code === 'OUTPUT_PROPERTY_COLLISION' &&
          diagnostic.details?.['propertyName'] === 'users',
      );
      expect(collision).toBeTruthy();
      expect(collision?.schemaPath).toBe(
        'tables.memberships.columns.users',
      );
      expect(collision?.details?.['generatedPropertyName']).toBe(
        'usersRelation2',
      );

      const memberships = entities['memberships.entity.ts'];
      expect(memberships).toContain('users!: number;');
      expect(memberships).toContain('usersRelation!: string;');
      expect(memberships).toContain('usersRelation2!: Users;');
      expect(memberships.match(/\n {2}users!:/g)).toHaveLength(1);
    });

    it('should validate the newly emitted FK primary scalar identifier', () => {
      const diagnostics = diagnosticsFor(`
        Table users {
          id int [pk]
        }
        Table memberships {
          1_owner int [pk, ref: > users.id]
        }
      `);

      const invalidIdentifier = diagnostics.find(
        (diagnostic) =>
          diagnostic.code === 'OUTPUT_INVALID_IDENTIFIER' &&
          diagnostic.schemaPath === 'tables.memberships.columns.1_owner',
      );
      expect(invalidIdentifier).toBeTruthy();
    });

    it('should warn about unknown type fallbacks', () => {
      const diagnostics = diagnosticsFor(`
        Table places {
          id int [pk]
          location geography
        }
      `);
      const fallback = diagnostics.find(
        (d) => d.code === 'OUTPUT_UNKNOWN_TYPE_FALLBACK',
      );
      expect(fallback).toBeTruthy();
      expect(fallback?.message).toContain('geography');
    });

    it('should warn when an FK primary scalar uses an unknown type', () => {
      const diagnostics = diagnosticsFor(`
        Table users {
          id int [pk]
        }
        Table memberships {
          user_id geography [pk, ref: > users.id]
        }
      `);

      const fallback = diagnostics.find(
        (diagnostic) =>
          diagnostic.code === 'OUTPUT_UNKNOWN_TYPE_FALLBACK' &&
          diagnostic.schemaPath === 'tables.memberships.columns.user_id',
      );
      expect(fallback).toBeTruthy();
    });
  });

  describe('Referential actions', () => {
    const cases = [
      {
        syntax: 'inline',
        dbml: `
          Table users {
            id int [pk]
          }
          Table posts {
            id int [pk]
            user_id int [ref: > users.id, delete: cascade, update: no action]
          }
        `,
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
      {
        syntax: 'short-form',
        dbml: `
          Table users {
            id int [pk]
          }
          Table posts {
            id int [pk]
            user_id int
          }
          Ref: posts.user_id > users.id [delete: restrict, update: set null]
        `,
        onDelete: 'RESTRICT',
        onUpdate: 'SET NULL',
      },
      {
        syntax: 'long-form',
        dbml: `
          Table users {
            id int [pk]
          }
          Table posts {
            id int [pk]
          }
          Ref post_owner {
            posts.user_id > users.id [delete: set null, update: no action]
          }
        `,
        onDelete: 'SET NULL',
        onUpdate: 'NO ACTION',
      },
      {
        syntax: 'short-form with normalized < operator',
        dbml: `
          Table users {
            id int [pk]
          }
          Table posts {
            id int [pk]
            user_id int
          }
          Ref: users.id < posts.user_id [delete: cascade, update: restrict]
        `,
        onDelete: 'CASCADE',
        onUpdate: 'RESTRICT',
      },
    ];

    for (const testCase of cases) {
      it(`should forward ${testCase.syntax} actions to TypeORM relation options`, () => {
        const { entities } = generate(testCase.dbml);
        const posts = entities['posts.entity.ts'];

        expect(posts).toContain(`onDelete: '${testCase.onDelete}'`);
        expect(posts).toContain(`onUpdate: '${testCase.onUpdate}'`);
      });
    }
  });
});
