import { parseDbType, typeFamily } from '../../dbml-parser/helpers';

export function mapDbTypeToTsType(dbType: string): string {
  const { base } = parseDbType(dbType);

  switch (typeFamily(base)) {
    case 'integer':
    case 'float':
    case 'decimal':
      return 'number';
    case 'string':
    case 'uuid':
      return 'string';
    case 'date':
      return 'Date';
    case 'boolean':
      return 'boolean';
    case 'json':
      return 'Record<string, any>';
    default:
      return 'string';
  }
}
