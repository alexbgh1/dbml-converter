import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { APP_ROUTES } from '../../shared/constants/app-routes.constants';

import { PreviewIconComponent } from '../../shared/components/icons/view-mode/preview-icon.component';
import { EditorIconComponent } from '../../shared/components/icons/view-mode/editor-icon.component';
import { HomeIconComponent } from '../../shared/components/icons/home/home-icon.component';
import { ErDiagramIconComponent } from '../../shared/components/icons/view-mode/er-diagram-icon.component';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    RouterLink,
    RouterLinkActive,
    PreviewIconComponent,
    EditorIconComponent,
    HomeIconComponent,
    ErDiagramIconComponent,
  ],
})
export class HeaderComponent {
  readonly APP_ROUTES = APP_ROUTES;
  isMenuOpen = false;

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  closeMenu() {
    this.isMenuOpen = false;
  }
}
