// mappers/ts-type.mapper.ts
import { DATA_TYPES } from '../../../dbml-parser/constants';

export function mapDbTypeToTsType(dbType: string): string {
  const type = dbType.toLowerCase();

  if (DATA_TYPES.Integer.some((t) => type.includes(t))) return 'number';
  if (DATA_TYPES.String.some((t) => type.includes(t))) return 'string';
  if (DATA_TYPES.Date.some((t) => type.includes(t))) return 'Date';
  if (DATA_TYPES.Boolean.some((t) => type.includes(t))) return 'boolean';
  if (DATA_TYPES.Float.some((t) => type.includes(t))) return 'number';
  if (DATA_TYPES.Json.some((t) => type.includes(t)))
    return 'Record<string, any>';

  return 'string';
}
