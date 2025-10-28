import { Component } from '@angular/core';

import {
  AT_SYMBOL,
  LEFT_CURLY_BRACE,
  RIGHT_CURLY_BRACE,
} from '../../../../shared/constants/special-chars.constants';

import { FileIconComponent } from '../../../../shared/components/icons';

@Component({
  selector: 'app-output-files-mobile',
  templateUrl: './output-files-mobile.component.html',
  imports: [FileIconComponent],
})
export class OutputFilesMobileComponent {
  AT_SYMBOL = AT_SYMBOL;
  LEFT_CURLY_BRACE = LEFT_CURLY_BRACE;
  RIGHT_CURLY_BRACE = RIGHT_CURLY_BRACE;
}
