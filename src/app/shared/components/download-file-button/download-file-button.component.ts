import { Component, Input } from '@angular/core';
import { saveAs } from 'file-saver';

import { DownloadIconComponent } from '../icons';
import {
  DEFAULT_MIME_TYPE,
  MIME_TYPES,
} from '../../constants/mime-types.constants';

@Component({
  imports: [DownloadIconComponent],
  selector: 'download-file-button',
  host: {
    class: 'flex items-center',
  },
  templateUrl: './download-file-button.component.html',
})
export class DownloadFileButtonComponent {
  @Input() textToDownload: string = '';
  @Input() fileName: string = 'file.txt';

  onDownload(event: MouseEvent) {
    event.stopPropagation();

    const mimeType = this.getMimeType(this.fileName);
    const blob = new Blob([this.textToDownload], { type: mimeType });

    saveAs(blob, this.fileName);
  }

  private getMimeType(fileName: string): string {
    if (!fileName || fileName.indexOf('.') === -1) return DEFAULT_MIME_TYPE;

    const extension = fileName.split('.').pop()?.toLowerCase();
    return MIME_TYPES[extension || ''] || DEFAULT_MIME_TYPE;
  }
}
