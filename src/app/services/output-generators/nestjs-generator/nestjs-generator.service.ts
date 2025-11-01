import { Injectable } from '@angular/core';

import { mapDbTypeToTypeOrmType } from '../mappers/typeorm.mapper';
import { mapDbTypeToTsType } from '../mappers/ts.mapper';

import {
  CREATED_AT_FIELDS,
  DELETED_AT_FIELDS,
  TIME_FIELD,
  UPDATED_AT_FIELDS,
} from '../../dbml-parser/constants';

import {
  DatabaseSchema,
  Table,
  Column,
  Cardinality,
} from '../../dbml-parser/interfaces/dbml-parser.interface';
import {
  GeneratedCode,
  CodeGenerationOptions,
} from './interfaces/nestjs-generator.interface';

@Injectable({ providedIn: 'root' })
export class NestjsGeneratorService {
  /*
    Based on schema (tables, relations),
    generate NestJS code with TypeORM entities and a module that imports them all.
  */
  generateCode(
    schema: DatabaseSchema,
    options: CodeGenerationOptions = {}
  ): GeneratedCode {
    return {
      entities: this.generateEntities(schema, options),
      module: this.generateModule(schema, options),
    };
  }

  /*
    Generate entities for each table in the schema.
  */
  private generateEntities(
    schema: DatabaseSchema,
    options: CodeGenerationOptions = {}
  ): Record<string, string> {
    if (!schema?.tables?.length) return {};

    const entities: Record<string, string> = {};

    for (const table of schema.tables) {
      const fileName = this.getEntityFileName(table.name);
      const entityContent = this.generateEntityClass(table, schema);
      entities[fileName] = entityContent;
    }

    return entities;
  }

  /*
    Generate a NestJS module importing all entities.
  */
  private generateModule(
    schema: DatabaseSchema,
    options: CodeGenerationOptions = {}
  ): string {
    if (!schema?.tables?.length) return '';

    const entityImports = schema.tables
      .map((table) => {
        const className = this.getClassName(table.name);
        const fileName = this.getEntityFileName(table.name).replace('.ts', '');
        return `import { ${className} } from './${fileName}';`;
      })
      .join('\n');

    const entityList = schema.tables
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
    const imports = [
      `import { Entity, ${this.getTypeOrmImports(
        table,
        schema
      )} } from 'typeorm';`,
    ];

    const relationImports = this.getRelationImports(table, schema);
    imports.push(...relationImports);

    const columns = table.columns
      .map((column) => this.generateColumn(column, table, schema))
      .join('\n\n  ');

    const oneToManyRelations = this.generateOneToManyRelations(table, schema);
    const allProperties = [columns, oneToManyRelations]
      .filter(Boolean)
      .join('\n\n  ');

    return `${imports.join('\n')}

@Entity('${table.name}')
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
    schema: DatabaseSchema
  ): string {
    const typeormType = mapDbTypeToTypeOrmType(column.type);
    const comment = column.note ? `/** ${column.note} */\n  ` : '';
    const decorators: string[] = [];

    // Skip many-to-many references on primary keys
    if (
      column.ref &&
      column.ref.cardinality?.from === Cardinality.Many &&
      column.ref.cardinality?.to === Cardinality.Many
    ) {
      // This is handled by the junction table, just render as PK
      if (column.pk) {
        if (column.increment) {
          decorators.push("@PrimaryGeneratedColumn('increment')");
        } else {
          decorators.push('@PrimaryColumn()');
        }
        return `${comment}${decorators.join('\n  ')}\n  ${
          column.name
        }: ${mapDbTypeToTsType(column.type)};`;
      }
    }

    // Handle foreign key relationships
    if (column.ref) {
      const relatedTable = schema.tables.find(
        (t) => t.name === column.ref?.table
      );
      if (!relatedTable) return ''; // FK not found

      const relatedClassName = this.getClassName(relatedTable.name);
      const relationProperty = this.getCamelCase(relatedClassName);
      const currentClassName = this.getClassName(table.name);
      const inverseProperty = this.getCamelCase(currentClassName);

      // Relationship options (onDelete, onUpdate)
      const opts: string[] = [];
      if (column.ref.onDelete) opts.push(`onDelete: '${column.ref.onDelete}'`);
      if (column.ref.onUpdate) opts.push(`onUpdate: '${column.ref.onUpdate}'`);
      const relationOptions = opts.length ? `, { ${opts.join(', ')} }` : '';

      // Detect if this is a OneToOne relationship (FK is unique)
      const isOneToOne =
        column.unique ||
        (column.ref.cardinality?.from === Cardinality.One &&
          column.ref.cardinality?.to === Cardinality.One);

      if (isOneToOne) {
        // OneToOne relationship
        decorators.push(
          `@OneToOne(() => ${relatedClassName}, ${this.getCamelCase(
            relatedClassName
          )} => ${this.getCamelCase(
            relatedClassName
          )}.${inverseProperty}${relationOptions})`,
          `@JoinColumn({ name: '${column.name}' })`
        );
      } else {
        // ManyToOne relationship with inverse relation
        const inverseRelationProperty =
          this.getPluralCamelCase(currentClassName);
        decorators.push(
          `@ManyToOne(() => ${relatedClassName}, ${this.getCamelCase(
            relatedClassName
          )} => ${this.getCamelCase(
            relatedClassName
          )}.${inverseRelationProperty}${relationOptions})`,
          `@JoinColumn({ name: '${column.name}' })`
        );
      }

      return `${comment}${decorators.join(
        '\n  '
      )}\n  ${relationProperty}: ${relatedClassName};`;
    }

    // Handle primary keys
    if (column.pk) {
      if (column.increment) {
        decorators.push("@PrimaryGeneratedColumn('increment')");
      } else {
        decorators.push('@PrimaryColumn()');
      }

      return `${comment}${decorators.join('\n  ')}\n  ${
        column.name
      }: ${mapDbTypeToTsType(column.type)};`;
    }

    // Handle special timestamp columns (created_at, updated_at)
    if (this.isTimestampColumn(column)) {
      return this.generateTimestampColumn(column, comment);
    }

    // Normal columns
    const columnOptions: string[] = [`type: '${typeormType}'`];
    if (column.nullable === false) columnOptions.push('nullable: false');
    if (column.unique) columnOptions.push('unique: true');
    if (column.default !== undefined)
      columnOptions.push(`default: ${JSON.stringify(column.default)}`);

    decorators.push(`@Column({ ${columnOptions.join(', ')} })`);

    return `${comment}${decorators.join('\n  ')}\n  ${
      column.name
    }: ${mapDbTypeToTsType(column.type)};`;
  }

  /*
    Collect TypeORM imports required for this table.
  */
  private getTypeOrmImports(table: Table, schema: DatabaseSchema): string {
    const imports = new Set<string>(['Column']);

    for (const column of table.columns) {
      if (column.pk) {
        if (column.increment) {
          imports.add('PrimaryGeneratedColumn');
        } else {
          imports.add('PrimaryColumn');
        }
      }
      if (column.ref) {
        if (column.unique) {
          imports.add('OneToOne');
        } else {
          imports.add('ManyToOne');
        }
        imports.add('JoinColumn');
      }

      // Add special timestamp decorators
      if (this.isTimestampColumn(column)) {
        const columnName = column.name.toLowerCase();
        if (CREATED_AT_FIELDS.includes(columnName))
          imports.add('CreateDateColumn');
        if (UPDATED_AT_FIELDS.includes(columnName))
          imports.add('UpdateDateColumn');
        if (DELETED_AT_FIELDS.includes(columnName))
          imports.add('DeleteDateColumn');
      }
    }

    // Check if this table has reverse relations (OneToMany or OneToOne)
    const reverseRelations = schema.tables.flatMap((t) =>
      t.columns.filter((col) => col.ref?.table === table.name)
    );

    const hasOneToMany = reverseRelations.some((col) => !col.unique);
    const hasOneToOne = reverseRelations.some((col) => col.unique);

    if (hasOneToMany) {
      imports.add('OneToMany');
    }
    if (hasOneToOne) {
      imports.add('OneToOne');
    }

    return Array.from(imports).join(', ');
  }

  /*
    Collect imports for related entities to avoid circular issues.
  */
  private getRelationImports(table: Table, schema: DatabaseSchema): string[] {
    const imports = new Set<string>();

    // Foreign keys
    for (const column of table.columns) {
      if (column.ref) {
        const relatedTable = schema.tables.find(
          (t) => t.name === column.ref?.table
        );
        if (relatedTable) {
          const className = this.getClassName(relatedTable.name);
          const fileName = this.getEntityFileName(relatedTable.name).replace(
            '.ts',
            ''
          );
          imports.add(`import { ${className} } from './${fileName}';`);
        }
      }
    }

    // Reverse relations
    for (const otherTable of schema.tables) {
      if (otherTable.name === table.name) continue;

      const foreignKeys = otherTable.columns.filter(
        (col) => col.ref?.table === table.name
      );

      if (foreignKeys.length > 0) {
        const className = this.getClassName(otherTable.name);
        const fileName = this.getEntityFileName(otherTable.name).replace(
          '.ts',
          ''
        );
        imports.add(`import { ${className} } from './${fileName}';`);
      }
    }

    return Array.from(imports);
  }

  /*
    Generate OneToMany relations for this table
  */
  private generateOneToManyRelations(
    table: Table,
    schema: DatabaseSchema
  ): string {
    const relations: string[] = [];

    // Find all tables that reference this table
    for (const otherTable of schema.tables) {
      if (otherTable.name === table.name) continue;

      const foreignKeys = otherTable.columns.filter(
        (col) => col.ref?.table === table.name
      );

      for (const fk of foreignKeys) {
        const relatedClassName = this.getClassName(otherTable.name);
        const currentClassName = this.getClassName(table.name);
        const inverseProperty = this.getCamelCase(currentClassName);

        // Detect if this is a OneToOne relationship (FK is unique)
        const isOneToOne =
          fk.unique ||
          (fk.ref?.cardinality?.from === Cardinality.One &&
            fk.ref?.cardinality?.to === Cardinality.One);

        if (isOneToOne) {
          // OneToOne relationship (without @JoinColumn on this side)
          const relationProperty = this.getCamelCase(relatedClassName);
          relations.push(
            `@OneToOne(() => ${relatedClassName}, ${this.getCamelCase(
              relatedClassName
            )} => ${this.getCamelCase(
              relatedClassName
            )}.${inverseProperty})\n  ${relationProperty}: ${relatedClassName};`
          );
        } else {
          // OneToMany relationship
          const relationProperty = this.getPluralCamelCase(relatedClassName);
          relations.push(
            `@OneToMany(() => ${relatedClassName}, ${this.getCamelCase(
              relatedClassName
            )} => ${this.getCamelCase(
              relatedClassName
            )}.${inverseProperty})\n  ${relationProperty}: ${relatedClassName}[];`
          );
        }
      }
    }

    return relations.join('\n\n  ');
  }

  /*
  Check if column is a special timestamp column (created_at, updated_at)
  */
  private isTimestampColumn(column: Column): boolean {
    const isTimestampType = TIME_FIELD.includes(column.type.toLowerCase());
    const isSpecialName = CREATED_AT_FIELDS.concat(
      DELETED_AT_FIELDS,
      UPDATED_AT_FIELDS
    ).includes(column.name.toLowerCase());
    return isTimestampType && isSpecialName;
  }

  /*
  Generate special timestamp column decorators,
  e.g., @CreateDateColumn for created_at, using TypeORM to handle automatic timestamps.

  */
  private generateTimestampColumn(column: Column, comment: string): string {
    const columnName = column.name.toLowerCase();
    const tsType = mapDbTypeToTsType(column.type);

    if (CREATED_AT_FIELDS.includes(columnName)) {
      return `${comment}@CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })\n  ${column.name}: ${tsType};`;
    }

    if (UPDATED_AT_FIELDS.includes(columnName)) {
      return `${comment}@UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })\n  ${column.name}: ${tsType};`;
    }

    if (DELETED_AT_FIELDS.includes(columnName)) {
      return `${comment}@DeleteDateColumn({ type: 'timestamptz', nullable: true })\n  ${column.name}: ${tsType};`;
    }

    // Fallback to normal column
    return `${comment}@Column({ type: '${mapDbTypeToTypeOrmType(
      column.type
    )}' })\n  ${column.name}: ${tsType};`;
  }

  /*
    Utility methods
  */
  private getClassName(tableName: string): string {
    return tableName
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
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
