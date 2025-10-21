import { Component, Input } from '@angular/core';

import { cn } from '../../../utils/cn';

@Component({
  selector: 'pulse-ring-loading',
  standalone: true,
  template: `
    <div [class]="mergedClassList()">
      <div
        class="absolute inset-0 rounded-full border-2 border-current opacity-75 animate-ping"
      ></div>
      <div
        class="absolute inset-0 rounded-full border-2 border-current opacity-25"
      ></div>
      <div class="absolute inset-2 rounded-full bg-current opacity-75"></div>
    </div>
  `,
})
export class PulseRingLoadingComponent {
  baseClass: string = 'relative w-3 h-3';
  @Input() className: string = '';

  mergedClassList(): string {
    return cn(this.baseClass, this.className);
  }
}
