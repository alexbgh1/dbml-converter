import {
  Component,
  afterNextRender,
  inject,
  computed,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

import { DbmlStateService } from '../../services/dbml-state/dbml-state.service';

import { EditorFile } from '../../components/dbml-converter/interfaces/editor.interface';

import { OUTPUT_TYPE_OPTIONS } from '../../components/dbml-converter/constants/dbml-converter.constants';
import { DBML_DEFAULT_EXAMPLE } from '../../components/dbml-converter/constants';
import {
  DBML_INPUT_FILE,
  INPUT,
  OUTPUT,
} from '../../components/dbml-converter/constants/dbml-in-out.constants';
import { projectArchiveEntries } from './editor-mode.helpers';

import { CodeCharsPipe } from '../../shared/pipes/code-chars-count';
import { CodeLinesPipe } from '../../shared/pipes/code-lines-count';
import { getLanguageFromFilename } from '../../services/prism/helpers';

import {
  FolderIconComponent,
  OpenFolderIconComponent,
  FileIconComponent,
} from '../../shared/components/icons';

import { EditorViewComponent } from '../../components/editor-view/editor-view.component';
import { DbmlCodeEditorComponent } from '../../components/dbml-converter/components/dbml-code-editor/dbml-code-editor.component';
import { CodeViewerComponent } from '../../components/code-viewer/code-viewer.component';
import { ExpandingCircleButtonComponent } from '../../shared/components/expanding-circle-button/expanding-circle-button.component';

import { CopyFileButtonComponent } from '../../shared/components/copy-file-button/copy-file-button.component';
import { DownloadFileButtonComponent } from '../../shared/components/download-file-button/download-file-button.component';
import { DiagnosticsPanelComponent } from '../../shared/components/diagnostics-panel/diagnostics-panel.component';
import { DiagnosticRepairRequest } from '../../services/dbml-parser/interfaces/diagnostics.interface';
import { DbmlConversionActionsComponent } from '../../shared/components/dbml-conversion-actions/dbml-conversion-actions.component';
import { LoadDbmlExampleButtonComponent } from '../../shared/components/load-dbml-example-button/load-dbml-example-button.component';

@Component({
  selector: 'app-editor-mode',
  imports: [
    DbmlCodeEditorComponent,

    EditorViewComponent,
    CodeViewerComponent,
    ExpandingCircleButtonComponent,

    // Copy & Download
    CopyFileButtonComponent,
    DownloadFileButtonComponent,

    // Diagnostics
    DiagnosticsPanelComponent,
    DbmlConversionActionsComponent,
    LoadDbmlExampleButtonComponent,

    // Icons
    FolderIconComponent,
    OpenFolderIconComponent,
    FileIconComponent,

    // Pipes
    CodeCharsPipe,
    CodeLinesPipe,
  ],
  templateUrl: './editor-mode.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { class: 'flex-1' },
})
export class EditorModeComponent {
  private stateService = inject(DbmlStateService);

  dbmlContent = this.stateService.dbmlContent;
  files = this.stateService.files;
  selectedFile = this.stateService.selectedFile;
  expandedFolders = this.stateService.expandedFolders;
  isConverting = this.stateService.isConverting;

  selectedOutputType = this.stateService.selectedOutputType;

  diagnosticsState = this.stateService.diagnosticsState;

  private dbmlEditor = viewChild(DbmlCodeEditorComponent);

  constructor() {
    afterNextRender(() => {
      const line = this.stateService.consumeSourceNavigation();
      if (line !== null) this.goToLine(line);
    });
  }

  readonly DBML_INPUT_FILE = DBML_INPUT_FILE;
  readonly INPUT_FOLDER_ID = INPUT;
  readonly OUTPUT_FOLDER_ID = OUTPUT;

  // Computed
  language = computed(() =>
    getLanguageFromFilename(this.selectedFile()?.filename || ''),
  );

  readonly expandingButtonOptions = OUTPUT_TYPE_OPTIONS;

  // Shared Actions (dbml-)
  onDbmlInput(code: string): void {
    this.stateService.onDbmlInput(code);
  }

  handleConvert(): void {
    this.stateService.handleConvert();
  }

  clearAll(): void {
    this.stateService.clearAll();
  }

  setOutputType(typeId: string): void {
    this.stateService.setOutputType(typeId);
  }

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

  selectFileInEditor(file: EditorFile | null): void {
    this.stateService.selectedFile.set(file);
  }

  /* Diagnostics navigation: the input editor only renders for the DBML source */
  goToLine(line: number): void {
    this.stateService.selectedFile.set(null);
    setTimeout(() => this.dbmlEditor()?.scrollToLine(line));
  }

  applyRepair(request: DiagnosticRepairRequest): void {
    this.stateService.applyDiagnosticRepair(request);
  }

  undoRepair(): void {
    this.stateService.undoLastRepair();
  }

  importDbml(content: string): void {
    this.stateService.importDbml(content);
  }

  async handleDownloadAllAsZip(): Promise<void> {
    const inputFileLength = 1;
    const confirmed = window.confirm(
      `Downloading all files (${
        this.files().length + inputFileLength
      }) including input as a zip`,
    );
    if (!confirmed) return;

    const zip = new JSZip();

    for (const entry of projectArchiveEntries(
      this.files(),
      this.dbmlContent(),
    )) {
      zip.file(entry.filename, entry.content);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, 'dbml-project.zip');
  }

  loadExample(): void {
    this.stateService.replaceDbml(DBML_DEFAULT_EXAMPLE);
  }
}
