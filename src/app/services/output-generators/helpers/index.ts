import { Table } from '../../dbml-parser/interfaces/dbml-parser.interface';

/** Whether a column's inline unique marker is represented by a named index. */
export function hasNamedSingleUniqueIndex(
  table: Table,
  columnName: string,
): boolean {
  return !!table.indexes?.some(
    (index) =>
      index.unique &&
      !!index.name &&
      index.columns.length === 1 &&
      index.columns[0] === columnName,
  );
}

/** Removes a conventional foreign-key suffix without collapsing a bare `_id`. */
export function stripIdSuffix(columnName: string): string {
  return columnName.replace(/_id$/i, '') || columnName;
}

/** Preserves existing segment casing while promoting underscore-delimited names. */
export function toPascalCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
