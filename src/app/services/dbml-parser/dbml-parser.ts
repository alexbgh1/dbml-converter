import { Injectable, signal, computed, WritableSignal } from '@angular/core';

import {
  Column,
  DatabaseSchema,
  EnumDef,
  ReferentialAction,
  Relation,
  Table,
  Cardinality,
  RelationOperator,
  CARDINALITY_MAP,
} from './interfaces/dbml-parser.interface';

import { Diagnostic, ParseResult } from './interfaces/diagnostics.interface';

import { getColumnFlags, splitAttributes } from './helpers';
import { validateSchema } from './validators/schema-validator';
import { DIAGNOSTIC_CODES } from './constants/diagnostic-codes.constants';

const EMPTY_RESULT: ParseResult = {
  schema: { tables: [], relations: [] },
  diagnostics: [],
};

type ReferentialActions = Pick<Relation, 'onDelete' | 'onUpdate'>;

interface ParsedColumnLine {
  column: Column;
  unknownAttributes: string[];
}

@Injectable({ providedIn: 'root' })
export class DbmlParserService {
  private dbmlContent: WritableSignal<string> = signal<string>('');

  /*
    ParseResult derives synchronously from the content signal: a read right
    after setDbmlContent() observes the new schema — no effect scheduling,
    no timers . computed() memoizes, so parsing runs once
    per content change regardless of how many consumers read it.
  */
  private parseResult = computed<ParseResult>(() =>
    this.parseDbmlToJson(this.dbmlContent()),
  );

  /* Facade over the internal ParseResult: consumers of `schema` are unaffected */
  readonly schema = computed(() => this.parseResult().schema);
  readonly diagnostics = computed(() => this.parseResult().diagnostics);

  setDbmlContent(content: string): void {
    this.dbmlContent.set(content);
  }

  /**
   * Convert DBML content to JSON schema.
   * Handles tables (with aliases, notes and indexes blocks), enums, columns,
   * and relationships in inline, short and long form (including junction tables).
   */
  private parseDbmlToJson(dbmlContent: string): ParseResult {
    if (!dbmlContent.trim()) {
      return EMPTY_RESULT;
    }

    const lines = dbmlContent.split('\n');
    const schema: DatabaseSchema = {
      tables: [],
      relations: [],
      enums: [],
    };
    const diagnostics: Diagnostic[] = [];

    /* alias -> real table name (Table users as U { ... }) */
    const aliases = new Map<string, string>();

    let currentTable: Table | null = null;
    let currentEnum: EnumDef | null = null;
    let inIndexes = false;
    let inRefBlock = false;
    let refBlockName: string | null = null;
    /* Depth of an unsupported block being skipped (Project, TableGroup, Note {}) */
    let skipDepth = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineNo = lineIndex + 1; // 1-based, for diagnostics
      const line = lines[lineIndex].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('//')) continue;

      // Currently skipping an unsupported block: track braces until it closes
      if (skipDepth > 0) {
        skipDepth += this.braceDelta(line);
        continue;
      }

      // Enum body
      if (currentEnum) {
        if (line.startsWith('}')) {
          currentEnum = null;
          continue;
        }
        const valueMatch = line.match(
          /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[.*\])?\s*$/,
        );
        if (valueMatch) {
          currentEnum.values.push(valueMatch[1]);
          currentEnum.valueSourceLines!.push(lineNo);
        } else {
          diagnostics.push({
            code: DIAGNOSTIC_CODES.PARSE_INVALID_ENUM_VALUE,
            severity: 'error',
            phase: 'parse',
            message: `Invalid value in enum "${currentEnum.name}": ${line}`,
            line: lineNo,
            schemaPath: `enums.${currentEnum.name}`,
            suggestion:
              'Use an identifier that starts with a letter or underscore and contains only letters, numbers, or underscores.',
          });
        }
        continue;
      }

      // Long-form Ref body: Ref name { table1.col < table2.col }
      if (inRefBlock) {
        if (line.startsWith('}')) {
          inRefBlock = false;
          refBlockName = null;
          continue;
        }
        const parsed = this.handleRelationLine(
          schema,
          line,
          aliases,
          diagnostics,
          lineNo,
          refBlockName ?? undefined,
        );
        if (!parsed) {
          diagnostics.push({
            code: DIAGNOSTIC_CODES.PARSE_UNRECOGNIZED_LINE,
            severity: 'warning',
            phase: 'parse',
            message: `Ignored invalid relation in Ref block: ${line}`,
            line: lineNo,
            schemaPath: 'relations',
          });
        }
        continue;
      }

      // Inside a table body
      if (currentTable) {
        // indexes { ... } block
        if (inIndexes) {
          if (line.startsWith('}')) {
            inIndexes = false;
            continue;
          }
          if (!this.parseIndexLine(line, currentTable)) {
            diagnostics.push({
              code: DIAGNOSTIC_CODES.PARSE_UNRECOGNIZED_LINE,
              severity: 'warning',
              phase: 'parse',
              message: `Ignored invalid index line in table "${currentTable.name}": ${line}`,
              line: lineNo,
              schemaPath: `tables.${currentTable.name}.indexes`,
            });
          }
          continue;
        }
        if (/^indexes\s*\{/i.test(line)) {
          inIndexes = true;
          continue;
        }

        // Table-level note, short form: note: '...'
        const tableNote = line.match(/^note:\s*['"`](.*?)['"`]\s*$/i);
        if (tableNote) {
          currentTable.note = tableNote[1];
          continue;
        }
        // Table-level note, block form: Note { '...' } — skip its body
        if (/^note\s*\{/i.test(line)) {
          skipDepth = Math.max(0, this.braceDelta(line));
          continue;
        }

        // End of table
        if (line.startsWith('}')) {
          currentTable = null;
          continue;
        }

        const parsedColumn = this.parseColumnLine(line);
        if (parsedColumn) {
          const { column, unknownAttributes } = parsedColumn;
          column.sourceLine = lineNo;
          currentTable.columns.push(column);

          for (const attribute of unknownAttributes) {
            diagnostics.push({
              code: DIAGNOSTIC_CODES.PARSE_UNKNOWN_ATTRIBUTE,
              severity: 'warning',
              phase: 'parse',
              message: `Ignored unknown attribute "${attribute}" on ${currentTable.name}.${column.name}.`,
              line: lineNo,
              schemaPath: `tables.${currentTable.name}.columns.${column.name}`,
              suggestion:
                'Remove the attribute or replace it with a supported DBML column attribute.',
              details: { attribute },
            });
          }

          if (column.ref) {
            this.registerInlineRef(
              schema,
              currentTable,
              column,
              aliases,
              diagnostics,
              lineNo,
            );
          }
        } else {
          diagnostics.push({
            code: DIAGNOSTIC_CODES.PARSE_UNRECOGNIZED_LINE,
            severity: 'warning',
            phase: 'parse',
            message: `Ignored unrecognized line in table "${currentTable.name}": ${line}`,
            line: lineNo,
            schemaPath: `tables.${currentTable.name}`,
          });
        }
        continue;
      }

      // Table definition, with optional alias: Table users as U {
      const tableMatch = line.match(
        /^Table\s+([\w_]+)(?:\s+as\s+([\w_]+))?\s*\{/i,
      );
      if (tableMatch) {
        currentTable = {
          name: tableMatch[1],
          alias: tableMatch[2] ?? null,
          columns: [],
          sourceLine: lineNo,
        };
        if (tableMatch[2]) aliases.set(tableMatch[2], tableMatch[1]);
        schema.tables.push(currentTable);
        continue;
      }

      // Enum definition: Enum order_status {
      const enumMatch = line.match(/^Enum\s+([^\s{]+)\s*\{\s*$/i);
      if (enumMatch) {
        currentEnum = {
          name: enumMatch[1],
          values: [],
          sourceLine: lineNo,
          valueSourceLines: [],
        };
        schema.enums!.push(currentEnum);

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(currentEnum.name)) {
          diagnostics.push({
            code: DIAGNOSTIC_CODES.PARSE_INVALID_ENUM_DECLARATION,
            severity: 'error',
            phase: 'parse',
            message: `Enum name "${currentEnum.name}" is not a valid DBML identifier.`,
            line: lineNo,
            schemaPath: `enums.${currentEnum.name}`,
            suggestion:
              'Use a name that starts with a letter or underscore and contains only letters, numbers, or underscores.',
          });
        }
        continue;
      }

      if (/^Enum\b/i.test(line)) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.PARSE_INVALID_ENUM_DECLARATION,
          severity: 'error',
          phase: 'parse',
          message: `Could not parse enum declaration: ${line}`,
          line: lineNo,
          schemaPath: 'enums',
          suggestion: 'Use the form: Enum enum_name {',
        });
        continue;
      }

      // Long-form Ref block: Ref name_optional {
      const refBlockMatch = line.match(/^Ref(?:\s+([\w_]+))?\s*\{\s*$/);
      if (refBlockMatch) {
        inRefBlock = true;
        refBlockName = refBlockMatch[1] ?? null;
        continue;
      }

      /*
        Short-form relationship definition (outside tables):
        Ref name_optional: table1.column1 < table2.column2
        Symbols: <, >, <>, -
      */
      if (/^Ref\b/.test(line)) {
        if (
          !this.handleRelationLine(
            schema,
            line,
            aliases,
            diagnostics,
            lineNo,
          )
        ) {
          diagnostics.push({
            code: DIAGNOSTIC_CODES.PARSE_UNRECOGNIZED_LINE,
            severity: 'warning',
            phase: 'parse',
            message: `Ignored invalid Ref declaration: ${line}`,
            line: lineNo,
            schemaPath: 'relations',
          });
        }
        continue;
      }

      // Other top-level blocks are skipped gracefully
      if (/^(Project|TableGroup|Note)\b/i.test(line)) {
        skipDepth = Math.max(0, this.braceDelta(line));
        continue;
      }

      diagnostics.push({
        code: DIAGNOSTIC_CODES.PARSE_UNRECOGNIZED_LINE,
        severity: 'warning',
        phase: 'parse',
        message: `Ignored unrecognized top-level line: ${line}`,
        line: lineNo,
      });
    }

    // A block still open at EOF means later lines were parsed in the wrong context
    if (currentTable || currentEnum || inRefBlock || skipDepth > 0) {
      const what = currentTable
        ? `Table "${currentTable.name}"`
        : currentEnum
          ? `Enum "${currentEnum.name}"`
          : inRefBlock
            ? 'Ref block'
            : 'Block';
      diagnostics.push({
        code: DIAGNOSTIC_CODES.PARSE_UNTERMINATED_BLOCK,
        severity: 'error',
        phase: 'parse',
        message: `${what} is not closed before the end of the input.`,
        line: currentTable?.sourceLine ?? currentEnum?.sourceLine,
      });
    }

    this.resolveAliases(schema, aliases);

    // Add missing foreign key columns from external relations
    this.addMissingForeignKeyColumns(schema, diagnostics);

    const finalSchema = this.deduplicateRelations(schema);

    // Phase 2: schema-level validation (duplicates, endpoints, type families)
    diagnostics.push(...validateSchema(finalSchema));

    return {
      schema: finalSchema,
      diagnostics,
    };
  }

  /* Net brace depth change of a line: "{" opens, "}" closes */
  private braceDelta(line: string): number {
    const opens = line.match(/\{/g)?.length ?? 0;
    const closes = line.match(/\}/g)?.length ?? 0;
    return opens - closes;
  }

  /*
    Parse a relation line (short form or long-form body) and register it.
    `junctionName` is the Ref block name, used to name many-to-many junction tables.
  */
  private handleRelationLine(
    schema: DatabaseSchema,
    line: string,
    aliases: Map<string, string>,
    diagnostics: Diagnostic[],
    lineNo: number,
    junctionName?: string,
  ): boolean {
    const relationMatch = line.match(
      /^(?:Ref(?:\s+([\w_]+))?\s*:\s*)?([\w_]+)\.([\w_]+)\s*(<>|<|>|-)\s*([\w_]+)\.([\w_]+)\s*(?:\[(.*)\])?\s*$/,
    );
    if (!relationMatch) return false;

    const [
      ,
      refName,
      table1Raw,
      col1,
      operator,
      table2Raw,
      col2,
      rawAttributes,
    ] = relationMatch;

    // Aliases already declared can be resolved right away (final pass catches the rest)
    const table1 = aliases.get(table1Raw) ?? table1Raw;
    const table2 = aliases.get(table2Raw) ?? table2Raw;

    const actions = this.parseReferentialActions(
      rawAttributes ? splitAttributes(rawAttributes) : [],
    );
    const relation = this.buildRelation(
      table1,
      col1,
      operator,
      table2,
      col2,
      actions,
    );
    relation.sourceLine = lineNo;
    schema.relations.push(relation);

    if (
      relation.cardinality.from === Cardinality.Many &&
      relation.cardinality.to === Cardinality.Many
    ) {
      const name =
        junctionName ??
        refName ??
        `${relation.from.table}_${relation.to.table}`;
      this.detectJunctionTable(schema, relation, name, diagnostics);
    }

    return true;
  }

  /*
    Build a relation normalized so the FK side is always "from".
    `<` (one-to-many) is stored swapped as many-to-one: the FK lives on the many side.
  */
  private buildRelation(
    table1: string,
    col1: string,
    operator: string,
    table2: string,
    col2: string,
    actions: ReferentialActions = {},
  ): Relation {
    const cardinality =
      CARDINALITY_MAP[operator as RelationOperator] ??
      CARDINALITY_MAP[RelationOperator.OneToOne];

    if (operator === RelationOperator.OneToMany) {
      return {
        from: { table: table2, column: col2 },
        to: { table: table1, column: col1 },
        cardinality: CARDINALITY_MAP[RelationOperator.ManyToOne],
        ...actions,
      };
    }

    return {
      from: { table: table1, column: col1 },
      to: { table: table2, column: col2 },
      cardinality,
      ...actions,
    };
  }

  /*
    Register the relation of an inline ref ([ref: > users.id]).
    - `<` means the FK belongs on the *referenced* table, so the relation is
      swapped and the local ref removed (addMissingForeignKeyColumns installs it).
    - `<>` triggers junction table detection like the global form.
  */
  private registerInlineRef(
    schema: DatabaseSchema,
    table: Table,
    column: Column,
    aliases: Map<string, string>,
    diagnostics: Diagnostic[],
    lineNo: number,
  ): void {
    const ref = column.ref!;
    ref.table = aliases.get(ref.table) ?? ref.table;

    const cardinality =
      ref.cardinality ?? CARDINALITY_MAP[RelationOperator.ManyToOne];

    if (
      cardinality.from === Cardinality.One &&
      cardinality.to === Cardinality.Many
    ) {
      schema.relations.push({
        from: { table: ref.table, column: ref.column },
        to: { table: table.name, column: column.name },
        cardinality: CARDINALITY_MAP[RelationOperator.ManyToOne],
        sourceLine: lineNo,
        ...(ref.onDelete && { onDelete: ref.onDelete }),
        ...(ref.onUpdate && { onUpdate: ref.onUpdate }),
      });
      delete column.ref;
      return;
    }

    const relation: Relation = {
      from: { table: table.name, column: column.name },
      to: { table: ref.table, column: ref.column },
      cardinality,
      sourceLine: lineNo,
      ...(ref.onDelete && { onDelete: ref.onDelete }),
      ...(ref.onUpdate && { onUpdate: ref.onUpdate }),
    };
    schema.relations.push(relation);

    if (
      cardinality.from === Cardinality.Many &&
      cardinality.to === Cardinality.Many
    ) {
      this.detectJunctionTable(
        schema,
        relation,
        `${relation.from.table}_${relation.to.table}`,
        diagnostics,
      );
    }
  }

  /* Replace alias usages with real table names in refs and relations */
  private resolveAliases(
    schema: DatabaseSchema,
    aliases: Map<string, string>,
  ): void {
    if (!aliases.size) return;

    const resolve = (name: string) => aliases.get(name) ?? name;

    for (const table of schema.tables) {
      for (const column of table.columns) {
        if (column.ref) column.ref.table = resolve(column.ref.table);
      }
    }
    for (const relation of schema.relations) {
      relation.from.table = resolve(relation.from.table);
      relation.to.table = resolve(relation.to.table);
    }
  }

  /*
    Parse one entry of an indexes { } block:
    - (a, b) [pk]          -> composite primary key
    - email [unique]       -> unique column
    - (a, b) [unique]      -> composite unique index
    - created_at           -> plain index
  */
  private parseIndexLine(line: string, table: Table): boolean {
    const indexMatch = line.match(
      /^(?:\(([^)]+)\)|([\w_]+))\s*(?:\[(.*)\])?\s*$/,
    );
    if (!indexMatch) return false;

    const columns = (
      indexMatch[1]
        ? indexMatch[1].split(',').map((c) => c.trim())
        : [indexMatch[2]]
    ).filter(Boolean);

    const rawAttrs = indexMatch[3] ?? '';
    const attrs = splitAttributes(rawAttrs).map((a) => a.toLowerCase());
    const isPk = attrs.some((a) => a === 'pk' || a === 'primary key');
    const isUnique = attrs.includes('unique');
    const name = rawAttrs.match(/name:\s*['"`](.+?)['"`]/i)?.[1];

    if (isPk) {
      // Composite primary key: mark member columns
      for (const columnName of columns) {
        const column = table.columns.find((c) => c.name === columnName);
        if (column) {
          column.pk = true;
          column.nullable = false;
        }
      }
      if (name) {
        table.indexes = table.indexes ?? [];
        table.indexes.push({ columns, pk: true, name });
      }
      return true;
    }

    if (columns.length === 1 && isUnique) {
      const column = table.columns.find((c) => c.name === columns[0]);
      if (column) {
        column.unique = true;
        if (name) {
          table.indexes = table.indexes ?? [];
          table.indexes.push({ columns, unique: true, name });
        }
        return true;
      }
    }

    table.indexes = table.indexes ?? [];
    table.indexes.push({
      columns,
      unique: isUnique || undefined,
      name,
    });
    return true;
  }

  /*
    Detects if a junction table exists for many-to-many relations.
    Only Many-to-Many relations are considered.
    If the junction table exists, it validates and enhances it.
    Junction tables are tagged with `isJunction` so generators don't have to guess.
  */
  private detectJunctionTable(
    schema: DatabaseSchema,
    relation: Relation,
    junctionTableName: string,
    diagnostics: Diagnostic[],
  ): void {
    if (
      relation.cardinality.from !== Cardinality.Many ||
      relation.cardinality.to !== Cardinality.Many
    ) {
      return;
    }

    // Search if junction table already exists
    const junctionTable = schema.tables.find(
      (t) => t.name === junctionTableName,
    );

    /*
      Expected name is based on convention: e.g., table1.col <> table2.col
      In case the junction table exists, we validate it has the expected foreign keys.
      If it doesn't exist, we create it with the expected foreign keys.
    */
    const fromTable = schema.tables.find((t) => t.name === relation.from.table);
    const toTable = schema.tables.find((t) => t.name === relation.to.table);

    const fromColumn = fromTable?.columns.find(
      (c) => c.name === relation.from.column,
    );
    const toColumn = toTable?.columns.find(
      (c) => c.name === relation.to.column,
    );

    const conventionalFromColumnName = `${relation.from.table}_${relation.from.column}`;
    const conventionalToColumnName = `${relation.to.table}_${relation.to.column}`;
    const endpointNamesCollide =
      conventionalFromColumnName === conventionalToColumnName;
    const sameEndpoint =
      relation.from.table === relation.to.table &&
      relation.from.column === relation.to.column;

    /*
      Different endpoints can also collapse to the same conventional name when
      underscores make their table/column boundaries ambiguous. Keep declaration
      order as stable source/target roles whenever the generated names collide.
    */
    const expectedFromColumnName = endpointNamesCollide
      ? `${relation.from.table}_source_${relation.from.column}`
      : conventionalFromColumnName;
    const expectedToColumnName = endpointNamesCollide
      ? `${relation.to.table}_target_${relation.to.column}`
      : conventionalToColumnName;

    const makeFkColumn = (
      name: string,
      type: string | undefined,
      refTable: string,
      refColumn: string,
    ): Column => ({
      name,
      type: type || 'int',
      pk: true,
      nullable: false,
      sourceLine: relation.sourceLine,
      ref: {
        table: refTable,
        column: refColumn,
        cardinality: CARDINALITY_MAP[RelationOperator.ManyToOne],
      },
    });

    if (junctionTable) {
      // Table exists - validate and enhance it
      junctionTable.isJunction = true;

      const referencesEndpoint = (
        column: Column,
        endpoint: Relation['from'],
      ): boolean =>
        column.ref?.table === endpoint.table &&
        column.ref?.column === endpoint.column;

      let fromFk: Column | undefined;
      let toFk: Column | undefined;

      if (sameEndpoint) {
        const endpointFks = junctionTable.columns.filter((column) =>
          referencesEndpoint(column, relation.from),
        );

        /*
          Prefer role-aware generated names when present. Otherwise preserve
          explicit DBML column order, but never let one FK satisfy both roles.
        */
        fromFk = endpointFks.find(
          (column) => column.name === expectedFromColumnName,
        );
        toFk = endpointFks.find(
          (column) =>
            column !== fromFk && column.name === expectedToColumnName,
        );

        const unmatchedFks = endpointFks.filter(
          (column) => column !== fromFk && column !== toFk,
        );
        fromFk ??= unmatchedFks.shift();
        toFk ??= unmatchedFks.shift();
      } else {
        fromFk = junctionTable.columns.find((column) =>
          referencesEndpoint(column, relation.from),
        );
        toFk = junctionTable.columns.find(
          (column) =>
            column !== fromFk && referencesEndpoint(column, relation.to),
        );
      }

      // Junction FK columns form the composite primary key.
      for (const column of [fromFk, toFk]) {
        if (column && !column.pk) {
          column.pk = true;
          column.nullable = false;
        }
      }

      // Add missing foreign keys if needed
      const addedColumns: string[] = [];
      const usedColumnNames = new Set(
        junctionTable.columns.map((column) => column.name),
      );
      const reserveColumnName = (preferredName: string): string => {
        let name = preferredName;
        let suffix = 2;

        while (usedColumnNames.has(name)) {
          name = `${preferredName}_${suffix}`;
          suffix += 1;
        }

        usedColumnNames.add(name);
        return name;
      };

      if (!fromFk) {
        const columnName = reserveColumnName(expectedFromColumnName);
        junctionTable.columns.push(
          makeFkColumn(
            columnName,
            fromColumn?.type,
            relation.from.table,
            relation.from.column,
          ),
        );
        addedColumns.push(columnName);
      }

      if (!toFk) {
        const columnName = reserveColumnName(expectedToColumnName);
        junctionTable.columns.push(
          makeFkColumn(
            columnName,
            toColumn?.type,
            relation.to.table,
            relation.to.column,
          ),
        );
        addedColumns.push(columnName);
      }

      if (addedColumns.length) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.SCHEMA_JUNCTION_TABLE_CREATED,
          severity: 'info',
          phase: 'parse',
          message: `Completed junction table "${junctionTableName}" for ${relation.from.table}.${relation.from.column} <> ${relation.to.table}.${relation.to.column}: added ${addedColumns.join(', ')}.`,
          line: relation.sourceLine,
          schemaPath: `tables.${junctionTableName}`,
          details: { addedColumns },
        });
      }
    } else {
      // Table doesn't exist - create it
      schema.tables.push({
        name: junctionTableName,
        alias: null,
        isJunction: true,
        columns: [
          makeFkColumn(
            expectedFromColumnName,
            fromColumn?.type,
            relation.from.table,
            relation.from.column,
          ),
          makeFkColumn(
            expectedToColumnName,
            toColumn?.type,
            relation.to.table,
            relation.to.column,
          ),
        ],
      });

      diagnostics.push({
        code: DIAGNOSTIC_CODES.SCHEMA_JUNCTION_TABLE_CREATED,
        severity: 'info',
        phase: 'parse',
        message: `Created junction table "${junctionTableName}" for ${relation.from.table}.${relation.from.column} <> ${relation.to.table}.${relation.to.column}.`,
        line: relation.sourceLine,
        schemaPath: `tables.${junctionTableName}`,
        details: {
          addedColumns: [expectedFromColumnName, expectedToColumnName],
        },
      });
    }
  }

  /*
  Adds missing foreign key columns from external relations. (e.g. Ref defined outside table)
  If a relation references a column that doesn't exist in the table, it creates the column automatically with the reference.
  If the column exists but doesn't have a reference, it adds the reference.
*/
  private addMissingForeignKeyColumns(
    schema: DatabaseSchema,
    diagnostics: Diagnostic[],
  ): void {
    for (const relation of schema.relations) {
      // Many-to-Many relations don't have foreign keys in either table, so we skip them
      if (
        relation.cardinality.from === Cardinality.Many &&
        relation.cardinality.to === Cardinality.Many
      ) {
        continue;
      }

      // Find the table that should have the foreign key column
      const fromTable = schema.tables.find(
        (t) => t.name === relation.from.table,
      );
      if (!fromTable) continue;

      // Check if the column already exists
      const fromColumn = fromTable.columns.find(
        (c) => c.name === relation.from.column,
      );

      if (!fromColumn) {
        // Column doesn't exist, create it with the reference
        // e.g.
        //    Table posts { user_id int }
        //    Ref: orders.user_id > users.id

        const toTable = schema.tables.find((t) => t.name === relation.to.table);
        const toColumn = toTable?.columns.find(
          (c) => c.name === relation.to.column,
        );

        if (toColumn) {
          // Use the exact column name the user wrote in the Ref (not a derived one)
          fromTable.columns.push({
            name: relation.from.column,
            type: toColumn.type,
            nullable: true,
            sourceLine: relation.sourceLine,
            ref: {
              table: relation.to.table,
              column: relation.to.column,
              cardinality: relation.cardinality,
              ...(relation.onDelete && { onDelete: relation.onDelete }),
              ...(relation.onUpdate && { onUpdate: relation.onUpdate }),
            },
          });

          diagnostics.push({
            code: DIAGNOSTIC_CODES.SCHEMA_FK_COLUMN_CREATED,
            severity: 'info',
            phase: 'parse',
            message: `Created ${fromTable.name}.${relation.from.column} (${toColumn.type}) from the Ref to ${relation.to.table}.${relation.to.column}.`,
            line: relation.sourceLine,
            schemaPath: `tables.${fromTable.name}.columns.${relation.from.column}`,
            details: {
              table: fromTable.name,
              column: relation.from.column,
              type: toColumn.type,
              target: `${relation.to.table}.${relation.to.column}`,
            },
          });
        }
      } else if (!fromColumn.ref) {
        // Column exists but has no reference, add it
        fromColumn.ref = {
          table: relation.to.table,
          column: relation.to.column,
          cardinality: relation.cardinality,
          ...(relation.onDelete && { onDelete: relation.onDelete }),
          ...(relation.onUpdate && { onUpdate: relation.onUpdate }),
        };
      }
    }
  }

  private deduplicateRelations(schema: DatabaseSchema): DatabaseSchema {
    /*
      Remove duplicate relations: same (from, to) pair, in either direction
      (an inline ref plus a global Ref of the same link count once).
    */
    const seen = new Set<string>();
    const uniqueRelations: Relation[] = [];

    for (const relation of schema.relations) {
      const key = `${relation.from.table}.${relation.from.column}->${relation.to.table}.${relation.to.column}`;
      const reverseKey = `${relation.to.table}.${relation.to.column}->${relation.from.table}.${relation.from.column}`;

      if (seen.has(key) || seen.has(reverseKey)) continue;
      seen.add(key);
      uniqueRelations.push(relation);
    }

    return {
      ...schema,
      relations: uniqueRelations,
    };
  }

  private parseColumnLine(line: string): ParsedColumnLine | null {
    /*
      name type(args)? [attributes]?
      The type may carry arguments with commas: decimal(10,2), varchar(255)
    */
    const columnMatch = line.match(
      /^([\w_]+)\s+([\w]+(?:\([^)]*\))?)\s*(?:\[(.*)\])?\s*$/,
    );
    if (!columnMatch) return null;

    const [, name, type, attributes] = columnMatch;
    const column: Column = { name, type };
    let unknownAttributes: string[] = [];

    if (attributes) {
      // Split on top-level commas only (quotes/parens aware)
      const attributeList = splitAttributes(attributes);

      // Apply centralized flags
      Object.assign(column, getColumnFlags(attributeList));

      // Parse other attributes (ref, default, note, referential actions)
      unknownAttributes = this.parseAttributes(column, attributeList);
    }

    // DBML columns are nullable unless marked otherwise; pk implies not null
    if (column.nullable === undefined) {
      column.nullable = !column.pk;
    }

    return { column, unknownAttributes };
  }

  private parseAttributes(
    column: Column,
    attributeList: string[],
  ): string[] {
    const recognized = new Set<string>();

    for (const attr of attributeList) {
      if (Object.keys(getColumnFlags([attr])).length > 0) {
        recognized.add(attr);
      }
      if (this.parseReference(attr, column)) recognized.add(attr);
      if (this.parseDefault(attr, column)) recognized.add(attr);
      if (this.parseNote(attr, column)) recognized.add(attr);
    }

    // Referential actions apply to the column's ref: [ref: > users.id, delete: cascade]
    if (column.ref) {
      const actions = this.parseReferentialActions(attributeList);
      Object.assign(column.ref, actions);

      for (const attr of attributeList) {
        if (Object.keys(this.parseReferentialActions([attr])).length > 0) {
          recognized.add(attr);
        }
      }
    }

    return attributeList.filter((attr) => !recognized.has(attr));
  }

  private parseReferentialActions(
    attributeList: string[],
  ): ReferentialActions {
    const actions: ReferentialActions = {};
    const supportedActions = new Set<string>(Object.values(ReferentialAction));

    for (const attr of attributeList) {
      const actionMatch = attr.match(/^(delete|update):\s*(.+)$/i);
      if (!actionMatch) continue;

      const action = actionMatch[2]
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
      if (!supportedActions.has(action)) continue;

      if (actionMatch[1].toLowerCase() === 'delete') {
        actions.onDelete = action as ReferentialAction;
      } else {
        actions.onUpdate = action as ReferentialAction;
      }
    }

    return actions;
  }

  /** Parse references like:
   * - ref: > authors.id   | Many-to-One
   * - ref: < authors.id   | One-to-Many
   * - ref: <> authors.id  | Many-to-Many
   * - ref: - authors.id   | One-to-One
   */
  private parseReference(attr: string, column: Column): boolean {
    const refMatch = attr.match(
      /^ref:\s*(<>|<|>|-)\s*([\w_]+)\.([\w_]+)\s*$/i,
    );
    if (!refMatch) return false;

    const [, direction, refTable, refColumn] = refMatch;

    column.ref = {
      table: refTable,
      column: refColumn,
      cardinality:
        CARDINALITY_MAP[direction as RelationOperator] ??
        CARDINALITY_MAP[RelationOperator.OneToOne],
    };
    return true;
  }

  /** Parse default values: string, number, boolean, or expression */
  private parseDefault(attr: string, column: Column): boolean {
    const defaultMatch = attr.match(/^default:\s*(.+)/i);
    if (!defaultMatch) return false;

    let rawValue = defaultMatch[1].trim();
    if (!rawValue) return false;

    // Backticks mark a DB expression per the DBML spec: `now()`
    if (
      rawValue.startsWith('`') &&
      rawValue.endsWith('`') &&
      rawValue.length > 1
    ) {
      column.default = rawValue.slice(1, -1);
      column.isExpression = true;
      return true;
    }

    // Detect and strip quotes: always a string
    if (
      (rawValue.startsWith("'") && rawValue.endsWith("'")) ||
      (rawValue.startsWith('"') && rawValue.endsWith('"'))
    ) {
      column.default = rawValue.slice(1, -1);
      return true;
    }

    /* If not quoted, try to parse as boolean or number */
    // Boolean
    const lower = rawValue.toLowerCase();
    if (lower === 'true') {
      column.default = true;
      return true;
    }
    if (lower === 'false') {
      column.default = false;
      return true;
    }

    // Number
    const num = Number(rawValue);
    if (!isNaN(num)) {
      column.default = num;
      return true;
    }

    // Unquoted function call, e.g. default: now()
    if (/^\w+\(.*\)$/.test(rawValue)) {
      column.default = rawValue;
      column.isExpression = true;
      return true;
    }

    // Fallback: raw string
    column.default = rawValue;
    return true;
  }

  /** Parse notes: note: '...' */
  private parseNote(attr: string, column: Column): boolean {
    const noteMatch = attr.match(/^note:\s*['"`](.*?)['"`]\s*$/i);
    if (noteMatch) {
      column.note = noteMatch[1];
      return true;
    }
    return false;
  }
}
