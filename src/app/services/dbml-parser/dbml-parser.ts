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

      // Relationship definition (outside tables) - sintaxis global
      /*
        e.g. regex
        Ref name_optional: schema1.table1.column1 < schema2.table2.column2
        Ref: books.id <> authors.id
        Ref books: books.id <> authors.id
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
  */
  private detectJunctionTable(
    schema: DatabaseSchema,
    relation: Relation,
    junctionTableName: string
  ): void {
    // Search if junction table already exists
    const junctionTable = schema.tables.find(
      (t) => t.name === junctionTableName
    );

    if (!junctionTable) {
      // Create a suggested junction table
      schema.tables.push({
        name: junctionTableName,
        alias: null,
        columns: [
          {
            name: `${relation.from.table}_id`,
            type: 'int',
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
            name: `${relation.to.table}_id`,
            type: 'int',
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
      // Find the table that should have the foreign key column
      const table = schema.tables.find((t) => t.name === relation.from.table);
      if (!table) continue;

      // Check if the column already exists
      const existingColumn = table.columns.find(
        (col) => col.name === relation.from.column
      );

      if (existingColumn) {
        // Column exists but might not have a reference
        // e.g.
        //    Table posts { user_id int }
        //    Ref: orders.user_id > users.id
        if (!existingColumn.ref) {
          // Add the reference to the existing column
          existingColumn.ref = {
            table: relation.to.table,
            column: relation.to.column,
            cardinality: relation.cardinality,
          };
        }
      } else {
        // Column doesn't exist, create it with reference
        // Determine the type based on the referenced column
        // e.g.
        //    Table orders {  } // no user_id column
        //    Ref: orders.user_id > users.id
        const referencedTable = schema.tables.find(
          (t) => t.name === relation.to.table
        );

        const referencedColumn = referencedTable?.columns.find(
          (col) => col.name === relation.to.column
        );

        const columnType = referencedColumn?.type || 'int';

        // Create the foreign key column
        const newColumn: Column = {
          name: relation.from.column,
          type: columnType,
          ref: {
            table: relation.to.table,
            column: relation.to.column,
            cardinality: relation.cardinality,
          },
        };

        table.columns.push(newColumn);
      }
    }
  }

  private deduplicateRelations(schema: DatabaseSchema): DatabaseSchema {
    /*
      If there are duplicate relations (same from and to), we remove them.
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

    const cardinalityMap: Record<
      string,
      { from: Cardinality; to: Cardinality }
    > = {
      '>': { from: Cardinality.Many, to: Cardinality.One },
      '<': { from: Cardinality.One, to: Cardinality.Many },
      '<>': { from: Cardinality.Many, to: Cardinality.Many },
      '-': { from: Cardinality.One, to: Cardinality.One },
    };

    ref.cardinality = cardinalityMap[direction] ?? {
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
    switch (operator) {
      case RelationOperator.OneToOne: // '='
        cardinality = { from: Cardinality.One, to: Cardinality.One };
        break;

      case RelationOperator.OneToMany: // '<'
        /* For '<', table1 has many table2 records (one-to-many from table1 perspective) */
        cardinality = { from: Cardinality.One, to: Cardinality.Many };
        break;

      case RelationOperator.ManyToOne: // '>'
        /* For '>', many table1 records point to one table2 record (many-to-one from table1 perspective) */
        cardinality = { from: Cardinality.Many, to: Cardinality.One };
        break;

      case RelationOperator.ManyToMany: // '<>'
        /* Many to many in both directions */
        cardinality = { from: Cardinality.Many, to: Cardinality.Many };
        break;

      default:
        return null;
    }

    /* By default, we return from table1 to table2 */
    return {
      from: { table: table1, column: col1 },
      to: { table: table2, column: col2 },
      cardinality,
    };
  }
}
