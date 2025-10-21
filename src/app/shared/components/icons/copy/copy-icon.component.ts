import { Component, Input } from '@angular/core';
import { cn } from '../../../utils/cn';

@Component({
  selector: 'copy-icon',
  template: `
    <svg
      [class]="mergedClassList()"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  `,
})
export class CopyIconComponent {
  baseClass: string = 'w-8 h-8';
  @Input() className: string = '';

  mergedClassList(): string {
    return cn(this.baseClass, this.className);
  }
}
