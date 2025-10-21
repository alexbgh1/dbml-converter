import {
  Component,
  inject,
  signal,
  computed,
  effect,
  WritableSignal,
  Signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  OUTPUT_OPTIONS_MAP,
  OUTPUT_TYPES,
} from './constants/dbml-converter.constants';
import { DBML_DEFAULT_EXAMPLE } from './constants';
import {
  DATABASE_FILE,
  INPUT,
  JSON_FILE,
  OUTPUT,
} from './constants/dbml-in-out.constants';
import { CODE_VIEW_MODE_MAP } from '../../services/view-mode/constants';

import { DbmlParserService } from '../../services/dbml-parser/dbml-parser';
import { NestjsGeneratorService } from '../../services/output-generators/nestjs-generator/nestjs-generator.service';
import { CurrentViewService } from '../../services/view-mode/view-mode.service';

import { formatJson } from './helpers';
import { getLanguageFromFilename } from '../../services/prism/helpers/index';
import { CodeCharsPipe } from '../../shared/pipes/code-chars-count';

import { DbmlCodeEditorComponent } from './components/dbml-code-editor/dbml-code-editor.component';
import { ExpandingCircleButtonComponent } from '../../shared/components/expanding-circle-button/expanding-circle-button.component';
import { FileDropDownComponent } from './components/file-drop-down/file-drop-down.component';
import { HeaderComponent } from '../header/header.component';
import { EditorViewComponent } from '../editor-view/editor-view.component';
import { CopyFileButtonComponent } from '../../shared/components/copy-file-button/copy-file-button.component';
import { DownloadFileButtonComponent } from '../../shared/components/download-file-button/download-file-button.component';

import {
  FileIconComponent,
  FolderIconComponent,
  OpenFolderIconComponent,
} from '../../shared/components/icons';
import { CodeViewerComponent } from '../code-viewer/code-viewer.component';
import { EditorFile } from './interfaces/editor.interface';
import { OutputOption } from './interfaces/dbml-converter.interface';

@Component({
  selector: 'app-dbml-converter',
  imports: [
    FormsModule,
    CommonModule,

    // Components
    HeaderComponent,
    DbmlCodeEditorComponent,
    FileDropDownComponent,
    ExpandingCircleButtonComponent,
    CopyFileButtonComponent,
    DownloadFileButtonComponent,

    // Views
    EditorViewComponent,
    CodeViewerComponent,

    // Icons
    FileIconComponent,
    FolderIconComponent,
    OpenFolderIconComponent,

    // Pipes
    CodeCharsPipe,
  ],
  templateUrl: './dbml-converter.component.html',
})
export class DbmlConverterComponent {
  private dbmlParserService = inject(DbmlParserService);
  private nestjsGeneratorService = inject(NestjsGeneratorService);
  private viewService = inject(CurrentViewService);

  readonly INPUT = INPUT;
  readonly OUTPUT = OUTPUT;
  readonly OUTPUT_TYPES = OUTPUT_TYPES;
  readonly OUTPUT_OPTIONS = OUTPUT_OPTIONS_MAP;

  /* State for the editor view */
  files: WritableSignal<EditorFile[]> = signal([]);
  selectedFile: WritableSignal<EditorFile | null> = signal(null);
  input: WritableSignal<string> = signal('');
  expandedFolders: WritableSignal<Set<string>> = signal(new Set());
  language = computed(() =>
    getLanguageFromFilename(this.selectedFile()?.filename || '')
  );

  /* State for DBML input and output */
  dbmlContent = signal<string>('');
  selectedOutputType = signal<OutputOption>(this.OUTPUT_OPTIONS.json);
  isConverting: WritableSignal<boolean> = signal(false);

  /* View mode state */
  currentView = this.viewService.getCurrentView();
  showEditor: Signal<boolean> = computed(
    () => this.currentView().mode === CODE_VIEW_MODE_MAP.editor
  );
  showPreview: Signal<boolean> = computed(
    () => this.currentView().mode === CODE_VIEW_MODE_MAP.preview
  );

  // Derived states
  schema = this.dbmlParserService.schema;
  hasError = this.dbmlParserService.hasError;
  errorMessage = this.dbmlParserService.errorMessage;

  nestjsCode = signal<{
    entities: Record<string, string>;
    module: string;
  } | null>(null);

  toggleFolder(name: string) {
    /*
      Toggle the expansion state of a folder in the file explorer
      If the folder is expanded, collapse it; if collapsed, expand it
    */
    const setFolders = new Set(this.expandedFolders());
    if (setFolders.has(name)) setFolders.delete(name);
    else setFolders.add(name);
    this.expandedFolders.set(setFolders);
  }

  selectFileInEditor(file: EditorFile | null) {
    this.selectedFile.set(file);
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
          case this.OUTPUT_OPTIONS.json:
            generatedFiles.push({
              id: JSON_FILE.id,
              filename: JSON_FILE.filename,
              content: this.formatJson(schema),
            });
            break;

          case this.OUTPUT_OPTIONS.typeorm:
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
              if (outputType === this.OUTPUT_OPTIONS.typeorm) {
                generatedFiles.push({
                  id: DATABASE_FILE.id,
                  filename: DATABASE_FILE.filename,
                  content: nestjsCode.module,
                });
              }
            }
            break;
        }

        // Update state with generated files
        this.files.set(generatedFiles);

        // Open folders automatically
        const expandedFolders = new Set(this.expandedFolders());
        expandedFolders.add(this.INPUT);
        expandedFolders.add(this.OUTPUT);
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

  onEditorKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && event.ctrlKey) {
      this.handleConvert();
    }
  }

  handleLoadExample() {
    const confirmation = window.confirm(
      'Loading the example will overwrite your current DBML code. Do you want to continue?'
    );
    if (confirmation) {
      this.dbmlContent.set(DBML_DEFAULT_EXAMPLE);
    }
  }

  expandingButtonOptions = computed(() =>
    Object.values(this.OUTPUT_TYPES).map((type) => ({
      id: type.id,
      label: type.label,
      color: type.color,
      icon: type.icon,
    }))
  );

  constructor() {
    // Expand input folder by default
    this.expandedFolders.set(new Set([this.INPUT]));

    effect(() => {
      const type = this.selectedOutputType();
      const schema = this.schema();
      const hasError = this.hasError();

      if (!hasError && schema && type === this.OUTPUT_OPTIONS.typeorm) {
        this.generateNestjsCode();
      }
    });
  }

  /**
   * Handle DBML input changes/updates
   */
  onDbmlInput(code: string): void {
    this.dbmlContent.set(code);
  }

  /**
   * Generate NestJS code from the schema
   */
  generateNestjsCode(): void {
    const schema = this.schema();
    if (!schema) return;

    const generatedCode = this.nestjsGeneratorService.generateCode(schema);
    this.nestjsCode.set(generatedCode);
  }

  /**
   * Change the selected output type
   */
  setOutputType(typeId: string): void {
    const type = Object.values(this.OUTPUT_TYPES).find(
      (option) => option.id === typeId
    );

    if (!type) {
      console.warn(`Output type with id "${typeId}" not found`);
      return;
    }
    if (this.selectedOutputType() === typeId) return;

    this.selectedOutputType.set(type.id);

    // If changing to a type other than NestJS or TypeORM, clear the generated code
    if (typeId !== this.OUTPUT_OPTIONS.typeorm) {
      this.nestjsCode.set(null);
    }
  }

  /**
   * Converts the entities object to an array for easier iteration in templates
   * e.g. Record<string, string> to {fileName, code}[]
   */
  getEntities(
    entities: Record<string, string>
  ): { fileName: string; code: string }[] {
    return Object.entries(entities).map(([fileName, code]) => ({
      fileName,
      code,
    }));
  }

  formatJson(obj: any): string {
    return formatJson(obj);
  }
}
