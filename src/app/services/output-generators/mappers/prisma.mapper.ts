import { parseDbType, typeFamily } from '../../dbml-parser/helpers';

export interface PrismaFieldType {
  type: string;
  /* Postgres native type attribute, e.g. @db.Uuid, @db.Decimal(10, 2) */
  nativeAttr?: string;
}

export function mapColumnTypeToPrisma(dbType: string): PrismaFieldType {
  const { base, args } = parseDbType(dbType);

  switch (typeFamily(base)) {
    case 'uuid':
      return { type: 'String', nativeAttr: '@db.Uuid' };

    // Money/precision types must not degrade to Float
    case 'decimal':
      return {
        type: 'Decimal',
        nativeAttr:
          args.length === 2 ? `@db.Decimal(${args[0]}, ${args[1]})` : undefined,
      };

    case 'integer':
      return base === 'bigint' ? { type: 'BigInt' } : { type: 'Int' };

    case 'string':
      if (base === 'varchar' && args.length === 1) {
        return { type: 'String', nativeAttr: `@db.VarChar(${args[0]})` };
      }
      if (base === 'char' && args.length === 1) {
        return { type: 'String', nativeAttr: `@db.Char(${args[0]})` };
      }
      return { type: 'String' };

    case 'date':
      return { type: 'DateTime' };
    case 'boolean':
      return { type: 'Boolean' };
    case 'float':
      return { type: 'Float' };
    case 'json':
      return { type: 'Json' };

    // Unknown type: fallback
    default:
      return { type: 'String' };
  }
}
