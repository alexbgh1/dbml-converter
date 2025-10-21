import { Injectable, signal, WritableSignal } from '@angular/core';

import { DEFAULT_VIEW_MODE } from './constants';

import { CodeView } from './interfaces/view-mode.interface';

/*
  Simple service to manage the current view modes (editor, preview)
*/

@Injectable({ providedIn: 'root' })
export class CurrentViewService {
  currentViewMode: WritableSignal<CodeView> = signal({
    mode: DEFAULT_VIEW_MODE,
  });

  getCurrentView() {
    return this.currentViewMode;
  }

  setCurrentView(view: CodeView) {
    this.currentViewMode.set(view);
  }
}
