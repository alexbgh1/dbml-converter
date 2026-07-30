import { Injectable } from '@angular/core';

import {
  TIMESTAMP_DB_TYPES,
  UPDATED_AT_FIELDS,
} from '../constants/audit-fields.constants';
import { parseDbType, typeFamily } from '../../dbml-parser/helpers';
import { Diagnostic } from '../../dbml-parser/interfaces/diagnostics.interface';
import { DIAGNOSTIC_CODES } from '../../dbml-parser/constants/diagnostic-codes.constants';

import {
  DatabaseSchema,
  Table,
  Column,
  Cardinality,
  EnumDef,
  ReferentialAction,
} from '../../dbml-parser/interfaces/dbml-parser.interface';
import { PrismaGeneratedCode } from './interfaces/prisma-generator.interface';

import { mapColumnTypeToPrisma } from '../mappers/prisma.mapper';
import {
  hasNamedSingleUniqueIndex,
  stripIdSuffix,
  toPascalCase,
} from '../helpers';

/* Prisma's built-in scalar vocabulary: generated model names must not shadow it */
const PRISMA_RESERVED_NAMES = [
  'String',
  'Int',
  'BigInt',
  'Float',
  'Boolean',
  'DateTime',
  'Json',
  'Decimal',
  'Bytes',
];

const VALID_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

@Injectable({ providedIn: 'root' })
export class PrismaGeneratorService {
  generateCode(schema: DatabaseSchema): PrismaGeneratedCode {
    const diagnostics: Diagnostic[] = [];

    const enums = (schema.enums ?? [])
      .filter((e) => e.values.length > 0)
      .map((e) => this.generateEnum(e))
      .join('\n\n');

    const models = schema.tables
      .map((table) => this.generateModel(table, schema, diagnostics))
      .join('\n\n');

    this.validateGeneratedNames(schema, diagnostics);

    const blocks = [enums, models].filter(Boolean).join('\n\n');

    return {
      schema: this.generateSchemaFile(blocks),
      diagnostics,
    };
  }

  /*
    Output-validation (phase 3): model-level naming problems. Colliding or
    reserved declarations are still emitted (best-effort preview); the
    diagnostics tell the UI the output is not valid.
  */
  private validateGeneratedNames(
    schema: DatabaseSchema,
    diagnostics: Diagnostic[],
  ): void {
    // Prisma enums and models share one namespace
    const byGeneratedName = new Map<string, string[]>();

    for (const enumDef of schema.enums ?? []) {
      const name = this.getModelName(enumDef.name);
      byGeneratedName.set(name, [
        ...(byGeneratedName.get(name) ?? []),
        enumDef.name,
      ]);

      if (PRISMA_RESERVED_NAMES.includes(name)) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.PRISMA_RESERVED_NAME,
          severity: 'error',
          phase: 'output-validation',
          target: 'prisma',
          message: `Enum "${enumDef.name}" generates "${name}", which conflicts with a built-in Prisma scalar.`,
          line: enumDef.sourceLine,
          schemaPath: `enums.${enumDef.name}`,
        });
      }

      if (!VALID_IDENTIFIER.test(name)) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.OUTPUT_INVALID_IDENTIFIER,
          severity: 'error',
          phase: 'output-validation',
          target: 'prisma',
          message: `Enum "${enumDef.name}" generates "${name}", which is not a valid Prisma enum name.`,
          line: enumDef.sourceLine,
          schemaPath: `enums.${enumDef.name}`,
        });
      }

      enumDef.values.forEach((value, index) => {
        if (VALID_IDENTIFIER.test(value)) return;
        diagnostics.push({
          code: DIAGNOSTIC_CODES.OUTPUT_INVALID_IDENTIFIER,
          severity: 'error',
          phase: 'output-validation',
          target: 'prisma',
          message: `Value "${value}" of enum "${enumDef.name}" is not a valid Prisma enum value.`,
          line: enumDef.valueSourceLines?.[index] ?? enumDef.sourceLine,
          schemaPath: `enums.${enumDef.name}.values.${value}`,
        });
      });
    }

    for (const table of schema.tables) {
      const modelName = this.getModelName(table.name);
      byGeneratedName.set(modelName, [
        ...(byGeneratedName.get(modelName) ?? []),
        table.name,
      ]);

      if (PRISMA_RESERVED_NAMES.includes(modelName)) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.PRISMA_RESERVED_NAME,
          severity: 'error',
          phase: 'output-validation',
          target: 'prisma',
          message: `Table "${table.name}" generates model "${modelName}", which conflicts with a built-in Prisma scalar.`,
          line: table.sourceLine,
          schemaPath: `tables.${table.name}`,
        });
      }

      if (!VALID_IDENTIFIER.test(modelName)) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.OUTPUT_INVALID_IDENTIFIER,
          severity: 'error',
          phase: 'output-validation',
          target: 'prisma',
          message: `Table "${table.name}" generates "${modelName}", which is not a valid Prisma model name.`,
          line: table.sourceLine,
          schemaPath: `tables.${table.name}`,
        });
      }
    }

    for (const [generatedName, physicalNames] of byGeneratedName) {
      if (physicalNames.length < 2) continue;
      // Identical physical names are SCHEMA_DUPLICATE_TABLE, not a naming issue
      if (new Set(physicalNames).size < 2) continue;

      diagnostics.push({
        code: DIAGNOSTIC_CODES.OUTPUT_NAME_COLLISION,
        severity: 'error',
        phase: 'output-validation',
        target: 'prisma',
        message: `"${physicalNames.join('" and "')}" both generate the name "${generatedName}".`,
        details: { generatedName, physicalNames },
      });
    }
  }

  private generateSchemaFile(blocks: string): string {
    return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

${blocks}
`;
  }

  private generateEnum(enumDef: EnumDef): string {
    const name = this.getModelName(enumDef.name);
    const map =
      name !== enumDef.name
        ? `\n\n  @@map(${JSON.stringify(enumDef.name)})`
        : '';
    return `enum ${name} {
  ${enumDef.values.join('\n  ')}${map}
}`;
  }

  private generateModel(
    table: Table,
    schema: DatabaseSchema,
    diagnostics: Diagnostic[],
  ): string {
    const modelName = this.getModelName(table.name);

    /*
      Composite primary keys (junction tables, indexes { (a,b) [pk] })
      are expressed with @@id instead of per-field @id.
    */
    const pkColumns = table.columns.filter((col) => col.pk);
    const useCompositeId = pkColumns.length > 1;
    const namedPk = table.indexes?.find((index) => index.pk && index.name);

    // Generate fields (including FK columns)
    const fields = table.columns
      .map((col) =>
        this.generateField(
          col,
          schema,
          useCompositeId,
          table,
          diagnostics,
          !useCompositeId && namedPk?.columns.includes(col.name)
            ? namedPk.name
            : undefined,
        ),
      )
      .filter(Boolean)
      .join('\n  ');

    // Generate relations (entries keep field names for collision checks)
    const relationEntries = this.relationEntries(table, schema);
    const relations = relationEntries.map((entry) => entry.code).join('\n  ');

    this.validateModelProperties(
      table,
      relationEntries.map((entry) => entry.fieldName),
      diagnostics,
    );

    // Block-level attributes
    const blockAttrs: string[] = [];
    if (useCompositeId) {
      const mapArg = namedPk?.name
        ? `, map: ${JSON.stringify(namedPk.name)}`
        : '';
      blockAttrs.push(
        `@@id([${pkColumns.map((c) => c.name).join(', ')}]${mapArg})`,
      );
    }
    for (const index of table.indexes ?? []) {
      if (index.pk) continue;
      const kind = index.unique ? '@@unique' : '@@index';
      const mapArg = index.name ? `, map: ${JSON.stringify(index.name)}` : '';
      blockAttrs.push(`${kind}([${index.columns.join(', ')}]${mapArg})`);
    }
    if (modelName !== table.name) {
      blockAttrs.push(`@@map("${table.name}")`);
    }

    const sections = [fields, relations, blockAttrs.join('\n  ')]
      .filter(Boolean)
      .join('\n\n  ');

    const comment = table.note ? `/// ${table.note}\n` : '';

    return `${comment}model ${modelName} {
  ${sections}
}`;
  }

  /*
    Per-model property checks: duplicate field names (scalar vs scalar, or
    scalar vs generated relation field) and invalid identifiers.
  */
  private validateModelProperties(
    table: Table,
    relationFieldNames: string[],
    diagnostics: Diagnostic[],
  ): void {
    const seen = new Set<string>();

    for (const column of table.columns) {
      seen.add(column.name);

      if (!VALID_IDENTIFIER.test(column.name)) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.OUTPUT_INVALID_IDENTIFIER,
          severity: 'error',
          phase: 'output-validation',
          target: 'prisma',
          message: `Column "${table.name}.${column.name}" is not a valid Prisma field name.`,
          line: column.sourceLine,
          schemaPath: `tables.${table.name}.columns.${column.name}`,
        });
      }
    }

    for (const fieldName of relationFieldNames) {
      if (!seen.has(fieldName)) {
        seen.add(fieldName);
        continue;
      }

      diagnostics.push({
        code: DIAGNOSTIC_CODES.OUTPUT_PROPERTY_COLLISION,
        severity: 'error',
        phase: 'output-validation',
        target: 'prisma',
        message: `Generated relation field "${fieldName}" on model ${this.getModelName(
          table.name,
        )} conflicts with an existing field of the same name.`,
        line: table.sourceLine,
        schemaPath: `tables.${table.name}`,
        details: { fieldName },
      });
    }
  }

  private generateField(
    column: Column,
    schema: DatabaseSchema,
    useCompositeId: boolean,
    table: Table,
    diagnostics: Diagnostic[],
    idMap?: string,
  ): string {
    const enumDef = this.findEnum(column, schema);

    // Unknown types silently fall back to String — make that visible
    if (!enumDef && !typeFamily(parseDbType(column.type).base)) {
      diagnostics.push({
        code: DIAGNOSTIC_CODES.OUTPUT_UNKNOWN_TYPE_FALLBACK,
        severity: 'warning',
        phase: 'output-validation',
        target: 'prisma',
        message: `Type "${column.type}" of ${table.name}.${column.name} is not supported by the Prisma mapper and was mapped to String.`,
        line: column.sourceLine,
        schemaPath: `tables.${table.name}.columns.${column.name}`,
        details: { type: column.type, fallback: 'String' },
      });
    }

    const { type, nativeAttr } = enumDef
      ? { type: this.getModelName(enumDef.name), nativeAttr: undefined }
      : mapColumnTypeToPrisma(column.type);

    const optional = this.isOptionalColumn(column) ? '?' : '';
    const attributes = this.getFieldAttributes(column, {
      useCompositeId,
      isEnumField: !!enumDef,
      nativeAttr,
      idMap,
      suppressUnique: hasNamedSingleUniqueIndex(table, column.name),
    });

    const comment = column.note ? `/// ${column.note}\n  ` : '';

    return `${comment}${column.name} ${type}${optional}${attributes}`;
  }

  private findEnum(
    column: Column,
    schema: DatabaseSchema,
  ): EnumDef | undefined {
    return schema.enums?.find((e) => e.name === column.type);
  }

  /* DBML nullability is independent from whether a default value exists. */
  private isOptionalColumn(column: Column): boolean {
    return column.nullable === true && !column.pk;
  }

  private getFieldAttributes(
    column: Column,
    opts: {
      useCompositeId: boolean;
      isEnumField: boolean;
      nativeAttr?: string;
      idMap?: string;
      suppressUnique: boolean;
    },
  ): string {
    const attrs: string[] = [];
    const { base } = parseDbType(column.type);
    const isUuid = base === 'uuid' || base === 'uniqueidentifier';

    // Primary key (composite keys use @@id at the model level instead)
    if (column.pk && !opts.useCompositeId) {
      const idAttr = opts.idMap
        ? `@id(map: ${JSON.stringify(opts.idMap)})`
        : '@id';
      attrs.push(idAttr);
      if (column.increment) {
        attrs.push('@default(autoincrement())');
      } else if (isUuid && column.default === undefined) {
        attrs.push('@default(uuid())');
      }
    }

    // Unique (also required by Prisma on the scalar of a one-to-one FK)
    const isOneToOneRef =
      column.ref?.cardinality?.from === Cardinality.One &&
      column.ref?.cardinality?.to === Cardinality.One;
    if (
      (column.unique || isOneToOneRef) &&
      !column.pk &&
      !opts.suppressUnique
    ) {
      attrs.push('@unique');
    }

    // Default values
    if (column.default !== undefined && !column.increment) {
      const formatted = this.formatDefault(column, opts.isEnumField);
      if (formatted) attrs.push(formatted);
    }

    // Prisma convention: updated_at-style time columns get @updatedAt
    if (
      UPDATED_AT_FIELDS.includes(column.name.toLowerCase()) &&
      TIMESTAMP_DB_TYPES.includes(base)
    ) {
      attrs.push('@updatedAt');
    }

    // Database column name mapping (snake_case in DB)
    if (column.name.includes('_')) {
      attrs.push(`@map("${column.name}")`);
    }

    // Native type attribute (@db.Uuid, @db.Decimal(10, 2), ...)
    if (opts.nativeAttr) {
      attrs.push(opts.nativeAttr);
    }

    return attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  }

  private formatDefault(column: Column, isEnumField: boolean): string {
    const value = column.default;

    // DB expressions: `now()`, `gen_random_uuid()`, ...
    if (column.isExpression && typeof value === 'string') {
      const expr = value.trim();
      if (expr === 'now()') return '@default(now())';
      if (expr === 'uuid()') return '@default(uuid())';
      if (/^(gen_random_uuid|uuid_generate_v4)\s*\(\s*\)$/.test(expr)) {
        return `@default(dbgenerated("${expr}"))`;
      }
      return `@default(dbgenerated("${expr.replace(/"/g, '\\"')}"))`;
    }

    // Enum defaults are unquoted variant names
    if (isEnumField && typeof value === 'string') {
      return `@default(${value})`;
    }

    if (typeof value === 'string') {
      return `@default("${value}")`;
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return `@default(${value})`;
    }
    return '';
  }

  /*
  Generate relation fields for the model:
  Many-to-One and One-to-One owning sides (FK columns on this table) plus
  the inverse sides (FK columns on other tables, including self-references).
  Multiple FKs to the same table get named relations to disambiguate.
  Returns entries so callers can validate field names against the scalars.
  */
  private relationEntries(
    table: Table,
    schema: DatabaseSchema,
  ): { fieldName: string; code: string }[] {
    const relations: { fieldName: string; code: string }[] = [];

    const isManyToMany = (col: Column) =>
      col.ref?.cardinality?.from === Cardinality.Many &&
      col.ref?.cardinality?.to === Cardinality.Many;

    // Owning side: FK columns on this table
    const fkColumns = table.columns.filter(
      (col) => col.ref && !isManyToMany(col),
    );

    const fkCountByTarget = new Map<string, number>();
    for (const col of fkColumns) {
      const target = col.ref!.table;
      fkCountByTarget.set(target, (fkCountByTarget.get(target) ?? 0) + 1);
    }

    for (const column of fkColumns) {
      const ref = column.ref!;
      const relatedTable = schema.tables.find((t) => t.name === ref.table);
      if (!relatedTable) continue;

      const relatedModel = this.getModelName(relatedTable.name);

      /*
        Prisma needs named relations when the pair of models is linked more
        than once (two FKs to the same table) or on self-references.
      */
      const needsName =
        (fkCountByTarget.get(ref.table) ?? 0) > 1 ||
        relatedTable.name === table.name;

      const fieldName = needsName
        ? this.camelCase(stripIdSuffix(column.name))
        : this.camelCase(relatedTable.name);

      const args: string[] = [];
      if (needsName) {
        args.push(`"${this.relationLabel(table, column)}"`);
      }
      args.push(`fields: [${column.name}]`, `references: [${ref.column}]`);
      if (ref.onDelete)
        args.push(`onDelete: ${this.prismaAction(ref.onDelete)}`);
      if (ref.onUpdate)
        args.push(`onUpdate: ${this.prismaAction(ref.onUpdate)}`);

      const optional = this.isOptionalColumn(column) ? '?' : '';

      relations.push({
        fieldName,
        code: `${fieldName} ${relatedModel}${optional} @relation(${args.join(', ')})`,
      });
    }

    // Inverse side: FK columns on other tables pointing here (self included)
    for (const otherTable of schema.tables) {
      const foreignKeys = otherTable.columns.filter(
        (col) => col.ref?.table === table.name && !isManyToMany(col),
      );
      if (!foreignKeys.length) continue;

      const needsName =
        foreignKeys.length > 1 || otherTable.name === table.name;

      for (const fk of foreignKeys) {
        const relatedModel = this.getModelName(otherTable.name);
        const baseName = this.camelCase(otherTable.name);

        const fieldName = needsName
          ? `${baseName}${this.getModelName(stripIdSuffix(fk.name))}`
          : baseName;

        const nameAttr = needsName
          ? ` @relation("${this.relationLabel(otherTable, fk)}")`
          : '';

        const isOneToOne =
          fk.unique ||
          (fk.ref?.cardinality?.from === Cardinality.One &&
            fk.ref?.cardinality?.to === Cardinality.One);

        if (isOneToOne) {
          relations.push({
            fieldName,
            code: `${fieldName} ${relatedModel}?${nameAttr}`,
          });
        } else {
          relations.push({
            fieldName,
            code: `${fieldName} ${relatedModel}[]${nameAttr}`,
          });
        }
      }
    }

    return relations;
  }

  /* Shared label so both sides of a named relation match */
  private relationLabel(owningTable: Table, fkColumn: Column): string {
    return `${this.getModelName(owningTable.name)}_${fkColumn.name}`;
  }

  private prismaAction(action: ReferentialAction): string {
    switch (action) {
      case 'CASCADE':
        return 'Cascade';
      case 'SET NULL':
        return 'SetNull';
      case 'RESTRICT':
        return 'Restrict';
      default:
        return 'NoAction';
    }
  }

  /*
  Convert snake_case table names to PascalCase for model names
  */
  private getModelName(tableName: string): string {
    return toPascalCase(tableName);
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
          : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
      )
      .join('');
  }
}
