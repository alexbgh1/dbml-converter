import { Component } from '@angular/core';

import {
  AT_SYMBOL,
  LEFT_CURLY_BRACE,
  RIGHT_CURLY_BRACE,
} from '../../../../shared/constants/special-chars.constants';

import { FileIconComponent } from '../../../../shared/components/icons';
import { SVG_LINES, SVG_OPACITY, SVG_VIEWBOX } from './svg-lines/svg-lines';

@Component({
  selector: 'app-output-files-desktop',
  templateUrl: './output-files-desktop.component.html',
  imports: [FileIconComponent],
  styles: [
    `
      @keyframes dash {
        0% {
          stroke-dashoffset: 20;
        }
        100% {
          stroke-dashoffset: 0;
        }
      }

      .animate-dash {
        animation: dash 2s linear infinite;
      }
    `,
  ],
})
export class OutputFilesDesktopComponent {
  readonly SVG_LINES = SVG_LINES;
  readonly SVG_VIEWBOX = SVG_VIEWBOX;
  readonly SVG_OPACITY = SVG_OPACITY;

  AT_SYMBOL = AT_SYMBOL;
  LEFT_CURLY_BRACE = LEFT_CURLY_BRACE;
  RIGHT_CURLY_BRACE = RIGHT_CURLY_BRACE;
}
