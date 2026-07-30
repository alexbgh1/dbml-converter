import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { DEFAULT_PRISM_LANGUAGE } from '../../shared/constants/code-language';

import { PrismService } from '../../services/prism/prism.service';

/*
  This component displays code with syntax highlighting using Prism.js.
*/
@Component({
  selector: 'app-code-viewer',
  standalone: true,
  imports: [],
  templateUrl: './code-viewer.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./code-viewer.component.css'],
})
export class CodeViewerComponent {
  code = input('');
  language = input(DEFAULT_PRISM_LANGUAGE);
  height = input('200px');

  highlightedCode = computed(() => {
    const code = this.code();
    return code ? this.prismService.highlight(code, this.language()) : '';
  });

  constructor(private prismService: PrismService) {}
}
