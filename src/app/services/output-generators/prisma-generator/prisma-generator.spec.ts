import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DbmlParserService } from '../../dbml-parser/dbml-parser';
import { PrismaGeneratorService } from './prisma-generator.service';

describe('PrismaGeneratorService', () => {
  let parser: DbmlParserService;
  let generator: PrismaGeneratorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    parser = TestBed.inject(DbmlParserService);
    generator = TestBed.inject(PrismaGeneratorService);
  });

  function generate(dbml: string): string {
    parser.setDbmlContent(dbml);
    TestBed.flushEffects();
    return generator.generateCode(parser.schema()!).schema;
  }

  /* Extract a single model block from the generated schema */
  function modelBlock(schema: string, modelName: string): string {
    const match = schema.match(
      new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`),
    );
    return match?.[0] ?? '';
  }

  describe('Regression: tables with multiple FKs (the "dupped id" bug)', () => {
    const dbml = `
      Table users {
        id uuid [pk]
        email varchar [unique, not null]
        created_at timestamp [default: \`now()\`]
      }
      Table order_statuses {
        id integer [pk]
        name varchar
      }
      Table orders {
        id uuid [pk]
        user_id uuid [ref: > users.id, not null]
        status_id integer [ref: > order_statuses.id]
        total_amount decimal(10,2)
        note: 'Pedidos con Mercado Pago'
      }
    `;

    it('should NOT inject a surrogate autoincrement id', () => {
      const schema = generate(dbml);
      expect(schema).not.toContain('autoincrement');
    });

    it('should keep exactly one id field per model, with @id', () => {
      const orders = modelBlock(generate(dbml), 'Orders');
      const idFields = orders
        .split('\n')
        .filter((l) => l.trim().startsWith('id '));

      expect(idFields.length).toBe(1);
      expect(idFields[0]).toContain('@id');
    });

    it('should generate uuid primary keys with @default(uuid()) and @db.Uuid', () => {
      const users = modelBlock(generate(dbml), 'Users');
      expect(users).toContain('id String @id @default(uuid()) @db.Uuid');
    });

    it('should not emit a native length for plain varchar', () => {
      const users = modelBlock(generate(dbml), 'Users');
      expect(users).not.toContain('@db.VarChar');
    });

    it('should not classify unknown types by substring (point is not Int)', () => {
      const schema = generate(`
        Table places {
          id int [pk]
          location point
        }
      `);

      expect(schema).toContain('location String?');
      expect(schema).not.toContain('location Int');
    });

    it('should emit @db.VarChar(n) when a length is declared', () => {
      const schema = generate(`
        Table users {
          id int [pk]
          email varchar(255)
        }
      `);
      expect(schema).toContain('email String? @db.VarChar(255)');
    });

    it('should keep unique and nullability as independent constraints', () => {
      const users = modelBlock(
        generate(`
          Table users {
            email varchar [unique]
            username varchar [unique, not null]
          }
        `),
        'Users',
      );

      expect(users).toContain('email String? @unique');
      expect(users).toContain('username String @unique');
    });

    it('should map models to their physical table names', () => {
      const schema = generate(dbml);
      expect(schema).toContain('@@map("users")');
      expect(schema).toContain('@@map("orders")');
      expect(schema).toContain('@@map("order_statuses")');
    });

    it('should apply @updatedAt only to recognized timestamp names and types', () => {
      const audits = modelBlock(
        generate(`
          Table audits {
            modification_date timestamp
            updated_at varchar
          }
        `),
        'Audits',
      );

      expect(audits).toContain(
        'modification_date DateTime? @updatedAt @map("modification_date")',
      );
      expect(audits).toContain('updated_at String? @map("updated_at")');
      expect(audits).not.toContain('updated_at String? @updatedAt');
    });

    it('should generate Decimal (not Float) with precision', () => {
      const orders = modelBlock(generate(dbml), 'Orders');
      expect(orders).toContain('total_amount Decimal?');
      expect(orders).toContain('@db.Decimal(10, 2)');
    });

    it('should emit table notes as model comments', () => {
      const schema = generate(dbml);
      expect(schema).toContain('/// Pedidos con Mercado Pago\nmodel Orders {');
    });

    it('should emit expression defaults as prisma functions', () => {
      const users = modelBlock(generate(dbml), 'Users');
      expect(users).toContain('created_at DateTime? @default(now())');
      expect(users).not.toContain('@default("now()")');
    });

    it('should preserve nullability when a scalar column has a default', () => {
      const schema = generate(`
        Table profiles {
          id int [pk]
          nickname varchar [default: 'anonymous']
          locale varchar [default: 'en', not null]
        }
      `);
      const profiles = modelBlock(schema, 'Profiles');

      expect(profiles).toContain('nickname String? @default("anonymous")');
      expect(profiles).toContain('locale String @default("en")');
    });

    it('should keep DBML nullability: not null FK required, others optional', () => {
      const orders = modelBlock(generate(dbml), 'Orders');
      expect(orders).toContain(
        'users Users @relation(fields: [user_id], references: [id])',
      );
      expect(orders).toContain(
        'orderStatuses OrderStatuses? @relation(fields: [status_id], references: [id])',
      );
    });
  });

  describe('Junction tables', () => {
    const dbml = `
      Table users {
        id int [pk]
      }
      Table roles {
        id int [pk]
      }
      Ref: users.id <> roles.id
    `;

    it('should generate a composite @@id instead of a surrogate key', () => {
      const junction = modelBlock(generate(dbml), 'UsersRoles');
      expect(junction).toContain('@@id([users_id, roles_id])');
      expect(junction).not.toContain('autoincrement');
    });

    it('should relate the junction to both sides', () => {
      const junction = modelBlock(generate(dbml), 'UsersRoles');
      expect(junction).toContain(
        'users Users @relation(fields: [users_id], references: [id])',
      );
      expect(junction).toContain(
        'roles Roles @relation(fields: [roles_id], references: [id])',
      );
    });

    it('should preserve both roles of a self-referential junction', () => {
      const schema = generate(`
        Table users {
          id int [pk]
        }
        Ref: users.id <> users.id
      `);
      const junction = modelBlock(schema, 'UsersUsers');
      const users = modelBlock(schema, 'Users');

      expect(junction).toContain(
        'users_source_id Int @map("users_source_id")',
      );
      expect(junction).toContain(
        'users_target_id Int @map("users_target_id")',
      );
      expect(junction).toContain(
        'usersSource Users @relation("UsersUsers_users_source_id", fields: [users_source_id], references: [id])',
      );
      expect(junction).toContain(
        'usersTarget Users @relation("UsersUsers_users_target_id", fields: [users_target_id], references: [id])',
      );
      expect(junction).toContain(
        '@@id([users_source_id, users_target_id])',
      );
      expect(users).toContain(
        'usersUsersUsersSource UsersUsers[] @relation("UsersUsers_users_source_id")',
      );
      expect(users).toContain(
        'usersUsersUsersTarget UsersUsers[] @relation("UsersUsers_users_target_id")',
      );
    });
  });

  describe('Relation disambiguation', () => {
    const dbml = `
      Table users {
        id int [pk]
      }
      Table messages {
        id int [pk]
        sender_id int [ref: > users.id, not null]
        receiver_id int [ref: > users.id, not null]
      }
    `;

    it('should name relations when a table has two FKs to the same target', () => {
      const messages = modelBlock(generate(dbml), 'Messages');
      expect(messages).toContain(
        'sender Users @relation("Messages_sender_id", fields: [sender_id], references: [id])',
      );
      expect(messages).toContain(
        'receiver Users @relation("Messages_receiver_id", fields: [receiver_id], references: [id])',
      );
    });

    it('should generate matching named inverse fields', () => {
      const users = modelBlock(generate(dbml), 'Users');
      expect(users).toContain(
        'messagesSender Messages[] @relation("Messages_sender_id")',
      );
      expect(users).toContain(
        'messagesReceiver Messages[] @relation("Messages_receiver_id")',
      );
    });
  });

  describe('Enums', () => {
    const dbml = `
      Enum order_status {
        pending
        approved
      }
      Table orders {
        id int [pk]
        status order_status [default: 'pending']
      }
    `;

    it('should generate enum blocks and typed fields', () => {
      const schema = generate(dbml);
      expect(schema).toContain('enum OrderStatus {\n  pending\n  approved');
      expect(schema).toContain('@@map("order_status")');
      expect(schema).toContain('status OrderStatus? @default(pending)');
    });

    it('should use the same enum in multiple models without duplicating it', () => {
      const schema = generate(`
        Enum status {
          active
        }
        Table users {
          status status
        }
        Table orders {
          status status
        }
      `);

      expect(schema.match(/enum Status \{/g)).toHaveLength(1);
      expect(schema.match(/status Status\?/g)).toHaveLength(2);
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
      const users = modelBlock(generate(dbml), 'Users');

      expect(users).toContain('id Int @id(map: "pk_users")');
      expect(users).toContain('@@unique([email], map: "uq_users_email")');
      expect(users).toContain(
        '@@index([tenant_id, email], map: "idx_users_tenant_email")',
      );
      expect(users).not.toContain('email String? @unique');
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
        onDelete: 'Cascade',
        onUpdate: 'NoAction',
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
        onDelete: 'Restrict',
        onUpdate: 'SetNull',
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
        onDelete: 'SetNull',
        onUpdate: 'NoAction',
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
        onDelete: 'Cascade',
        onUpdate: 'Restrict',
      },
    ];

    for (const testCase of cases) {
      it(`should map ${testCase.syntax} actions to Prisma relation args`, () => {
        const posts = modelBlock(generate(testCase.dbml), 'Posts');

        expect(posts).toContain(`onDelete: ${testCase.onDelete}`);
        expect(posts).toContain(`onUpdate: ${testCase.onUpdate}`);
      });
    }
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

    it('should report reserved Prisma model names', () => {
      const diagnostics = diagnosticsFor(`
        Table string {
          id int [pk]
        }
      `);
      const reserved = diagnostics.find(
        (d) => d.code === 'PRISMA_RESERVED_NAME',
      );
      expect(reserved).toBeTruthy();
      expect(reserved?.target).toBe('prisma');
    });

    it('should validate Prisma enum names and values', () => {
      const result = generator.generateCode({
        tables: [],
        relations: [],
        enums: [
          { name: 'string', values: ['valid'], sourceLine: 1 },
          {
            name: 'status',
            values: ['2_invalid'],
            sourceLine: 4,
            valueSourceLines: [5],
          },
        ],
      });

      expect(
        result.diagnostics.some(
          (d) => d.code === 'PRISMA_RESERVED_NAME' && d.line === 1,
        ),
      ).toBe(true);
      expect(
        result.diagnostics.some(
          (d) => d.code === 'OUTPUT_INVALID_IDENTIFIER' && d.line === 5,
        ),
      ).toBe(true);
    });

    it('should report generated model name collisions', () => {
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

    it('should report scalar/relation field collisions', () => {
      const diagnostics = diagnosticsFor(`
        Table users {
          id int [pk]
          orders text
        }
        Table orders {
          id int [pk]
          user_id int [ref: > users.id]
        }
      `);
      const collision = diagnostics.find(
        (d) => d.code === 'OUTPUT_PROPERTY_COLLISION',
      );
      expect(collision).toBeTruthy();
      expect(collision?.details?.['fieldName']).toBe('orders');
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
      expect(fallback?.severity).toBe('warning');
      expect(fallback?.message).toContain('geography');
    });
  });

  describe('Self-references', () => {
    it('should generate both sides of a self-relation', () => {
      const categories = modelBlock(
        generate(`
          Table categories {
            id int [pk]
            parent_id int [ref: > categories.id]
          }
        `),
        'Categories',
      );

      expect(categories).toContain(
        'parent Categories? @relation("Categories_parent_id", fields: [parent_id], references: [id])',
      );
      expect(categories).toContain(
        'categoriesParent Categories[] @relation("Categories_parent_id")',
      );
    });
  });
});
