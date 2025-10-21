import { DATA_TYPES } from '../../../dbml-parser/constants';

export function mapDbTypeToPrismaType(dbType: string): string {
  const type = dbType.toLowerCase();

  if (DATA_TYPES.Integer.some((t) => type.includes(t))) return 'Int';
  if (DATA_TYPES.String.some((t) => type.includes(t))) return 'String';
  if (DATA_TYPES.Date.some((t) => type.includes(t))) return 'DateTime';
  if (DATA_TYPES.Boolean.some((t) => type.includes(t))) return 'Boolean';
  if (DATA_TYPES.Float.some((t) => type.includes(t))) return 'Float';
  if (DATA_TYPES.Json.some((t) => type.includes(t))) return 'Json';

  return 'String';
}
