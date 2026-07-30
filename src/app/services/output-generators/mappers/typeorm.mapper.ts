import { parseDbType, typeFamily } from '../../dbml-parser/helpers';

export function mapDbTypeToTypeOrmType(dbType: string): string {
  const { base } = parseDbType(dbType);

  switch (typeFamily(base)) {
    case 'uuid':
      return 'uuid';
    case 'decimal':
      return 'decimal';
    case 'integer':
      return base === 'bigint' ? 'bigint' : 'int';
    case 'string':
      return 'varchar';
    case 'date':
      if (base.startsWith('timestamp')) return 'timestamp';
      if (base.startsWith('datetime')) return 'datetime';
      if (base.startsWith('time')) return 'time';
      return 'date';
    case 'boolean':
      return 'boolean';
    case 'float':
      return 'float';
    case 'json':
      return 'json';

    // Unknown type: fallback
    default:
      return 'varchar';
  }
}
