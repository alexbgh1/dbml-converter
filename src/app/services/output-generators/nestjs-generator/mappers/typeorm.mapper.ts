import { DATA_TYPES } from '../../../dbml-parser/constants';

export function mapDbTypeToTypeOrmType(dbType: string): string {
  const type = dbType.toLowerCase();

  if (DATA_TYPES.Integer.some((t) => type.includes(t))) return 'int';
  if (DATA_TYPES.String.some((t) => type.includes(t))) return 'varchar';
  if (DATA_TYPES.Date.some((t) => type.includes(t))) {
    if (type.includes('stamp')) return 'timestamp';
    if (type.includes('time')) return 'time';
    return 'date';
  }
  if (DATA_TYPES.Boolean.some((t) => type.includes(t))) return 'boolean';
  if (DATA_TYPES.Float.some((t) => type.includes(t))) return 'float';
  if (type.includes('decimal')) return 'decimal';
  if (DATA_TYPES.Json.some((t) => type.includes(t))) return 'json';

  return 'varchar';
}
