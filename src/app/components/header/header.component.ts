import { Component, computed, inject } from '@angular/core';

import { CODE_VIEW_MODE_MAP } from '../../services/view-mode/constants';

import { CurrentViewService } from '../../services/view-mode/view-mode.service';

import { PreviewIconComponent } from '../../shared/components/icons/view-mode/preview-icon.component';
import { EditorIconComponent } from '../../shared/components/icons/view-mode/editor-icon.component';
import { CodeViewMode } from '../../services/view-mode/interfaces/view-mode.interface';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  imports: [PreviewIconComponent, EditorIconComponent],
})
export class HeaderComponent {
  currentViewService = inject(CurrentViewService);

  CODE_VIEW_MODE_MAP = CODE_VIEW_MODE_MAP;

  currentMode = computed(() => this.currentViewService.currentViewMode().mode);

  setViewMode(mode: CodeViewMode) {
    this.currentViewService.setCurrentView({ mode });
  }
}
