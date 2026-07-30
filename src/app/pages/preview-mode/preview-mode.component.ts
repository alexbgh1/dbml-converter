import {
  Component,
  inject,
  computed,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';

import { DbmlStateService } from '../../services/dbml-state/dbml-state.service';

import { DBML_DEFAULT_EXAMPLE } from '../../components/dbml-converter/constants';
import {
  OUTPUT_OPTIONS_MAP,
  OUTPUT_TYPE_OPTIONS,
} from '../../components/dbml-converter/constants/dbml-converter.constants';
import {
  DATABASE_FILE,
  JSON_FILE,
  PRISMA_SCHEMA_FILE,
} from '../../components/dbml-converter/constants/dbml-in-out.constants';

import { CodeCharsPipe } from '../../shared/pipes/code-chars-count';
import { CodeLinesPipe } from '../../shared/pipes/code-lines-count';
import { formatJson } from '../../components/dbml-converter/helpers';

import { DbmlCodeEditorComponent } from '../../components/dbml-converter/components/dbml-code-editor/dbml-code-editor.component';
import { CodeViewerComponent } from '../../components/code-viewer/code-viewer.component';
import { ExpandingCircleButtonComponent } from '../../shared/components/expanding-circle-button/expanding-circle-button.component';
import { FileDropDownComponent } from '../../components/dbml-converter/components/file-drop-down/file-drop-down.component';

import { CopyFileButtonComponent } from '../../shared/components/copy-file-button/copy-file-button.component';
import { DownloadFileButtonComponent } from '../../shared/components/download-file-button/download-file-button.component';
import { DiagnosticsPanelComponent } from '../../shared/components/diagnostics-panel/diagnostics-panel.component';
import { DbmlConversionActionsComponent } from '../../shared/components/dbml-conversion-actions/dbml-conversion-actions.component';
import { LoadDbmlExampleButtonComponent } from '../../shared/components/load-dbml-example-button/load-dbml-example-button.component';
import { DiagnosticRepairRequest } from '../../services/dbml-parser/interfaces/diagnostics.interface';

@Component({
  selector: 'app-preview-mode',
  imports: [
    DbmlCodeEditorComponent,
    CodeViewerComponent,
    ExpandingCircleButtonComponent,
    FileDropDownComponent,
    DiagnosticsPanelComponent,
    DbmlConversionActionsComponent,
    LoadDbmlExampleButtonComponent,

    // Copy & Download
    CopyFileButtonComponent,
    DownloadFileButtonComponent,

    // Pipes
    CodeCharsPipe,
    CodeLinesPipe,
  ],
  templateUrl: './preview-mode.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'flex-1' },
})
export class PreviewModeComponent {
  private stateService = inject(DbmlStateService);

  // Expose state from service
  dbmlContent = this.stateService.dbmlContent;
  schema = this.stateService.schema;
  nestjsCode = this.stateService.nestjsCode;
  prismaSchema = this.stateService.prismaSchema;

  isConverting = this.stateService.isConverting;
  hasConverted = this.stateService.hasConvertedOutput;
  selectedOutputType = this.stateService.selectedOutputType;

  diagnosticsState = this.stateService.diagnosticsState;

  private dbmlEditor = viewChild(DbmlCodeEditorComponent);

  // Constants
  OUTPUT_OPTIONS = OUTPUT_OPTIONS_MAP;
  readonly DATABASE_FILE = DATABASE_FILE;
  readonly JSON_FILE = JSON_FILE;
  readonly PRISMA_SCHEMA_FILE = PRISMA_SCHEMA_FILE;

  readonly expandingButtonOptions = OUTPUT_TYPE_OPTIONS;
  readonly formattedSchema = computed(() => formatJson(this.schema()));
  readonly entityEntries = computed(() =>
    Object.entries(this.nestjsCode()?.entities ?? {}).map(
      ([fileName, code]) => ({ fileName, code }),
    ),
  );

  // Actions
  onDbmlInput(code: string): void {
    this.stateService.onDbmlInput(code);
  }

  handleConvert(): void {
    this.stateService.handleConvert();
  }

  importDbml(content: string): void {
    this.stateService.importDbml(content);
  }

  clearAll(): void {
    this.stateService.clearAll();
  }

  setOutputType(typeId: string): void {
    this.stateService.setOutputType(typeId);
  }

  /* Diagnostics navigation: the input editor is always visible on the left */
  goToLine(line: number): void {
    this.dbmlEditor()?.scrollToLine(line);
  }

  applyRepair(request: DiagnosticRepairRequest): void {
    this.stateService.applyDiagnosticRepair(request);
  }

  undoRepair(): void {
    this.stateService.undoLastRepair();
  }

  loadExample(): void {
    this.stateService.replaceDbml(DBML_DEFAULT_EXAMPLE);
  }
}
