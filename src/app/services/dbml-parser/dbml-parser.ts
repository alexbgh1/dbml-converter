import {
  Injectable,
  signal,
  computed,
  effect,
  WritableSignal,
} from '@angular/core';

import {
  Column,
  ColumnRef,
  DatabaseSchema,
  Relation,
  Table,
  Cardinality,
  RelationOperator,
  CARDINALITY_MAP,
} from './interfaces/dbml-parser.interface';

import { getColumnFlags } from './helpers';
import { DEFAULT_CARDINALITY } from './constants';

@Injectable({ providedIn: 'root' })
export class DbmlParserService {
  private dbmlContent: WritableSignal<string> = signal<string>('');
  private parsingError: WritableSignal<string | null> = signal<string | null>(
    null
  );
  private parsedSchema: WritableSignal<DatabaseSchema | null> =
    signal<DatabaseSchema | null>(null);

  readonly schema = computed(() => this.parsedSchema());
  readonly hasError = computed(() => this.parsingError() !== null);
  readonly errorMessage = computed(() => this.parsingError());

  constructor() {
    effect(() => {
      const content = this.dbmlContent();
      try {
        this.parsingError.set(null);
        this.parsedSchema.set(this.parseDbmlToJson(content));
      } catch (error) {
        this.parsingError.set(
          error instanceof Error ? error.message : 'Unknown parsing error'
        );
        this.parsedSchema.set(null);
      }
    });
  }

  setDbmlContent(content: string): void {
    this.dbmlContent.set(content);
  }

  /**
   * Convert DBML content to JSON schema.
   * Handles tables, columns, and relationships (including junction tables).
   */
  private parseDbmlToJson(dbmlContent: string): DatabaseSchema {
    if (!dbmlContent.trim()) {
      return { tables: [], relations: [] };
    }

    const lines = dbmlContent.split('\n');
    const schema: DatabaseSchema = {
      tables: [],
      relations: [],
    };

    let currentTable: Table | null = null;

    for (let line of lines) {
      line = line.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('//')) continue;

      // Table definition
      const tableMatch = line.match(/Table\s+([\w_]+)\s*\{/);
      if (tableMatch) {
        currentTable = {
          name: tableMatch[1],
          alias: null,
          columns: [],
        };
        schema.tables.push(currentTable);
        continue;
      }

      // End of table
      if (line === '}' && currentTable) {
        currentTable = null;
        continue;
      }

      // Column definition inside table
      if (currentTable) {
        const column = this.parseColumnLine(line);
        if (column) {
          currentTable.columns.push(column);

          // Handle Inline reference
          if (column.ref) {
            const cardinality = this.determineRelationCardinalityFromRef(
              column.ref
            );
            schema.relations.push({
              from: { table: currentTable.name, column: column.name },
              to: { table: column.ref.table, column: column.ref.column },
              cardinality,
            });
          }
        }
        continue;
      }

      /*
      // Relationship definition (outside tables) - sintaxis global
        e.g. regex
        Ref name_optional: schema1.table1.column1 < schema2.table2.column2
        Ref: books.id <> authors.id
        Ref books: books.id <> authors.id

        relationMatch contains:
          [0]: full match
          [1]: optional reference name (it's the joint table name)
          [2]: from table
          [3]: from column
          [4]: operator
          [5]: to table
          [6]: to column

      */
      const relationMatch = line.match(
        /Ref(?:\s+(\w+))?\s*:?\s*([\w_]+)\.([\w_]+)\s*([<>=]+)\s*([\w_]+)\.([\w_]+)/
      );

      if (relationMatch) {
        const relation = this.parseRelationshipLine(line);

        if (relation) {
          schema.relations.push(relation);

          // If the relation is many to many, then
          // we should check if there's a junction table defined
          if (
            relation.cardinality.from === Cardinality.Many &&
            relation.cardinality.to === Cardinality.Many
          ) {
            const junctionTableName =
              relationMatch[1] || `${relation.from.table}_${relation.to.table}`;
            this.detectJunctionTable(schema, relation, junctionTableName);
          }
        }
      }
    }

    // Add missing foreign key columns from external relations
    this.addMissingForeignKeyColumns(schema);

    return this.deduplicateRelations(schema);
  }

  private determineRelationCardinalityFromRef(
    ref: ColumnRef
  ): Relation['cardinality'] {
    const DEFAULT_CARDINALITY = {
      from: Cardinality.Many,
      to: Cardinality.One,
    };

    return ref.cardinality || DEFAULT_CARDINALITY;
  }

  /*
    Detects if a junction table exists for many-to-many relations.
    Only Many-to-Many relations are considered.
  */
  private detectJunctionTable(
    schema: DatabaseSchema,
    relation: Relation,
    junctionTableName: string
  ): void {
    if (
      relation.cardinality.from !== Cardinality.Many ||
      relation.cardinality.to !== Cardinality.Many
    ) {
      return;
    }

    // Search if junction table already exists
    const junctionTable = schema.tables.find(
      (t) => t.name === junctionTableName
    );

    /*
      Expected name is based on convention: e.g., table1.col <> table2.col
      In case the junction table exists, we validate it has the expected foreign keys.
      If it doesn't exist, we create it with the expected foreign keys.
    */
    const fromTable = schema.tables.find((t) => t.name === relation.from.table);
    const toTable = schema.tables.find((t) => t.name === relation.to.table);

    const fromColumn = fromTable?.columns.find(
      (c) => c.name === relation.from.column
    );
    const toColumn = toTable?.columns.find(
      (c) => c.name === relation.to.column
    );

    const expectedFromColumnName = `${relation.from.table}_${relation.from.column}`;
    const expectedToColumnName = `${relation.to.table}_${relation.to.column}`;

    if (junctionTable) {
      // Table exists - validate and enhance it
      let hasFromFK = false;
      let hasToFK = false;

      // Check if the expected foreign keys exist
      for (const column of junctionTable.columns) {
        // Check for FK to fromTable
        if (
          column.ref?.table === relation.from.table &&
          column.ref?.column === relation.from.column
        ) {
          hasFromFK = true;
          // Ensure it's marked as PK for composite key
          if (!column.pk) {
            column.pk = true;
          }
        }

        // Check for FK to toTable
        if (
          column.ref?.table === relation.to.table &&
          column.ref?.column === relation.to.column
        ) {
          hasToFK = true;
          // Ensure it's marked as PK for composite key
          if (!column.pk) {
            column.pk = true;
          }
        }
      }

      // Add missing foreign keys if needed
      if (!hasFromFK) {
        junctionTable.columns.push({
          name: expectedFromColumnName,
          type: fromColumn?.type || 'int',
          pk: true,
          ref: {
            table: relation.from.table,
            column: relation.from.column,
            cardinality: {
              from: Cardinality.Many,
              to: Cardinality.One,
            },
          },
        });
      }

      if (!hasToFK) {
        junctionTable.columns.push({
          name: expectedToColumnName,
          type: toColumn?.type || 'int',
          pk: true,
          ref: {
            table: relation.to.table,
            column: relation.to.column,
            cardinality: {
              from: Cardinality.Many,
              to: Cardinality.One,
            },
          },
        });
      }
    } else {
      // Table doesn't exist - create it
      schema.tables.push({
        name: junctionTableName,
        alias: null,
        columns: [
          {
            name: expectedFromColumnName,
            type: fromColumn?.type || 'int',
            pk: true,
            ref: {
              table: relation.from.table,
              column: relation.from.column,
              cardinality: {
                from: Cardinality.Many,
                to: Cardinality.One,
              },
            },
          },
          {
            name: expectedToColumnName,
            type: toColumn?.type || 'int',
            pk: true,
            ref: {
              table: relation.to.table,
              column: relation.to.column,
              cardinality: {
                from: Cardinality.Many,
                to: Cardinality.One,
              },
            },
          },
        ],
      });
    }
  }

  /*
  Adds missing foreign key columns from external relations. (e.g. Ref defined outside table)
  If a relation references a column that doesn't exist in the table, it creates the column automatically with the reference.
  If the column exists but doesn't have a reference, it adds the reference.
*/
  private addMissingForeignKeyColumns(schema: DatabaseSchema): void {
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
        (t) => t.name === relation.from.table
      );
      if (!fromTable) continue;

      // Check if the column already exists
      const fromColumn = fromTable.columns.find(
        (c) => c.name === relation.from.column
      );

      if (!fromColumn) {
        // Column doesn't exist, create it with the reference
        // e.g.
        //    Table posts { user_id int }
        //    Ref: orders.user_id > users.id

        const toTable = schema.tables.find((t) => t.name === relation.to.table);
        const toColumn = toTable?.columns.find(
          (c) => c.name === relation.to.column
        );

        if (toColumn) {
          fromTable.columns.push({
            name: `${relation.to.table}_${relation.to.column}`,
            type: toColumn.type,
            ref: {
              table: relation.to.table,
              column: relation.to.column,
              cardinality: relation.cardinality,
            },
          });
        }
      } else if (!fromColumn.ref) {
        // Column exists but has no reference, add it
        fromColumn.ref = {
          table: relation.to.table,
          column: relation.to.column,
          cardinality: relation.cardinality,
        };
      }
    }
  }

  private deduplicateRelations(schema: DatabaseSchema): DatabaseSchema {
    /*
      If there are duplicate relations (same "from" and "to"), we remove them.
    */

    const uniqueRelations = schema.relations.filter(
      (relation, index, self) =>
        index ===
        self.findIndex(
          (r) =>
            r.from.table === relation.from.table &&
            r.from.column === relation.from.column &&
            r.to.table === relation.to.table &&
            r.to.column === relation.to.column
        )
    );

    return {
      ...schema,
      relations: uniqueRelations,
    };
  }

  private parseColumnLine(line: string): Column | null {
    // Attributes are inside square brackets []
    const columnWithAttrsMatch = line.match(
      /([\w_]+)\s+([\w\(\)]+)\s*\[([^\]]+)\]/
    );
    if (columnWithAttrsMatch) {
      const [, name, type, attributes] = columnWithAttrsMatch;
      const column: Column = { name, type };

      // Parse attributes en array
      const attributeList = attributes
        .split(',')
        .map((attr: string) => attr.trim());

      // Apply centralized flags
      Object.assign(column, getColumnFlags(attributeList));

      // Parse other attributes (ref, default, etc.)
      this.parseAttributes(column, attributeList);

      return column;
    }

    // If there are no attributes, match simple column definition
    const simpleColumnMatch = line.match(/([\w_]+)\s+([\w\(\)]+)/);
    if (simpleColumnMatch) {
      const [, name, type] = simpleColumnMatch;
      return { name, type };
    }

    return null;
  }

  private parseAttributes(column: Column, attributeList: string[]): void {
    for (const attr of attributeList) {
      this.parseReference(attr, column);
      this.parseDefault(attr, column);
      this.parseNote(attr, column);
    }
  }

  /** Parse references like:
   * - ref: > authors.id   | Many-to-One
   * - ref: < authors.id   | One-to-Many
   * - ref: <> authors.id  | Many-to-Many
   * - ref: - authors.id   | One-to-One
   */
  private parseReference(attr: string, column: Column): void {
    const refMatch = attr.match(/ref:\s*(<>|<|>|-)\s*([\w_]+)\.([\w_]+)/);
    if (!refMatch) return;

    console.log(refMatch);

    const [, direction, refTable, refColumn] = refMatch;
    const ref: ColumnRef = { table: refTable, column: refColumn };

    ref.cardinality = CARDINALITY_MAP[direction as RelationOperator] ?? {
      from: Cardinality.One,
      to: Cardinality.One,
    };
    column.ref = ref;
  }

  /** Parse default values: string, number, boolean, or expression */
  private parseDefault(attr: string, column: Column): void {
    const defaultMatch = attr.match(/default:\s*(.+)/i);
    if (!defaultMatch) return;

    let rawValue = defaultMatch[1].trim();
    let wasQuoted = false;

    // Detect and strip quotes
    if (
      (rawValue.startsWith("'") && rawValue.endsWith("'")) ||
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith('`') && rawValue.endsWith('`'))
    ) {
      wasQuoted = true;
      rawValue = rawValue.slice(1, -1);
    }

    if (!rawValue) return;

    // If quoted, always return as string
    if (wasQuoted) {
      column.default = rawValue;
      return;
    }

    /* If not quoted, try to parse as boolean or number */
    // Boolean
    const lower = rawValue.toLowerCase();
    if (lower === 'true') {
      column.default = true;
      return;
    }
    if (lower === 'false') {
      column.default = false;
      return;
    }

    // Number
    const num = Number(rawValue);
    if (!isNaN(num)) {
      column.default = num;
      return;
    }

    // Fallback: raw string
    column.default = rawValue;
  }

  /** Parse notes: note: '...' */
  private parseNote(attr: string, column: Column): void {
    const noteMatch = attr.match(/note:\s*['"`](.+?)['"`]/);
    if (noteMatch) {
      column.note = noteMatch[1];
    }
  }

  private parseRelationshipLine(line: string): Relation | null {
    /*
     This function only handles "Short form"

     DBML supports three forms of relationship definitions:
     - Long form
     Ref name_optional {
      schema1.table1.column1 < schema2.table2.column2
    }

    - Short form
    Ref name_optional: schema1.table1.column1 < schema2.table2.column2
    // Ref: books.id <> authors.id
    // Ref books: books.id <> authors.id

    - Inline form (handled in parseDbmlToJson)
    */

    const relationMatch = line.match(
      /Ref(?:\s+(\w+))?\s*:?\s*([\w_]+)\.([\w_]+)\s*([<>=]+)\s*([\w_]+)\.([\w_]+)/
    );
    if (!relationMatch) return null;

    const [, relationName, table1, col1, operator, table2, col2] =
      relationMatch;

    let cardinality: Relation['cardinality'] = DEFAULT_CARDINALITY;

    /* Operator defines the cardinality and direction */
    cardinality =
      CARDINALITY_MAP[operator as RelationOperator] ?? DEFAULT_CARDINALITY;

    /* By default, we return from table1 to table2 */
    return {
      from: { table: table1, column: col1 },
      to: { table: table2, column: col2 },
      cardinality,
    };
  }
}
