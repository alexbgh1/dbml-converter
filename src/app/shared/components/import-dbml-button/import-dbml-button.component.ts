import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { DBML_FILE_EXTENSION, validateDbmlFile } from './import-dbml-file';

@Component({
  selector: 'app-import-dbml-button',
  templateUrl: './import-dbml-button.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ImportDbmlButtonComponent {
  readonly DBML_FILE_EXTENSION = DBML_FILE_EXTENSION;
  hasExistingContent = input(false);
  imported = output<string>();

  private fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  status = signal<string | null>(null);
  isError = signal(false);
  isReading = signal(false);

  chooseFile(): void {
    this.fileInput()?.nativeElement.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // selecting the same file again should still emit change
    if (!file) return;

    const validationError = validateDbmlFile(file);
    if (validationError) {
      this.setStatus(validationError, true);
      return;
    }

    this.isReading.set(true);
    try {
      const content = await file.text();
      if (!content.trim()) {
        this.setStatus(
          'The selected DBML file contains only whitespace.',
          true,
        );
        return;
      }

      if (
        this.hasExistingContent() &&
        !window.confirm(
          'Importing this file will replace the current DBML code. Continue?',
        )
      ) {
        this.setStatus('Import cancelled.', false);
        return;
      }

      this.imported.emit(content);
      this.setStatus(
        `Imported ${file.name}. Press Convert to generate output.`,
        false,
      );
    } catch {
      this.setStatus('The selected DBML file could not be read.', true);
    } finally {
      this.isReading.set(false);
    }
  }

  private setStatus(message: string, isError: boolean): void {
    this.status.set(message);
    this.isError.set(isError);
  }
}
