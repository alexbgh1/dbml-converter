import { Injectable } from '@angular/core';

import { mapDbTypeToTypeOrmType } from '../mappers/typeorm.mapper';
import { mapDbTypeToTsType } from '../mappers/ts.mapper';
import {
  hasNamedSingleUniqueIndex,
  stripIdSuffix,
  toPascalCase,
} from '../helpers';

import {
  AUDIT_TIMESTAMP_FIELDS,
  CREATED_AT_FIELDS,
  DELETED_AT_FIELDS,
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
} from '../../dbml-parser/interfaces/dbml-parser.interface';
import { GeneratedCode } from './interfaces/nestjs-generator.interface';

/* A pure junction table linking one entity to another, seen from that entity. */
interface JunctionLink {
  junction: Table;
  otherTable: string;
  isOwner: boolean;
  /** Junction column referencing the @JoinTable owner. */
  ownerFk: Column;
  /** Junction column referencing the other side. */
  inverseFk: Column;
}

@Injectable({ providedIn: 'root' })
export class NestjsGeneratorService {
  /*
    Based on schema (tables, relations),
    generate NestJS code with TypeORM entities and a module that imports them all.
  */
  generateCode(schema: DatabaseSchema): GeneratedCode {
    const diagnostics: Diagnostic[] = [];

    const entities = this.generateEntities(schema);
    this.validateOutput(schema, diagnostics);

    return {
      entities,
      module: this.generateModule(schema),
      diagnostics,
    };
  }

  /*
    Generate entities for each table in the schema.
    Pure junction tables (only FK columns) are modeled with @ManyToMany
    on both sides instead of a dedicated entity.
  */
  private generateEntities(schema: DatabaseSchema): Record<string, string> {
    if (!schema?.tables?.length) return {};

    const entities: Record<string, string> = {};

    if (schema.enums?.some((e) => e.values.length > 0)) {
      entities['enums.ts'] = this.generateEnumsFile(schema.enums);
    }

    for (const table of schema.tables) {
      if (this.isPureJunction(table)) continue;

      const fileName = this.getEntityFileName(table.name);
      entities[fileName] = this.generateEntityClass(table, schema);
    }

    return entities;
  }

  private generateEnumsFile(enums: EnumDef[]): string {
    return (
      enums
        .filter((e) => e.values.length > 0)
        .map((e) => {
          const name = this.getClassName(e.name);
          const members = e.values
            .map((v) => `  ${v} = '${this.escapeTsString(v)}',`)
            .join('\n');
          return `export enum ${name} {\n${members}\n}`;
        })
        .join('\n\n') + '\n'
    );
  }

  /*
    Output-validation (phase 3): naming and property problems that make the
    generated TypeScript invalid. Colliding declarations are still emitted
    (best-effort preview); the diagnostics mark the output as not valid.
  */
  private validateOutput(
    schema: DatabaseSchema,
    diagnostics: Diagnostic[],
  ): void {
    const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const TYPEORM_DECORATORS = [
      'Entity',
      'Column',
      'PrimaryColumn',
      'PrimaryGeneratedColumn',
      'OneToOne',
      'OneToMany',
      'ManyToOne',
      'ManyToMany',
      'JoinColumn',
      'JoinTable',
      'Index',
      'CreateDateColumn',
      'UpdateDateColumn',
      'DeleteDateColumn',
    ];

    const entityTables = schema.tables.filter((t) => !this.isPureJunction(t));

    // Class names share a namespace with the enums imported from enums.ts
    const byClassName = new Map<string, string[]>();
    for (const enumDef of schema.enums ?? []) {
      const name = this.getClassName(enumDef.name);
      byClassName.set(name, [...(byClassName.get(name) ?? []), enumDef.name]);

      if (!VALID_IDENTIFIER.test(name)) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.OUTPUT_INVALID_IDENTIFIER,
          severity: 'error',
          phase: 'output-validation',
          target: 'typeorm',
          message: `Enum "${enumDef.name}" generates "${name}", which is not a valid TypeScript enum name.`,
          line: enumDef.sourceLine,
          schemaPath: `enums.${enumDef.name}`,
        });
      }

      const enumIsImported = entityTables.some((table) =>
        table.columns.some((column) => column.type === enumDef.name),
      );
      if (enumIsImported && TYPEORM_DECORATORS.includes(name)) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.TYPEORM_IMPORT_NAME_COLLISION,
          severity: 'error',
          phase: 'output-validation',
          target: 'typeorm',
          message: `Enum "${enumDef.name}" generates import "${name}", which conflicts with the TypeORM "${name}" import.`,
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
          target: 'typeorm',
          message: `Value "${value}" of enum "${enumDef.name}" is not a valid TypeScript enum member.`,
          line: enumDef.valueSourceLines?.[index] ?? enumDef.sourceLine,
          schemaPath: `enums.${enumDef.name}.values.${value}`,
        });
      });
    }

    for (const table of entityTables) {
      const className = this.getClassName(table.name);
      byClassName.set(className, [
        ...(byClassName.get(className) ?? []),
        table.name,
      ]);

      if (TYPEORM_DECORATORS.includes(className)) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.TYPEORM_IMPORT_NAME_COLLISION,
          severity: 'error',
          phase: 'output-validation',
          target: 'typeorm',
          message: `Table "${table.name}" generates class "${className}", which conflicts with the TypeORM "${className}" import in the same file.`,
          line: table.sourceLine,
          schemaPath: `tables.${table.name}`,
        });
      }

      if (!VALID_IDENTIFIER.test(className)) {
        diagnostics.push({
          code: DIAGNOSTIC_CODES.OUTPUT_INVALID_IDENTIFIER,
          severity: 'error',
          phase: 'output-validation',
          target: 'typeorm',
          message: `Table "${table.name}" generates "${className}", which is not a valid TypeScript class name.`,
          line: table.sourceLine,
          schemaPath: `tables.${table.name}`,
        });
      }

      this.validateEntityProperties(
        table,
        schema,
        VALID_IDENTIFIER,
        diagnostics,
      );
      this.validateColumnTypes(table, schema, diagnostics);
    }

    for (const [className, physicalNames] of byClassName) {
      if (physicalNames.length < 2) continue;

      if (new Set(physicalNames).size < 2) {
        /*
          Identical physical names collapse to one entity FILE, silently
          overwriting the other (SCHEMA_DUPLICATE_TABLE covers the cause,
          this covers the file-level consequence).
        */
        diagnostics.push({
          code: DIAGNOSTIC_CODES.OUTPUT_NAME_COLLISION,
          severity: 'error',
          phase: 'output-validation',
          target: 'typeorm',
          message: `Duplicate table "${physicalNames[0]}" generates the same entity file more than once; only the last one is kept.`,
          details: { className, physicalNames },
        });
        continue;
      }

      diagnostics.push({
        code: DIAGNOSTIC_CODES.OUTPUT_NAME_COLLISION,
        severity: 'error',
        phase: 'output-validation',
        target: 'typeorm',
        message: `"${physicalNames.join('" and "')}" both generate the class name "${className}".`,
        details: { className, physicalNames },
      });
    }
  }

  /* Mirrors the property naming used during generation to detect duplicates */
  private validateEntityProperties(
    table: Table,
    schema: DatabaseSchema,
    validIdentifier: RegExp,
    diagnostics: Diagnostic[],
  ): void {
    const names: { name: string; line?: number }[] = [];

    for (const column of table.columns) {
      if (column.ref && !this.isManyToManyRef(column)) {
        const relatedTable = schema.tables.find(
          (t) => t.name === column.ref?.table,
        );
        if (!relatedTable) continue; // rendered as nothing (missing FK target)

        /*
          FK primary keys render both the original scalar column and a separate
          relation property. Validate both names exactly as they are emitted.
        */
        if (column.pk) {
          names.push({ name: column.name, line: column.sourceLine });

          if (!validIdentifier.test(column.name)) {
            diagnostics.push({
              code: DIAGNOSTIC_CODES.OUTPUT_INVALID_IDENTIFIER,
              severity: 'error',
              phase: 'output-validation',
              target: 'typeorm',
              message: `Column "${table.name}.${column.name}" is not a valid TypeScript property name.`,
              line: column.sourceLine,
              schemaPath: `tables.${table.name}.columns.${column.name}`,
            });
          }
        }

        const preferredRelationProperty = this.preferredFkPropertyName(
          column,
          table,
        );
        const relationProperty = this.fkPropertyName(column, table);

        if (relationProperty !== preferredRelationProperty) {
          diagnostics.push({
            code: DIAGNOSTIC_CODES.OUTPUT_PROPERTY_COLLISION,
            severity: 'error',
            phase: 'output-validation',
            target: 'typeorm',
            message: `Relation for "${table.name}.${column.name}" would collide with generated property "${preferredRelationProperty}" and was generated as "${relationProperty}".`,
            line: column.sourceLine,
            schemaPath: `tables.${table.name}.columns.${column.name}`,
            details: {
              propertyName: preferredRelationProperty,
              generatedPropertyName: relationProperty,
            },
          });
        }

        names.push({
          name: relationProperty,
          line: column.sourceLine,
        });

        if (!validIdentifier.test(relationProperty)) {
          diagnostics.push({
            code: DIAGNOSTIC_CODES.OUTPUT_INVALID_IDENTIFIER,
            severity: 'error',
            phase: 'output-validation',
            target: 'typeorm',
            message: `Relation for "${table.name}.${column.name}" generates "${relationProperty}", which is not a valid TypeScript property name.`,
            line: column.sourceLine,
            schemaPath: `tables.${table.name}.columns.${column.name}`,
          });
        }
      } else {
        names.push({ name: column.name, line: column.sourceLine });

        if (!validIdentifier.test(column.name)) {
          diagnostics.push({
            code: DIAGNOSTIC_CODES.OUTPUT_INVALID_IDENTIFIER,
            severity: 'error',
            phase: 'output-validation',
            target: 'typeorm',
            message: `Column "${table.name}.${column.name}" is not a valid TypeScript property name.`,
            line: column.sourceLine,
            schemaPath: `tables.${table.name}.columns.${column.name}`,
          });
        }
      }
    }

    for (const otherTable of schema.tables) {
      if (this.isPureJunction(otherTable)) continue;
      const foreignKeys = otherTable.columns.filter(
        (col) => col.ref?.table === table.name && !this.isManyToManyRef(col),
      );
      for (const fk of foreignKeys) {
        names.push({
          name: this.isOneToOneRef(fk)
            ? this.getCamelCase(this.getClassName(otherTable.name))
            : this.inverseListPropertyName(otherTable, fk),
        });
      }
    }

    for (const { otherTable } of this.junctionsFor(table, schema)) {
      names.push({
        name: this.getPluralCamelCase(this.getClassName(otherTable)),
      });
    }

    const seen = new Set<string>();
    for (const { name, line } of names) {
      if (!seen.has(name)) {
        seen.add(name);
        continue;
      }

      diagnostics.push({
        code: DIAGNOSTIC_CODES.OUTPUT_PROPERTY_COLLISION,
        severity: 'error',
        phase: 'output-validation',
        target: 'typeorm',
        message: `Entity ${this.getClassName(
          table.name,
        )} would declare the property "${name}" more than once.`,
        line: line ?? table.sourceLine,
        schemaPath: `tables.${table.name}`,
        details: { propertyName: name },
      });
    }
  }

  /* Scalar columns with unknown types silently fall back to varchar */
  private validateColumnTypes(
    table: Table,
    schema: DatabaseSchema,
    diagnostics: Diagnostic[],
  ): void {
    for (const column of table.columns) {
      // Non-primary FK columns render only as relation properties.
      if (column.ref && !this.isManyToManyRef(column) && !column.pk) continue;
      // Enum-typed columns are mapped to their enum, not a scalar fallback
      if (this.findEnum(column, schema)) continue;

      const { base } = parseDbType(column.type);
      if (typeFamily(base)) continue;

      diagnostics.push({
        code: DIAGNOSTIC_CODES.OUTPUT_UNKNOWN_TYPE_FALLBACK,
        severity: 'warning',
        phase: 'output-validation',
        target: 'typeorm',
        message: `Type "${column.type}" of ${table.name}.${column.name} is not supported by the TypeORM mapper and was mapped to varchar.`,
        line: column.sourceLine,
        schemaPath: `tables.${table.name}.columns.${column.name}`,
        details: { type: column.type, fallback: 'varchar' },
      });
    }
  }

  /*
    A pure junction table has only FK columns: it exists in the database,
    but at the ORM level it's expressed as @ManyToMany + @JoinTable.
    Junction tables with payload columns keep their own entity.
  */
  private isPureJunction(table: Table): boolean {
    return (
      !!table.isJunction &&
      table.columns.length > 0 &&
      table.columns.every((col) => !!col.ref)
    );
  }

  /*
    Generate a NestJS module importing all entities.
  */
  private generateModule(schema: DatabaseSchema): string {
    if (!schema?.tables?.length) return '';

    const entityTables = schema.tables.filter((t) => !this.isPureJunction(t));

    const entityImports = entityTables
      .map((table) => {
        const className = this.getClassName(table.name);
        const fileName = this.getEntityFileName(table.name).replace('.ts', '');
        return `import { ${className} } from './${fileName}';`;
      })
      .join('\n');

    const entityList = entityTables
      .map((table) => this.getClassName(table.name))
      .join(', ');

    return `import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
${entityImports}

@Module({
  imports: [TypeOrmModule.forFeature([${entityList}])],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
`;
  }

  /*
    Generate entity class from table.
  */
  private generateEntityClass(table: Table, schema: DatabaseSchema): string {
    const className = this.getClassName(table.name);
    const typeOrmImports = this.getTypeOrmImports(table, schema);
    const imports = [
      `import { Entity${typeOrmImports ? `, ${typeOrmImports}` : ''} } from 'typeorm';`,
    ];

    const relationImports = this.getRelationImports(table, schema);
    imports.push(...relationImports);

    const enumImport = this.getEnumImport(table, schema);
    if (enumImport) imports.push(enumImport);

    const columns = table.columns
      .map((column) => this.generateColumn(column, table, schema))
      .filter(Boolean)
      .join('\n\n  ');

    const oneToManyRelations = this.generateOneToManyRelations(table, schema);
    const manyToManyRelations = this.generateManyToManyRelations(table, schema);
    const allProperties = [columns, oneToManyRelations, manyToManyRelations]
      .filter(Boolean)
      .join('\n\n  ');

    // Class-level decorators: @Entity + composite indexes
    const classDecorators = [`@Entity('${table.name}')`];
    for (const index of table.indexes ?? []) {
      if (index.pk) continue;
      const columnList = index.columns.map((c) => `'${c}'`).join(', ');
      const opts = index.unique ? ', { unique: true }' : '';
      const name = index.name ? `${JSON.stringify(index.name)}, ` : '';
      classDecorators.push(`@Index(${name}[${columnList}]${opts})`);
    }

    const comment = table.note ? `/** ${table.note} */\n` : '';

    return `${imports.join('\n')}

${comment}${classDecorators.join('\n')}
export class ${className} {
  ${allProperties}
}
`;
  }

  /*
    Generate column definition with decorators and options.
  */
  private generateColumn(
    column: Column,
    table: Table,
    schema: DatabaseSchema,
  ): string {
    const comment = column.note ? `/** ${column.note} */\n  ` : '';
    const decorators: string[] = [];

    // FK columns of a pure junction table never reach here (entity is skipped);
    // M2M refs on regular tables are rendered as their scalar column below.

    // Handle foreign key relationships (skip many-to-many, handled separately)
    if (column.ref && !this.isManyToManyRef(column)) {
      const relatedTable = schema.tables.find(
        (t) => t.name === column.ref?.table,
      );
      if (!relatedTable) return ''; // FK not found

      const relatedClassName = this.getClassName(relatedTable.name);
      const relationProperty = this.fkPropertyName(column, table);

      // Relationship options (nullable, onDelete, onUpdate)
      const opts: string[] = [];
      if (column.nullable === false || column.pk) opts.push('nullable: false');
      if (column.ref.onDelete) opts.push(`onDelete: '${column.ref.onDelete}'`);
      if (column.ref.onUpdate) opts.push(`onUpdate: '${column.ref.onUpdate}'`);
      const relationOptions = opts.length ? `, { ${opts.join(', ')} }` : '';

      const relatedRef = this.getCamelCase(relatedClassName);
      const referencedColumn = column.pk
        ? `, referencedColumnName: '${column.ref.column}'`
        : '';
      const joinColumn = `@JoinColumn({ name: '${column.name}'${referencedColumn} })`;

      if (this.isOneToOneRef(column)) {
        const inverseProperty = this.getCamelCase(
          this.getClassName(table.name),
        );
        decorators.push(
          `@OneToOne(() => ${relatedClassName}, ${relatedRef} => ${relatedRef}.${inverseProperty}${relationOptions})`,
          joinColumn,
        );
      } else {
        const inverseProperty = this.inverseListPropertyName(table, column);
        decorators.push(
          `@ManyToOne(() => ${relatedClassName}, ${relatedRef} => ${relatedRef}.${inverseProperty}${relationOptions})`,
          joinColumn,
        );
      }

      const relationOutput = `${decorators.join(
        '\n  ',
      )}\n  ${this.renderProperty(
        relationProperty,
        relatedClassName,
        column.nullable === true,
      )}`;

      if (!column.pk) {
        return `${comment}${relationOutput}`;
      }

      /*
        A FK that is also a primary key needs two entity properties:
        the scalar ID used by repositories and a separately typed relation.
        Both decorators map to the same physical column.
      */
      const scalarOutput = `${comment}${this.generateForeignKeyPrimaryColumnDecorator(
        column,
        table,
      )}\n  ${this.renderProperty(
        column.name,
        mapDbTypeToTsType(column.type),
      )}`;

      return `${scalarOutput}\n\n  ${relationOutput}`;
    }

    // Handle primary keys
    if (column.pk) {
      const { base } = parseDbType(column.type);
      const pkName = this.primaryKeyConstraintName(table, column.name);
      const generatedOptions = pkName
        ? `, { primaryKeyConstraintName: ${JSON.stringify(pkName)} }`
        : '';
      if (column.increment) {
        decorators.push(
          `@PrimaryGeneratedColumn('increment'${generatedOptions})`,
        );
      } else if (base === 'uuid' && column.default === undefined) {
        decorators.push(`@PrimaryGeneratedColumn('uuid'${generatedOptions})`);
      } else if (base === 'uuid') {
        const options = pkName
          ? `, { primaryKeyConstraintName: ${JSON.stringify(pkName)} }`
          : '';
        decorators.push(`@PrimaryColumn('uuid'${options})`);
      } else {
        const options = this.primaryColumnTypeOptions(column);
        if (pkName) {
          options.push(
            `primaryKeyConstraintName: ${JSON.stringify(pkName)}`,
          );
        }
        decorators.push(`@PrimaryColumn({ ${options.join(', ')} })`);
      }

      return `${comment}${decorators.join('\n  ')}\n  ${this.renderProperty(
        column.name,
        mapDbTypeToTsType(column.type),
      )}`;
    }

    // Handle special timestamp columns (created_at, updated_at)
    if (this.isTimestampColumn(column)) {
      return this.generateTimestampColumn(column, comment);
    }

    // Enum-typed columns
    const enumDef = this.findEnum(column, schema);
    if (enumDef) {
      const enumName = this.getClassName(enumDef.name);
      const enumOptions = [`type: 'enum'`, `enum: ${enumName}`];
      if (column.nullable === true) enumOptions.push('nullable: true');
      if (typeof column.default === 'string' && !column.isExpression) {
        enumOptions.push(`default: ${enumName}.${column.default}`);
      }
      return `${comment}@Column({ ${enumOptions.join(
        ', ',
      )} })\n  ${this.renderProperty(
        column.name,
        enumName,
        column.nullable === true,
      )}`;
    }

    // Normal columns
    const { args } = parseDbType(column.type);
    const typeormType = mapDbTypeToTypeOrmType(column.type);
    const columnOptions: string[] = [`type: '${typeormType}'`];

    // Preserve type args: varchar(255) -> length, decimal(10,2) -> precision/scale
    if (typeormType === 'varchar' && args.length === 1) {
      columnOptions.push(`length: ${args[0]}`);
    }
    if (typeormType === 'decimal' && args.length === 2) {
      columnOptions.push(`precision: ${args[0]}`, `scale: ${args[1]}`);
    }

    // DBML columns are nullable unless [not null] (TypeORM defaults to NOT NULL)
    if (column.nullable === true) columnOptions.push('nullable: true');
    if (column.unique && !hasNamedSingleUniqueIndex(table, column.name)) {
      columnOptions.push('unique: true');
    }
    if (column.default !== undefined) {
      if (column.isExpression) {
        columnOptions.push(`default: () => '${column.default}'`);
      } else {
        columnOptions.push(`default: ${JSON.stringify(column.default)}`);
      }
    }

    decorators.push(`@Column({ ${columnOptions.join(', ')} })`);

    return `${comment}${decorators.join('\n  ')}\n  ${this.renderProperty(
      column.name,
      mapDbTypeToTsType(column.type),
      column.nullable === true,
    )}`;
  }

  private isManyToManyRef(column: Column): boolean {
    return (
      column.ref?.cardinality?.from === Cardinality.Many &&
      column.ref?.cardinality?.to === Cardinality.Many
    );
  }

  private isOneToOneRef(column: Column): boolean {
    return (
      column.unique === true ||
      (column.ref?.cardinality?.from === Cardinality.One &&
        column.ref.cardinality.to === Cardinality.One)
    );
  }

  private generateForeignKeyPrimaryColumnDecorator(
    column: Column,
    table: Table,
  ): string {
    const options = this.primaryColumnTypeOptions(column, column.name);

    const constraintName = this.primaryKeyConstraintName(table, column.name);
    if (constraintName) {
      options.push(
        `primaryKeyConstraintName: ${JSON.stringify(constraintName)}`,
      );
    }

    return `@PrimaryColumn({ ${options.join(', ')} })`;
  }

  /*
    Explicit type options for @PrimaryColumn. Without them TypeORM infers the
    column type from the TS property type, which loses varchar lengths,
    decimal precision and int width (varchar(10) -> varchar, bigint -> int).
  */
  private primaryColumnTypeOptions(
    column: Column,
    physicalName?: string,
  ): string[] {
    const typeormType = mapDbTypeToTypeOrmType(column.type);
    const { args } = parseDbType(column.type);
    const options = [`type: '${typeormType}'`];

    if (physicalName) options.push(`name: '${physicalName}'`);

    if (typeormType === 'varchar' && args.length === 1) {
      options.push(`length: ${args[0]}`);
    }
    if (typeormType === 'decimal' && args.length === 2) {
      options.push(`precision: ${args[0]}`, `scale: ${args[1]}`);
    }

    return options;
  }

  private primaryKeyConstraintName(
    table: Table,
    columnName: string,
  ): string | undefined {
    return table.indexes?.find(
      (index) => index.pk && index.name && index.columns.includes(columnName),
    )?.name;
  }

  private findEnum(
    column: Column,
    schema: DatabaseSchema,
  ): EnumDef | undefined {
    return schema.enums?.find((e) => e.name === column.type);
  }

  private escapeTsString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private getEnumImport(table: Table, schema: DatabaseSchema): string | null {
    const used = table.columns
      .map((c) => this.findEnum(c, schema))
      .filter((e): e is EnumDef => !!e)
      .map((e) => this.getClassName(e.name));

    if (!used.length) return null;
    return `import { ${Array.from(new Set(used)).join(', ')} } from './enums';`;
  }

  /*
    Relation property name for a FK column. When a table has several FKs to
    the same target (or a self-reference), derive the name from the FK column
    (sender_id -> sender) to avoid duplicate properties.
  */
  private preferredFkPropertyName(fk: Column, ownerTable: Table): string {
    const target = fk.ref!.table;
    const targetCount = ownerTable.columns.filter(
      (c) => c.ref?.table === target && !this.isManyToManyRef(c),
    ).length;

    if (targetCount > 1 || target === ownerTable.name) {
      return this.getCamelCase(this.getClassName(stripIdSuffix(fk.name)));
    }
    return this.getCamelCase(this.getClassName(target));
  }

  /*
    FK primary keys also emit their scalar DBML column. If the preferred
    relation name is already a scalar property, keep both declarations valid
    with a deterministic relation suffix; validation still reports the input
    collision so it is not hidden from the user.
  */
  private fkPropertyName(fk: Column, ownerTable: Table): string {
    const reserved = new Set(
      ownerTable.columns
        .filter(
          (column) =>
            !column.ref || this.isManyToManyRef(column) || column.pk === true,
        )
        .map((column) => column.name),
    );

    for (const column of ownerTable.columns) {
      if (!column.ref || this.isManyToManyRef(column)) continue;

      const preferred = this.preferredFkPropertyName(column, ownerTable);
      let candidate = preferred;
      if (reserved.has(candidate)) {
        const fallback = `${preferred}Relation`;
        candidate = fallback;
        let suffix = 2;
        while (reserved.has(candidate)) {
          candidate = `${fallback}${suffix}`;
          suffix += 1;
        }
      }

      reserved.add(candidate);
      if (column === fk) return candidate;
    }

    return this.preferredFkPropertyName(fk, ownerTable);
  }

  /*
    Inverse (OneToMany list) property name on the referenced entity,
    disambiguated the same way as fkPropertyName so both sides agree.
  */
  private preferredInverseListPropertyName(
    ownerTable: Table,
    fk: Column,
  ): string {
    const target = fk.ref!.table;
    const targetCount = ownerTable.columns.filter(
      (c) => c.ref?.table === target && !this.isManyToManyRef(c),
    ).length;

    const base = this.getPluralCamelCase(this.getClassName(ownerTable.name));
    if (targetCount > 1 || target === ownerTable.name) {
      return `${base}${this.getClassName(stripIdSuffix(fk.name))}`;
    }
    return base;
  }

  private inverseListPropertyName(ownerTable: Table, fk: Column): string {
    const used = new Set<string>();

    for (const column of ownerTable.columns) {
      if (
        column.ref?.table !== fk.ref?.table ||
        this.isManyToManyRef(column)
      ) {
        continue;
      }

      const preferred = this.preferredInverseListPropertyName(
        ownerTable,
        column,
      );
      let candidate = preferred;
      let suffix = 2;
      while (used.has(candidate)) {
        candidate = `${preferred}${suffix}`;
        suffix += 1;
      }

      used.add(candidate);
      if (column === fk) return candidate;
    }

    return this.preferredInverseListPropertyName(ownerTable, fk);
  }

  /*
    Collect TypeORM imports required for this table.
  */
  private getTypeOrmImports(table: Table, schema: DatabaseSchema): string {
    const imports = new Set<string>();
    const usesColumnDecorator = table.columns.some(
      (column) =>
        !column.pk &&
        !(column.ref && !this.isManyToManyRef(column)) &&
        !this.isTimestampColumn(column),
    );
    if (usesColumnDecorator) imports.add('Column');

    for (const column of table.columns) {
      const isRelation = column.ref && !this.isManyToManyRef(column);

      if (column.pk) {
        const { base } = parseDbType(column.type);
        if (isRelation) {
          // FK primary keys are scalar IDs, never generated relation objects.
          imports.add('PrimaryColumn');
        } else if (
          column.increment ||
          (base === 'uuid' && column.default === undefined)
        ) {
          imports.add('PrimaryGeneratedColumn');
        } else {
          imports.add('PrimaryColumn');
        }
      }

      if (isRelation) {
        if (this.isOneToOneRef(column)) {
          imports.add('OneToOne');
        } else {
          imports.add('ManyToOne');
        }
        imports.add('JoinColumn');
        continue;
      }

      // Primary columns return before regular/timestamp rendering.
      if (column.pk) continue;

      if (this.isTimestampColumn(column)) {
        const columnName = column.name.toLowerCase();
        if (CREATED_AT_FIELDS.includes(columnName))
          imports.add('CreateDateColumn');
        if (UPDATED_AT_FIELDS.includes(columnName))
          imports.add('UpdateDateColumn');
        if (DELETED_AT_FIELDS.includes(columnName))
          imports.add('DeleteDateColumn');
        continue;
      }
    }

    // Check if this table has reverse relations (OneToMany or OneToOne)
    const reverseRelations = schema.tables.flatMap((t) =>
      this.isPureJunction(t)
        ? []
        : t.columns.filter(
            (col) =>
              col.ref?.table === table.name && !this.isManyToManyRef(col),
          ),
    );

    const hasOneToMany = reverseRelations.some(
      (column) => !this.isOneToOneRef(column),
    );
    const hasOneToOne = reverseRelations.some((column) =>
      this.isOneToOneRef(column),
    );

    if (hasOneToMany) {
      imports.add('OneToMany');
    }
    if (hasOneToOne) {
      imports.add('OneToOne');
    }

    // Many-to-many via pure junction tables
    const junctions = this.junctionsFor(table, schema);
    if (junctions.length) {
      imports.add('ManyToMany');
      if (junctions.some((j) => j.isOwner)) imports.add('JoinTable');
    }

    // Composite indexes
    if (table.indexes?.some((index) => !index.pk)) {
      imports.add('Index');
    }

    return Array.from(imports).join(', ');
  }

  /*
    Pure junction tables linking this table to another:
    the side referenced by the junction's FIRST FK owns the @JoinTable.
    `ownerFk`/`inverseFk` always describe that same orientation, so the owner
    can name the physical join columns instead of leaving them to convention.
  */
  private junctionsFor(table: Table, schema: DatabaseSchema): JunctionLink[] {
    const result: JunctionLink[] = [];

    for (const junction of schema.tables) {
      if (!this.isPureJunction(junction)) continue;

      const fks = junction.columns.filter((c) => c.ref);
      if (fks.length !== 2) continue;

      const [first, second] = fks;
      if (first.ref!.table === table.name) {
        result.push({
          junction,
          otherTable: second.ref!.table,
          isOwner: true,
          ownerFk: first,
          inverseFk: second,
        });
      } else if (second.ref!.table === table.name) {
        result.push({
          junction,
          otherTable: first.ref!.table,
          isOwner: false,
          ownerFk: first,
          inverseFk: second,
        });
      }
    }

    return result;
  }

  /*
    Collect imports for related entities to avoid circular issues.
  */
  private getRelationImports(table: Table, schema: DatabaseSchema): string[] {
    const imports = new Set<string>();

    const addImport = (tableName: string) => {
      if (tableName === table.name) return; // self-references need no import
      const className = this.getClassName(tableName);
      const fileName = this.getEntityFileName(tableName).replace('.ts', '');
      imports.add(`import { ${className} } from './${fileName}';`);
    };

    // Foreign keys
    for (const column of table.columns) {
      if (column.ref && !this.isManyToManyRef(column)) {
        const relatedTable = schema.tables.find(
          (t) => t.name === column.ref?.table,
        );
        if (relatedTable) addImport(relatedTable.name);
      }
    }

    // Reverse relations
    for (const otherTable of schema.tables) {
      if (otherTable.name === table.name) continue;
      if (this.isPureJunction(otherTable)) continue;

      const foreignKeys = otherTable.columns.filter(
        (col) => col.ref?.table === table.name && !this.isManyToManyRef(col),
      );

      if (foreignKeys.length > 0) addImport(otherTable.name);
    }

    // Many-to-many partners
    for (const { otherTable } of this.junctionsFor(table, schema)) {
      addImport(otherTable);
    }

    return Array.from(imports);
  }

  /*
    Generate OneToMany (and reverse OneToOne) relations for this table,
    including self-references.
  */
  private generateOneToManyRelations(
    table: Table,
    schema: DatabaseSchema,
  ): string {
    const relations: string[] = [];

    // Find all tables that reference this table
    for (const otherTable of schema.tables) {
      if (this.isPureJunction(otherTable)) continue;

      const foreignKeys = otherTable.columns.filter(
        (col) => col.ref?.table === table.name && !this.isManyToManyRef(col),
      );

      for (const fk of foreignKeys) {
        const relatedClassName = this.getClassName(otherTable.name);
        const relatedRef = this.getCamelCase(relatedClassName);

        if (this.isOneToOneRef(fk)) {
          // OneToOne reverse side (without @JoinColumn)
          const inverseProperty = this.fkPropertyName(fk, otherTable);
          const relationProperty = this.getCamelCase(relatedClassName);
          relations.push(
            `@OneToOne(() => ${relatedClassName}, ${relatedRef} => ${relatedRef}.${inverseProperty})\n  ${this.renderProperty(
              relationProperty,
              relatedClassName,
              fk.nullable === true,
            )}`,
          );
        } else {
          // OneToMany reverse side; property names mirror the owning side
          const relationProperty = this.inverseListPropertyName(otherTable, fk);
          const owningProperty = this.fkPropertyName(fk, otherTable);
          relations.push(
            `@OneToMany(() => ${relatedClassName}, ${relatedRef} => ${relatedRef}.${owningProperty})\n  ${this.renderProperty(
              relationProperty,
              `${relatedClassName}[]`,
            )}`,
          );
        }
      }
    }

    return relations.join('\n\n  ');
  }

  /*
    Generate @ManyToMany relations for pure junction tables.
    The table referenced by the junction's first FK carries the @JoinTable.
  */
  private generateManyToManyRelations(
    table: Table,
    schema: DatabaseSchema,
  ): string {
    const relations: string[] = [];

    for (const {
      junction,
      otherTable,
      isOwner,
      ownerFk,
      inverseFk,
    } of this.junctionsFor(table, schema)) {
      const otherClassName = this.getClassName(otherTable);
      const otherRef = this.getCamelCase(otherClassName);
      const property = this.getPluralCamelCase(otherClassName);
      const inverseProperty = this.getPluralCamelCase(
        this.getClassName(table.name),
      );

      const decorators = [
        `@ManyToMany(() => ${otherClassName}, ${otherRef} => ${otherRef}.${inverseProperty})`,
      ];
      if (isOwner) {
        decorators.push(this.renderJoinTable(junction, ownerFk, inverseFk));
      }

      relations.push(
        `${decorators.join('\n  ')}\n  ${this.renderProperty(
          property,
          `${otherClassName}[]`,
        )}`,
      );
    }

    return relations.join('\n\n  ');
  }

  /*
    Name the physical join columns explicitly. Without them TypeORM derives the
    names from entity/property conventions, which silently misses junctions whose
    columns don't follow that convention (account_uuid, permission_uuid, ...).
    The first line is indented by the decorator join; the rest carry their own.
  */
  private renderJoinTable(
    junction: Table,
    ownerFk: Column,
    inverseFk: Column,
  ): string {
    const joinColumn = `{ name: '${ownerFk.name}', referencedColumnName: '${ownerFk.ref!.column}' }`;
    const inverseJoinColumn = `{ name: '${inverseFk.name}', referencedColumnName: '${inverseFk.ref!.column}' }`;

    return [
      '@JoinTable({',
      `    name: '${junction.name}',`,
      `    joinColumn: ${joinColumn},`,
      `    inverseJoinColumn: ${inverseJoinColumn},`,
      '  })',
    ].join('\n');
  }

  /*
  Check if column is a special timestamp column (created_at, updated_at)
  */
  private isTimestampColumn(column: Column): boolean {
    const { base } = parseDbType(column.type);
    const isTimestampType = TIMESTAMP_DB_TYPES.includes(base);
    const isSpecialName = AUDIT_TIMESTAMP_FIELDS.has(column.name.toLowerCase());
    return isTimestampType && isSpecialName;
  }

  /*
  Generate special timestamp column decorators,
  e.g., @CreateDateColumn for created_at, using TypeORM to handle automatic timestamps.
  */
  private generateTimestampColumn(column: Column, comment: string): string {
    const columnName = column.name.toLowerCase();
    const tsType = mapDbTypeToTsType(column.type);
    const isNullable = column.nullable === true;

    const property = this.renderProperty(column.name, tsType, isNullable);
    const nullableOption = isNullable ? ', nullable: true' : '';

    if (CREATED_AT_FIELDS.includes(columnName)) {
      return `${comment}@CreateDateColumn({ type: 'timestamptz'${nullableOption}, default: () => 'CURRENT_TIMESTAMP' })\n  ${property}`;
    }

    if (UPDATED_AT_FIELDS.includes(columnName)) {
      return `${comment}@UpdateDateColumn({ type: 'timestamptz'${nullableOption}, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })\n  ${property}`;
    }

    if (DELETED_AT_FIELDS.includes(columnName)) {
      const deletedProperty = this.renderProperty(column.name, tsType, true);
      return `${comment}@DeleteDateColumn({ type: 'timestamptz', nullable: true })\n  ${deletedProperty}`;
    }

    // Fallback to normal column
    return `${comment}@Column({ type: '${mapDbTypeToTypeOrmType(
      column.type,
    )}' })\n  ${property}`;
  }

  /*
    Utility methods
  */

  /*
    Definite assignment (!) because entity properties are populated by TypeORM,
    which strictPropertyInitialization cannot see.
  */
  private renderProperty(
    name: string,
    tsType: string,
    nullable = false,
  ): string {
    return `${name}!: ${tsType}${nullable ? ' | null' : ''};`;
  }

  private getClassName(tableName: string): string {
    return toPascalCase(tableName);
  }

  private getEntityFileName(tableName: string): string {
    return `${tableName}.entity.ts`;
  }

  private getCamelCase(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
  }

  private getPluralCamelCase(name: string): string {
    const camelCase = this.getCamelCase(name);
    return camelCase.endsWith('s') ? camelCase : `${camelCase}s`;
  }
}
