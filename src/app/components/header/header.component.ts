import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';

import { CODE_VIEW_MODE_MAP } from '../../services/view-mode/constants';

import { PreviewIconComponent } from '../../shared/components/icons/view-mode/preview-icon.component';
import { EditorIconComponent } from '../../shared/components/icons/view-mode/editor-icon.component';
import { HomeIconComponent } from '../../shared/components/icons/home/home-icon.component';
import { FileDocsIconComponent } from '../../shared/components/icons/file-docs/filde-docs.component';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    // Icons
    PreviewIconComponent,
    EditorIconComponent,
    HomeIconComponent,
    FileDocsIconComponent,
  ],
})
export class HeaderComponent {
  CODE_VIEW_MODE_MAP = CODE_VIEW_MODE_MAP;
  DEFAULT_SUFFIX = '-mode';
  isMenuOpen = false;

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  closeMenu() {
    this.isMenuOpen = false;
  }
}
