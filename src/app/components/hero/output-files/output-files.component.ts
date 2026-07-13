import { Component, ChangeDetectionStrategy } from '@angular/core';
import { OutputFilesMobileComponent } from './mobile/output-files-mobile.component';
import { OutputFilesDesktopComponent } from './desktop/output-files-desktop.component';

@Component({
  selector: 'app-output-files',
  templateUrl: './output-files.component.html',
  imports: [OutputFilesMobileComponent, OutputFilesDesktopComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  host: {
    class: 'block w-4/5 sm:w-auto',
  },
})
export class OutputFilesComponent {}
