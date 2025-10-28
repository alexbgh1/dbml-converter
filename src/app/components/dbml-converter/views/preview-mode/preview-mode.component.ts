import { Component, inject, computed } from '@angular/core';
import { Router } from '@angular/router';

import { DbmlStateService } from '../../../../services/dbml-state/dbml-state.service';

import { DBML_DEFAULT_EXAMPLE, DBML_DEFAULT_VALUE } from '../../constants';
import {
  OUTPUT_OPTIONS_MAP,
  OUTPUT_TYPES,
} from '../../constants/dbml-converter.constants';

import { CodeCharsPipe } from '../../../../shared/pipes/code-chars-count';
import { formatJson } from '../../helpers';

import { DbmlCodeEditorComponent } from '../../components/dbml-code-editor/dbml-code-editor.component';
import { CodeViewerComponent } from '../../../code-viewer/code-viewer.component';
import { ExpandingCircleButtonComponent } from '../../../../shared/components/expanding-circle-button/expanding-circle-button.component';
import { FileDropDownComponent } from '../../components/file-drop-down/file-drop-down.component';

import { CopyFileButtonComponent } from '../../../../shared/components/copy-file-button/copy-file-button.component';
import { DownloadFileButtonComponent } from '../../../../shared/components/download-file-button/download-file-button.component';

@Component({
  selector: 'app-preview-mode',
  imports: [
    DbmlCodeEditorComponent,
    CodeViewerComponent,
    ExpandingCircleButtonComponent,
    FileDropDownComponent,

    // Copy & Download
    CopyFileButtonComponent,
    DownloadFileButtonComponent,

    // Pipes
    CodeCharsPipe,
  ],
  templateUrl: './preview-mode.component.html',
})
export class PreviewModeComponent {
  private stateService = inject(DbmlStateService);

  // Expose state from service
  dbmlContent = this.stateService.dbmlContent;
  schema = this.stateService.schema;
  nestjsCode = this.stateService.nestjsCode;
  isConverting = this.stateService.isConverting;
  selectedOutputType = this.stateService.selectedOutputType;

  hasError = this.stateService.hasError;
  errorMessage = this.stateService.errorMessage;

  // Constants
  OUTPUT_OPTIONS = OUTPUT_OPTIONS_MAP;
  DBML_DEFAULT_VALUE = DBML_DEFAULT_VALUE;

  // Computed
  expandingButtonOptions = computed(() =>
    Object.values(OUTPUT_TYPES).map((type) => type)
  );

  // Actions
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

  // Helper methods
  formatJson(obj: any): string {
    // This wrapper is necessary to use the function in the template
    return formatJson(obj);
  }

  handleLoadExample() {
    const confirmation = window.confirm(
      'Loading the example will overwrite your current DBML code. Do you want to continue?'
    );
    if (confirmation) {
      this.dbmlContent.set(DBML_DEFAULT_EXAMPLE);
    }
  }
}
