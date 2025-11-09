import { Injectable } from '@angular/core';

import {
  CREATED_AT_FIELDS,
  TIME_FIELD,
  UPDATED_AT_FIELDS,
} from '../../dbml-parser/constants';

import {
  DatabaseSchema,
  Table,
  Column,
  Cardinality,
} from '../../dbml-parser/interfaces/dbml-parser.interface';
import { PrismaGeneratedCode } from './interfaces/prisma-generator.interface';

import { mapDbTypeToPrismaType } from '../mappers/prisma.mapper';

@Injectable({ providedIn: 'root' })
export class PrismaGeneratorService {
  generateCode(schema: DatabaseSchema): PrismaGeneratedCode {
    const models = schema.tables
      .map((table) => this.generateModel(table, schema))
      .join('\n\n');

    return {
      schema: this.generateSchemaFile(models),
    };
  }

  private generateSchemaFile(models: string): string {
    return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

${models}
`;
  }

  private generateModel(table: Table, schema: DatabaseSchema): string {
    const modelName = this.getModelName(table.name);
    const isJunctionTable = this.isJunctionTable(table, schema);

    // For junction tables, add an auto-increment ID
    let fields = '';

    if (isJunctionTable) {
      fields = 'id Int @id @default(autoincrement())\n  ';
    }

    // Generate fields (including FK columns)
    const tableFields = table.columns
      .map((col) => this.generateField(col, table, schema, isJunctionTable))
      .filter(Boolean)
      .join('\n  ');

    fields += tableFields;

    // Generate relations
    const relations = this.generateRelations(table, schema);

    const allFields = [fields, relations].filter(Boolean).join('\n\n  ');

    return `model ${modelName} {
  ${allFields}
}`;
  }

  private isJunctionTable(table: Table, schema: DatabaseSchema): boolean {
    const foreignKeyColumns = table.columns.filter((col) => col.ref);

    if (foreignKeyColumns.length < 2) return false;

    const distinctRefTables = new Set(
      foreignKeyColumns.map((col) => col.ref?.table).filter(Boolean)
    );

    return distinctRefTables.size >= 2;
  }

  private generateField(
    column: Column,
    table: Table,
    schema: DatabaseSchema,
    isJunctionTable: boolean
  ): string {
    const fieldName = column.name;
    const fieldType = this.mapToPrismaType(column);
    const attributes = this.getFieldAttributes(
      column,
      table,
      schema,
      isJunctionTable
    );

    const comment = column.note ? `/// ${column.note}\n  ` : '';

    return `${comment}${fieldName} ${fieldType}${attributes}`;
  }

  private mapToPrismaType(column: Column): string {
    const baseType = mapDbTypeToPrismaType(column.type);

    // Handle special dates/timestamps with defaults
    const hasDefault =
      column.default !== undefined ||
      CREATED_AT_FIELDS.includes(column.name.toLowerCase()) ||
      UPDATED_AT_FIELDS.includes(column.name.toLowerCase());

    // Check if nullable
    const isNullable = column.nullable === true && !hasDefault;

    return isNullable ? `${baseType}?` : baseType;
  }

  private getFieldAttributes(
    column: Column,
    table: Table,
    schema: DatabaseSchema,
    isJunctionTable: boolean
  ): string {
    const attrs: string[] = [];

    // Primary key (skip for junction tables, they get auto-increment ID)
    if (column.pk && !isJunctionTable) {
      if (column.increment) {
        attrs.push('@id @default(autoincrement())');
      } else {
        attrs.push('@id');
      }
    }

    // Unique
    if (column.unique && !column.pk) {
      attrs.push('@unique');
    }

    // Default values (skip if it's a timestamp column with special handling)
    if (column.default !== undefined && !column.increment) {
      const isSpecialTimestamp =
        CREATED_AT_FIELDS.concat(UPDATED_AT_FIELDS).includes(
          column.name.toLowerCase()
        ) && TIME_FIELD.includes(column.type.toLowerCase());

      if (!isSpecialTimestamp) {
        attrs.push(this.formatDefault(column.default, column.type));
      }
    }

    // Special timestamp fields, instead of just default, add Prisma attributes
    if (CREATED_AT_FIELDS.includes(column.name.toLowerCase())) {
      attrs.push('@default(now())');
    }
    if (UPDATED_AT_FIELDS.includes(column.name.toLowerCase())) {
      attrs.push('@updatedAt');
    }

    // Database column name mapping (snake_case in DB)
    if (column.name.includes('_')) {
      attrs.push(`@map("${column.name}")`);
    }

    return attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  }

  private formatDefault(value: any, type: string): string {
    /*
      There are small differences, like quotes for strings.
      - string: "default_value"
      - boolean: true/false
      - number: 123
    */
    if (typeof value === 'string') {
      return `@default("${value}")`;
    }
    if (typeof value === 'boolean') {
      return `@default(${value})`;
    }
    if (typeof value === 'number') {
      return `@default(${value})`;
    }
    return '';
  }

  /*
  Generate relation fields for the model, including handling of
  Many-to-One, One-to-Many, One-to-One relationships.
  */
  private generateRelations(table: Table, schema: DatabaseSchema): string {
    const relations: string[] = [];

    // Direct relations (Many-to-One and One-to-One)
    for (const column of table.columns) {
      /*
        Skip to the next iteration ('continue') if:
        - The column has no reference (not a foreign key)
        - The column is a junction table column (Many-to-Many)

      */
      if (!column.ref) continue;

      const relatedTable = schema.tables.find(
        (t) => t.name === column.ref?.table
      );
      if (!relatedTable) continue;

      if (
        column.ref.cardinality?.from === Cardinality.Many &&
        column.ref.cardinality?.to === Cardinality.Many
      ) {
        continue;
      }

      /*
        Determine relation field name, related model name, and optionality.
        Then, push the relation definition to the relations array.

        e.g. for a Many-to-One relation:
        user User @relation(fields: [user_id], references: [id])
      */
      const relationName = this.camelCase(relatedTable.name);
      const relatedModel = this.getModelName(relatedTable.name);

      const isOptional = column.nullable === true ? '?' : '';

      relations.push(
        `${relationName} ${relatedModel}${isOptional} @relation(fields: [${column.name}], references: [${column.ref.column}])`
      );
    }

    //  Inverse relationships (One-to-Many and junction tables)
    for (const otherTable of schema.tables) {
      // Skip self-references
      if (otherTable.name === table.name) continue;

      const foreignKeys = otherTable.columns.filter(
        (col) => col.ref?.table === table.name
      );

      for (const fk of foreignKeys) {
        const relatedModel = this.getModelName(otherTable.name);
        const relationName = this.camelCase(otherTable.name);

        // Skip Many-to-Many reverse relations
        if (
          fk.ref?.cardinality?.from === Cardinality.Many &&
          fk.ref?.cardinality?.to === Cardinality.Many
        ) {
          continue;
        }

        if (fk.unique) {
          // One-to-One reverse
          relations.push(`${relationName} ${relatedModel}?`);
        } else {
          // One-to-Many reverse (including junction tables)
          relations.push(`${relationName} ${relatedModel}[]`);
        }
      }
    }

    return relations.join('\n  ');
  }

  /*
  Convert snake_case table names to PascalCase for model names
  */
  private getModelName(tableName: string): string {
    return tableName
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  /*
  Convert snake_case to camelCase for relation field names
  e.g., user_profile -> userProfile
  */
  private camelCase(name: string): string {
    const parts = name.split('_');
    return parts
      .map((part, index) =>
        index === 0
          ? part.toLowerCase()
          : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      )
      .join('');
  }
}
