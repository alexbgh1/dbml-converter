import {
  Column,
  DatabaseSchema,
  Table,
} from '../interfaces/dbml-parser.interface';
import { Diagnostic } from '../interfaces/diagnostics.interface';
import { parseDbType, typeFamily } from '../helpers';
import { DIAGNOSTIC_CODES } from '../constants/diagnostic-codes.constants';

/*
  Phase-2 (schema-validation) diagnostics: inconsistencies in the parsed
  intermediate model, independent of any generator. Pure function — trivially
  testable without TestBed.
*/
export function validateSchema(schema: DatabaseSchema): Diagnostic[] {
  return [
    ...validateDuplicateTables(schema),
    ...validateDuplicateColumns(schema),
    ...validateEnums(schema),
    ...validateReferenceEndpoints(schema),
    ...validateIndexColumns(schema),
    ...validateReferenceTypes(schema),
  ];
}

/*
  DBML enum declarations and values are treated as case-sensitive. Generated
  targets may normalize names and report their own collisions in phase 3.
*/
function validateEnums(schema: DatabaseSchema): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const enums = schema.enums ?? [];
  const firstByName = new Map<string, (typeof enums)[number]>();

  for (const enumDef of enums) {
    const first = firstByName.get(enumDef.name);
    if (first) {
      diagnostics.push({
        code: DIAGNOSTIC_CODES.SCHEMA_DUPLICATE_ENUM,
        severity: 'error',
        phase: 'schema-validation',
        message: `Enum "${enumDef.name}" is declared more than once.`,
        line: enumDef.sourceLine,
        schemaPath: `enums.${enumDef.name}`,
        details: {
          firstDeclarationLine: first.sourceLine,
          caseSensitive: true,
        },
      });
    } else {
      firstByName.set(enumDef.name, enumDef);
    }

    const firstValueIndex = new Map<string, number>();
    enumDef.values.forEach((value, index) => {
      const firstIndex = firstValueIndex.get(value);
      if (firstIndex !== undefined) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.SCHEMA_DUPLICATE_ENUM_VALUE,
          severity: 'error',
          phase: 'schema-validation',
          message: `Value "${value}" is declared more than once in enum "${enumDef.name}".`,
          line: enumDef.valueSourceLines?.[index] ?? enumDef.sourceLine,
          schemaPath: `enums.${enumDef.name}.values.${value}`,
          details: {
            valueIndex: index,
            firstValueIndex: firstIndex,
            firstDeclarationLine:
              enumDef.valueSourceLines?.[firstIndex] ?? enumDef.sourceLine,
            caseSensitive: true,
          },
        });
      } else {
        firstValueIndex.set(value, index);
      }
    });
  }

  for (const table of schema.tables) {
    for (const column of table.columns) {
      const exactMatches = enums.filter((e) => e.name === column.type);
      if (exactMatches.length > 1) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.SCHEMA_AMBIGUOUS_ENUM_TYPE,
          severity: 'error',
          phase: 'schema-validation',
          message: `${table.name}.${column.name} uses enum type "${column.type}", but that enum is declared more than once.`,
          line: column.sourceLine,
          schemaPath: `tables.${table.name}.columns.${column.name}`,
          details: { enumName: column.type, matches: exactMatches.length },
        });
        continue;
      }

      if (exactMatches.length === 0) {
        const caseMatches = enums.filter(
          (e) => e.name.toLowerCase() === column.type.toLowerCase(),
        );
        if (caseMatches.length > 0) {
          diagnostics.push({
            code: DIAGNOSTIC_CODES.SCHEMA_ENUM_TYPE_CASE_MISMATCH,
            severity: 'error',
            phase: 'schema-validation',
            message: `${table.name}.${column.name} uses "${column.type}", but enum names are case-sensitive.`,
            line: column.sourceLine,
            schemaPath: `tables.${table.name}.columns.${column.name}`,
            suggestion: `Use ${caseMatches.map((e) => e.name).join(' or ')} exactly.`,
            details: {
              requestedType: column.type,
              candidates: caseMatches.map((e) => e.name),
              caseSensitive: true,
            },
          });
        }
        continue;
      }

      if (column.default === undefined || column.isExpression) continue;

      const enumDef = exactMatches[0];
      if (
        typeof column.default !== 'string' ||
        !enumDef.values.includes(column.default)
      ) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.SCHEMA_INVALID_ENUM_DEFAULT,
          severity: 'error',
          phase: 'schema-validation',
          message: `Default ${JSON.stringify(column.default)} of ${table.name}.${column.name} is not a value of enum "${enumDef.name}".`,
          line: column.sourceLine,
          schemaPath: `tables.${table.name}.columns.${column.name}`,
          suggestion: enumDef.values.length
            ? `Use one of: ${enumDef.values.join(', ')}.`
            : `Declare at least one value in enum "${enumDef.name}".`,
          details: {
            enumName: enumDef.name,
            default: column.default,
            availableValues: enumDef.values,
            caseSensitive: true,
          },
        });
      }
    }
  }

  return diagnostics;
}

function validateDuplicateTables(schema: DatabaseSchema): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, Table>();

  for (const table of schema.tables) {
    const first = seen.get(table.name);
    if (first) {
      diagnostics.push({
        code: DIAGNOSTIC_CODES.SCHEMA_DUPLICATE_TABLE,
        severity: 'error',
        phase: 'schema-validation',
        message: `Table "${table.name}" is declared more than once.`,
        line: table.sourceLine,
        schemaPath: `tables.${table.name}`,
        details: { firstDeclarationLine: first.sourceLine },
      });
    } else {
      seen.set(table.name, table);
    }
  }

  return diagnostics;
}

function validateDuplicateColumns(schema: DatabaseSchema): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const table of schema.tables) {
    const seen = new Map<string, number>(); // name -> first index

    table.columns.forEach((column, index) => {
      const firstIndex = seen.get(column.name);
      if (firstIndex !== undefined) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.SCHEMA_DUPLICATE_COLUMN,
          severity: 'error',
          phase: 'schema-validation',
          message: `Column "${column.name}" is declared more than once in table "${table.name}".`,
          line: column.sourceLine,
          schemaPath: `tables.${table.name}.columns.${column.name}`,
          // schemaPath is name-based, so the duplicate's index disambiguates
          details: { columnIndex: index, firstColumnIndex: firstIndex },
        });
      } else {
        seen.set(column.name, index);
      }
    });
  }

  return diagnostics;
}

/*
  Missing relation endpoints are errors, never auto-created (see the design
  doc's auto-completion policy §2). Column refs are checked (they cover
  junction-table FKs, which have no entry in schema.relations) plus relations
  whose ref could not be installed; duplicates are collapsed by key.
*/
function validateReferenceEndpoints(schema: DatabaseSchema): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const reported = new Set<string>();

  const tableByName = new Map(schema.tables.map((t) => [t.name, t]));

  const checkTarget = (
    sourceLabel: string,
    targetTable: string,
    targetColumn: string,
    line: number | undefined,
    schemaPath: string,
  ) => {
    const table = tableByName.get(targetTable);

    if (!table) {
      const key = `table:${sourceLabel}->${targetTable}`;
      if (reported.has(key)) return;
      reported.add(key);

      diagnostics.push({
        code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_TABLE,
        severity: 'error',
        phase: 'schema-validation',
        message: `${sourceLabel} references table "${targetTable}", but it does not exist.`,
        line,
        schemaPath,
        details: { target: `${targetTable}.${targetColumn}` },
      });
      return;
    }

    if (!table.columns.some((c) => c.name === targetColumn)) {
      const key = `column:${sourceLabel}->${targetTable}.${targetColumn}`;
      if (reported.has(key)) return;
      reported.add(key);

      const available = table.columns.map((c) => c.name);
      diagnostics.push({
        code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_COLUMN,
        severity: 'error',
        phase: 'schema-validation',
        message: `${sourceLabel} references ${targetTable}.${targetColumn}, but ${targetTable}.${targetColumn} does not exist.`,
        line,
        schemaPath,
        suggestion: available.length
          ? `Reference one of: ${available
              .map((c) => `${targetTable}.${c}`)
              .join(', ')} — or declare ${targetTable}.${targetColumn}.`
          : `Declare ${targetTable}.${targetColumn}.`,
        repairs:
          line !== undefined
            ? available.map((candidate) => ({
                kind: 'replace-reference-target' as const,
                label: `Reference ${targetTable}.${candidate}`,
                line,
                expectedText: `${targetTable}.${targetColumn}`,
                replacementText: `${targetTable}.${candidate}`,
              }))
            : undefined,
        details: {
          target: `${targetTable}.${targetColumn}`,
          availableTargetColumns: available,
        },
      });
    }
  };

  // Column refs (covers junction FK columns, which have no relation entry)
  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (!column.ref) continue;
      checkTarget(
        `${table.name}.${column.name}`,
        column.ref.table,
        column.ref.column,
        column.sourceLine,
        `tables.${table.name}.columns.${column.name}`,
      );
    }
  }

  // Relations whose ref could not be installed (e.g. missing source table)
  for (const relation of schema.relations) {
    if (!tableByName.has(relation.from.table)) {
      const key = `table:Ref->${relation.from.table}`;
      if (!reported.has(key)) {
        reported.add(key);
        diagnostics.push({
          code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_REFERENCE_TABLE,
          severity: 'error',
          phase: 'schema-validation',
          message: `A Ref uses table "${relation.from.table}", but it does not exist.`,
          line: relation.sourceLine,
          schemaPath: `relations`,
          details: { source: `${relation.from.table}.${relation.from.column}` },
        });
      }
    }

    checkTarget(
      `${relation.from.table}.${relation.from.column}`,
      relation.to.table,
      relation.to.column,
      relation.sourceLine,
      `relations`,
    );
  }

  return diagnostics;
}

function validateIndexColumns(schema: DatabaseSchema): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const table of schema.tables) {
    for (const index of table.indexes ?? []) {
      for (const columnName of index.columns) {
        if (table.columns.some((c) => c.name === columnName)) continue;

        diagnostics.push({
          code: DIAGNOSTIC_CODES.SCHEMA_UNKNOWN_INDEX_COLUMN,
          severity: 'error',
          phase: 'schema-validation',
          message: `Index (${index.columns.join(', ')}) on table "${table.name}" references missing column "${columnName}".`,
          line: table.sourceLine,
          schemaPath: `tables.${table.name}.indexes`,
          details: { indexColumns: index.columns, missingColumn: columnName },
        });
      }
    }
  }

  return diagnostics;
}

/*
  FK <-> target type compatibility, by normalized type family: int vs bigint is
  compatible, int vs uuid is not. Unknown families are skipped — that's the
  generators' OUTPUT_UNKNOWN_TYPE_FALLBACK concern, not a mismatch.
  Base severity is 'warning'; the UI escalates it to 'error' for ORM targets.
*/
function validateReferenceTypes(schema: DatabaseSchema): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const tableByName = new Map(schema.tables.map((t) => [t.name, t]));

  const familyOf = (column: Column) =>
    typeFamily(parseDbType(column.type).base);

  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (!column.ref) continue;

      const targetColumn = tableByName
        .get(column.ref.table)
        ?.columns.find((c) => c.name === column.ref!.column);
      if (!targetColumn) continue; // missing endpoint already reported

      const sourceFamily = familyOf(column);
      const targetFamily = familyOf(targetColumn);
      if (!sourceFamily || !targetFamily) continue;
      if (sourceFamily === targetFamily) continue;

      diagnostics.push({
        code: DIAGNOSTIC_CODES.SCHEMA_REFERENCE_TYPE_MISMATCH,
        severity: 'warning',
        phase: 'schema-validation',
        message: `${table.name}.${column.name} has type ${column.type}, but it references ${column.ref.table}.${column.ref.column} with type ${targetColumn.type}.`,
        line: column.sourceLine,
        schemaPath: `tables.${table.name}.columns.${column.name}`,
        repairs:
          column.sourceLine !== undefined
            ? [
                {
                  kind: 'change-column-type',
                  label: `Change ${column.name} to ${targetColumn.type}`,
                  line: column.sourceLine,
                  expectedText: `${column.name} ${column.type}`,
                  replacementText: `${column.name} ${targetColumn.type}`,
                },
              ]
            : undefined,
        details: {
          sourceType: column.type,
          targetType: targetColumn.type,
          sourceFamily,
          targetFamily,
        },
      });
    }
  }

  return diagnostics;
}
