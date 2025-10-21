import { Component, Input, signal } from '@angular/core';
import {
  ChevronRightIconComponent,
  ChevronDownIconComponent,
  FileIconComponent,
} from '../../../../shared/components/icons';
import { CodeViewerComponent } from '../../../code-viewer/code-viewer.component';
import { CopyFileButtonComponent } from '../../../../shared/components/copy-file-button/copy-file-button.component';
import { DownloadFileButtonComponent } from '../../../../shared/components/download-file-button/download-file-button.component';

@Component({
  imports: [
    CodeViewerComponent,
    CopyFileButtonComponent,
    DownloadFileButtonComponent,

    // Icons
    ChevronRightIconComponent,
    ChevronDownIconComponent,
    FileIconComponent,
  ],
  selector: 'file-drop-down',
  templateUrl: './file-drop-down.component.html',
})
export class FileDropDownComponent {
  @Input() fileName: string = 'file.txt';
  @Input() charsCount: number = 0;
  @Input() codeContent: string = '';

  isOpen = signal(false);

  onToggle() {
    this.isOpen.set(!this.isOpen());
  }
}
