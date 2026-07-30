import { COLUMN_ATTRIBUTES, TYPE_FAMILIES, TypeFamily } from '../constants';
import { Column } from '../interfaces/dbml-parser.interface';

/*
  Classify a lowercase base type (from parseDbType) into its normalized family.
  Exact alias matching only — unknown types return null and callers decide the
  fallback.
*/
export function typeFamily(base: string): TypeFamily | null {
  for (const [family, aliases] of Object.entries(TYPE_FAMILIES)) {
    if (aliases.includes(base)) return family as TypeFamily;
  }
  return null;
}

/*
  Split a column attribute list on top-level commas only.
  Commas inside quotes ('...', "...", `...`) or parentheses must NOT split,
  e.g. [note: 'admin, customer', default: fn(1,2)] -> two attributes.
*/
export function splitAttributes(raw: string): string[] {
  const attrs: string[] = [];
  let current = '';
  let quote: string | null = null;
  let parenDepth = 0;

  for (const char of raw) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') parenDepth++;
    if (char === ')') parenDepth = Math.max(0, parenDepth - 1);

    if (char === ',' && parenDepth === 0) {
      attrs.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) attrs.push(current.trim());
  return attrs;
}

/*
  Split a db type into base name and numeric args,
  e.g. "decimal(10,2)" -> { base: 'decimal', args: [10, 2] }
*/
export function parseDbType(dbType: string): { base: string; args: number[] } {
  const normalizedType = dbType.toLowerCase();
  const match = normalizedType.match(/^([\w]+)\s*(?:\(([^)]*)\))?$/);
  if (!match) return { base: normalizedType, args: [] };

  const args = (match[2] ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .map(Number)
    .filter((n) => !isNaN(n));

  return { base: match[1], args };
}

export function getColumnFlags(attrs: string[]): Partial<Column> {
  const flags: Partial<Column> = {};

  for (const attr of attrs) {
    /*
      Attribute can be any string, but it should be accepted if
      it matches any of the known attributes in a case-insensitive way.

      Values are defined in "COLUMN_ATTRIBUTES"

      Some examples:
      - "pk", "PK", "Primary Key"
      - "unique"
      - "nn", "Not Null"
      - "increment", "auto_increment", "identity"
    */

    let attrLower = attr.toLowerCase().trim();

    if (COLUMN_ATTRIBUTES.PrimaryKey.includes(attrLower as any))
      flags.pk = true;
    if (COLUMN_ATTRIBUTES.Unique.includes(attrLower as any))
      flags.unique = true;
    if (COLUMN_ATTRIBUTES.NotNull.includes(attrLower as any))
      flags.nullable = false;
    if (COLUMN_ATTRIBUTES.Nullable.includes(attrLower as any))
      flags.nullable = true;
    if (COLUMN_ATTRIBUTES.Increment.includes(attrLower as any))
      flags.increment = true;
  }

  return flags;
}
