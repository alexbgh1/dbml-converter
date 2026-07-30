import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { cn } from '../../../utils/cn';

@Component({
  selector: 'er-diagram-icon',
  changeDetection: ChangeDetectionStrategy.Eager,
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
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="6" rx="1" />
      <rect x="14" y="15" width="7" height="6" rx="1" />
      <path d="M10 6h3a4 4 0 0 1 4 4v5" />
    </svg>
  `,
})
export class ErDiagramIconComponent {
  baseClass = 'w-8 h-8';
  @Input() className = '';

  mergedClassList(): string {
    return cn(this.baseClass, this.className);
  }
}
