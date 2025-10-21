import { COLUMN_ATTRIBUTES } from '../constants';
import { Column } from '../interfaces/dbml-parser.interface';

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
    if (COLUMN_ATTRIBUTES.Increment.includes(attrLower as any))
      flags.increment = true;
  }

  return flags;
}
