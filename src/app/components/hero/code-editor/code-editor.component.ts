import { Component, computed, inject } from '@angular/core';

import { PrismService } from '../../../services/prism/prism.service';

import { DBML_DEFAULT_VALUE } from '../../dbml-converter/constants';
import { CodeLine } from '../../dbml-converter/interfaces/editor.interface';

@Component({
  selector: 'app-code-editor',
  templateUrl: './code-editor.component.html',
  host: {
    class:
      'relative group transition-transform duration-500 animate-float w-full ',
  },
})
export class CodeEditorComponent {
  private prismService = inject(PrismService);

  codeLines = computed<CodeLine[]>(() => {
    const highlighted = this.prismService.highlight(DBML_DEFAULT_VALUE);
    const lines = highlighted.split('\n');

    return lines.map((line, index) => ({
      number: index + 1,
      content: line || '&nbsp;',
    }));
  });
}
