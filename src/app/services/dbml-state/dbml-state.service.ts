import {
  Injectable,
  signal,
  inject,
  effect,
  WritableSignal,
  computed,
} from '@angular/core';

import { DbmlParserService } from '../dbml-parser/dbml-parser';
import { NestjsGeneratorService } from '../output-generators/nestjs-generator/nestjs-generator.service';
import { PrismaGeneratorService } from '../output-generators/prisma-generator/prisma-generator.service';

import {
  OUTPUT_OPTIONS_MAP,
  OUTPUT_TYPES,
} from '../../components/dbml-converter/constants/dbml-converter.constants';
import {
  DATABASE_FILE,
  INPUT,
  JSON_FILE,
  OUTPUT,
  PRISMA_SCHEMA_FILE,
} from '../../components/dbml-converter/constants/dbml-in-out.constants';

import { OutputOption } from '../../components/dbml-converter/interfaces/dbml-converter.interface';
import { EditorFile } from '../../components/dbml-converter/interfaces/editor.interface';

import { formatJson } from '../../components/dbml-converter/helpers';

@Injectable({ providedIn: 'root' })
export class DbmlStateService {
  private dbmlParserService = inject(DbmlParserService);
  private nestjsGeneratorService = inject(NestjsGeneratorService);
  private prismaGeneratorService = inject(PrismaGeneratorService);

  // Shared state across routes
  dbmlContent: WritableSignal<string> = signal<string>('');
  selectedOutputType: WritableSignal<OutputOption> = signal<OutputOption>(
    OUTPUT_OPTIONS_MAP.json
  );
  isConverting: WritableSignal<boolean> = signal<boolean>(false);

  files: WritableSignal<EditorFile[]> = signal([]);
  selectedFile: WritableSignal<EditorFile | null> = signal(null);
  input: WritableSignal<string> = signal('');
  expandedFolders: WritableSignal<Set<string>> = signal(new Set());

  // Computed states
  schema = this.dbmlParserService.schema;

  hasError = this.dbmlParserService.hasError;
  errorMessage = this.dbmlParserService.errorMessage;

  nestjsCode = signal<{
    entities: Record<string, string>;
    module: string;
  } | null>(null);

  prismaSchema = computed(() => {
    const schema = this.schema();
    if (!schema) return null;

    const prismaCode = this.prismaGeneratorService.generateCode(schema);
    return prismaCode.schema;
  });

  constructor() {
    effect(() => {
      const type = this.selectedOutputType();
      const schema = this.schema();
      const hasError = this.hasError();

      if (!hasError && schema && type === OUTPUT_OPTIONS_MAP.typeorm) {
        this.generateNestjsCode();
      }
    });
  }

  // Actions
  setDbmlContent(content: string): void {
    this.dbmlContent.set(content);
  }

  /**
   * Change the selected output type
   */
  setOutputType(typeId: string): void {
    const type = Object.values(OUTPUT_TYPES).find(
      (option) => option.id === typeId
    );

    if (!type) {
      console.warn(`Output type with id "${typeId}" not found`);
      return;
    }
    if (this.selectedOutputType() === typeId) return;

    this.selectedOutputType.set(type.id);

    // If changing to a type other than NestJS or TypeORM, clear the generated code
    if (typeId !== OUTPUT_OPTIONS_MAP.typeorm) {
      this.nestjsCode.set(null);
    }
  }

  handleConvert() {
    this.isConverting.set(true);

    this.dbmlParserService.setDbmlContent(this.dbmlContent());

    setTimeout(() => {
      try {
        const schema = this.schema();
        const hasError = this.hasError();

        if (hasError || !schema) {
          this.isConverting.set(false);
          return;
        }

        const outputType = this.selectedOutputType();
        const generatedFiles: EditorFile[] = [];

        switch (outputType) {
          case OUTPUT_OPTIONS_MAP.json:
            generatedFiles.push({
              id: JSON_FILE.id,
              filename: JSON_FILE.filename,
              content: formatJson(schema),
            });
            break;

          case OUTPUT_OPTIONS_MAP.typeorm:
            this.generateNestjsCode();
            const nestjsCode = this.nestjsCode();

            if (nestjsCode) {
              // Add entities files (e.g., User.ts, Post.ts, etc.)
              Object.entries(nestjsCode.entities).forEach(
                ([filename, content]) => {
                  generatedFiles.push({
                    id: `entity-${filename}`,
                    filename: filename,
                    content,
                  });
                }
              );

              // Add module file (e.g., database.module.ts)
              if (outputType === OUTPUT_OPTIONS_MAP.typeorm) {
                generatedFiles.push({
                  id: DATABASE_FILE.id,
                  filename: DATABASE_FILE.filename,
                  content: nestjsCode.module,
                });
              }
            }
            break;

          case OUTPUT_OPTIONS_MAP.prisma:
            const prismaCode = this.prismaGeneratorService.generateCode(schema);
            generatedFiles.push({
              id: 'schema-prisma',
              filename: 'schema.prisma',
              content: prismaCode.schema,
            });
            break;
        }

        // Update state with generated files
        this.files.set(generatedFiles);

        // Open folders automatically
        const expandedFolders = new Set(this.expandedFolders());
        expandedFolders.add(INPUT);
        expandedFolders.add(OUTPUT);
        this.expandedFolders.set(expandedFolders);
      } catch (error) {
        console.error('Error during conversion:', error);
      } finally {
        this.isConverting.set(false);
      }
    }, 100);
  }

  clearAll() {
    this.dbmlContent.set('');
    this.input.set('');
    this.files.set([]);
    this.selectedFile.set(null);
  }

  /**
   * Generate NestJS code from the schema
   */
  private generateNestjsCode(): void {
    const schema = this.schema();
    if (!schema) return;

    const generatedCode = this.nestjsGeneratorService.generateCode(schema);
    this.nestjsCode.set(generatedCode);
  }

  /**
   * Handle DBML input changes/updates
   */
  onDbmlInput(code: string): void {
    this.dbmlContent.set(code);
  }
}
