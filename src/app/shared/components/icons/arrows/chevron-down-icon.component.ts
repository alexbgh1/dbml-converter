import { Component, Input } from '@angular/core';
import { cn } from '../../../utils/cn';

@Component({
  selector: 'chevron-down-icon',
  standalone: true,
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
      <path d="m6 9 6 6 6-6" />
    </svg>
  `,
})
export class ChevronDownIconComponent {
  baseClass: string = 'w-8 h-8';
  @Input() className: string = '';

  mergedClassList(): string {
    return cn(this.baseClass, this.className);
  }
}
