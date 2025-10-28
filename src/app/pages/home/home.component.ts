import { Component } from '@angular/core';

import { CodeEditorComponent } from '../../components/hero/code-editor/code-editor.component';
import { TitleComponent } from '../../components/hero/title/title.component';
import { OutputFilesComponent } from '../../components/hero/output-files/output-files.component';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  imports: [CodeEditorComponent, TitleComponent, OutputFilesComponent],
})
export class HomeComponent {}
