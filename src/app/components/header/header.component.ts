import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { CODE_VIEW_MODE_MAP } from '../../services/view-mode/constants';

import { PreviewIconComponent } from '../../shared/components/icons/view-mode/preview-icon.component';
import { EditorIconComponent } from '../../shared/components/icons/view-mode/editor-icon.component';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  imports: [
    RouterLink,
    RouterLinkActive,

    // Icons
    PreviewIconComponent,
    EditorIconComponent,
  ],
})
export class HeaderComponent {
  CODE_VIEW_MODE_MAP = CODE_VIEW_MODE_MAP;
  DEFAULT_SUFFIX = '-mode';
}
