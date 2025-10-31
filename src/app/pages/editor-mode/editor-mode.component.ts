import { Component, inject, computed } from '@angular/core';
import { Router } from '@angular/router';

import { DbmlStateService } from '../../services/dbml-state/dbml-state.service';

import { EditorFile } from '../../components/dbml-converter/interfaces/editor.interface';

import {
  OUTPUT_OPTIONS_MAP,
  OUTPUT_TYPES,
} from '../../components/dbml-converter/constants/dbml-converter.constants';
import {
  DBML_DEFAULT_EXAMPLE,
  DBML_DEFAULT_VALUE,
} from '../../components/dbml-converter/constants';

import { CodeCharsPipe } from '../../shared/pipes/code-chars-count';
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

    // Icons
    FolderIconComponent,
    OpenFolderIconComponent,
    FileIconComponent,

    // Pipes
    CodeCharsPipe,
  ],
  templateUrl: './editor-mode.component.html',
})
export class EditorModeComponent {
  private stateService = inject(DbmlStateService);
  private router = inject(Router);

  dbmlContent = this.stateService.dbmlContent;
  files = this.stateService.files;
  selectedFile = this.stateService.selectedFile;
  expandedFolders = this.stateService.expandedFolders;
  isConverting = this.stateService.isConverting;

  hasError = this.stateService.hasError;
  errorMessage = this.stateService.errorMessage;
  selectedOutputType = this.stateService.selectedOutputType;

  // Constants
  OUTPUT_OPTIONS = OUTPUT_OPTIONS_MAP;
  DBML_DEFAULT_VALUE = DBML_DEFAULT_VALUE;

  // Computed
  language = computed(() =>
    getLanguageFromFilename(this.selectedFile()?.filename || '')
  );

  // Transform options
  expandingButtonOptions = computed(() =>
    Object.values(OUTPUT_TYPES).map((type) => type)
  );

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

  handleLoadExample() {
    const confirmation = window.confirm(
      'Loading the example will overwrite your current DBML code. Do you want to continue?'
    );
    if (confirmation) {
      this.dbmlContent.set(DBML_DEFAULT_EXAMPLE);
    }
  }
  // Navigate to preview mode
  goToPreview(): void {
    this.router.navigate(['/preview-mode']);
  }
}
