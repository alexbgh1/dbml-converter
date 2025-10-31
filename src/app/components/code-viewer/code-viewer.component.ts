import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

import Prism from 'prismjs';

import { DEFAULT_PRISM_LANGUAGE } from '../../shared/constants/code-language';

import { PrismService } from '../../services/prism/prism.service';

/*
  This component displays code with syntax highlighting using Prism.js.
*/
@Component({
  selector: 'app-code-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './code-viewer.component.html',
  styleUrls: ['./code-viewer.component.css'],
})
export class CodeViewerComponent implements OnChanges {
  DEFAULT_PRISM_LANGUAGE = DEFAULT_PRISM_LANGUAGE;

  @Input() code: string = '';
  @Input() language: string = DEFAULT_PRISM_LANGUAGE;
  @Input() height: string = '200px';

  charsCount: number = 0;

  highlightedCode: string = '';

  constructor(private prismService: PrismService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['code'] || changes['language']) {
      this.highlight();
    }
  }

  private highlight(): void {
    if (!this.code) {
      this.highlightedCode = '';
      return;
    }

    const language =
      this.language in Prism.languages
        ? this.language
        : this.DEFAULT_PRISM_LANGUAGE;

    this.highlightedCode = this.prismService.highlight(this.code, language);
  }
}
