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
} from '../../components/dbml-converter/constants/dbml-in-out.constants';

import { OutputOption } from '../../components/dbml-converter/interfaces/dbml-converter.interface';
import { EditorFile } from '../../components/dbml-converter/interfaces/editor.interface';

import { formatJson } from '../../components/dbml-converter/helpers';
import { STORAGE_KEYS } from './constants/local-storage.constants';

@Injectable({ providedIn: 'root' })
export class DbmlStateService {
  private dbmlParserService = inject(DbmlParserService);
  private nestjsGeneratorService = inject(NestjsGeneratorService);
  private prismaGeneratorService = inject(PrismaGeneratorService);

  constructor() {
    /* Save DBML content and output type to localStorage on changes */
    effect(() => {
      const content = this.dbmlContent();
      this.saveToStorage(STORAGE_KEYS.DBML_CONTENT, content);
    });

    effect(() => {
      const outputType = this.selectedOutputType();
      this.saveToStorage(STORAGE_KEYS.OUTPUT_TYPE, outputType);
    });
  }

  // Shared state across routes
  dbmlContent: WritableSignal<string> = signal<string>(
    this.loadFromStorage(STORAGE_KEYS.DBML_CONTENT) || ''
  );

  selectedOutputType: WritableSignal<OutputOption> = signal<OutputOption>(
    this.loadOutputTypeFromStorage() || OUTPUT_OPTIONS_MAP.json
  );
  isConverting: WritableSignal<boolean> = signal<boolean>(false);

  files: WritableSignal<EditorFile[]> = signal([]);
  selectedFile: WritableSignal<EditorFile | null> = signal(null);
  input: WritableSignal<string> = signal('');
  expandedFolders: WritableSignal<Set<string>> = signal(new Set());

  // Computed states
  schema = this.dbmlParserService.schema;

  nestjsCode = computed(() => {
    const schema = this.schema();
    if (!schema) return null;

    return this.nestjsGeneratorService.generateCode(schema);
  });

  prismaSchema = computed(() => {
    const schema = this.schema();
    if (!schema) return null;

    const prismaCode = this.prismaGeneratorService.generateCode(schema);
    return prismaCode.schema;
  });

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
  }

  handleConvert() {
    this.isConverting.set(true);

    this.dbmlParserService.setDbmlContent(this.dbmlContent());

    setTimeout(() => {
      const schema = this.schema();

      if (!schema) {
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

      this.isConverting.set(false);
    }, 100);
  }

  clearAll() {
    this.dbmlContent.set('');
    this.input.set('');
    this.files.set([]);
    this.selectedFile.set(null);
  }

  /**
   * Handle DBML input changes/updates
   */
  onDbmlInput(code: string): void {
    this.dbmlContent.set(code);
  }

  private saveToStorage(key: string, value: any): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }

  private loadFromStorage(key: string): string | null {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      console.error('Error loading from localStorage:', error);
      return null;
    }
  }

  private loadOutputTypeFromStorage(): OutputOption | null {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.OUTPUT_TYPE);
      if (!saved) return null;

      const outputTypeId = JSON.parse(saved) as OutputOption;

      // ✅ Validar que existe en OUTPUT_OPTIONS
      return Object.values(OUTPUT_OPTIONS_MAP).includes(outputTypeId)
        ? outputTypeId
        : null;
    } catch (error) {
      console.error('Error loading output type from localStorage:', error);
      return null;
    }
  }
}
