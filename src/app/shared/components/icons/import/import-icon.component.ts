import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { cn } from '../../../utils/cn';

@Component({
  selector: 'import-icon',
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
      class="lucide lucide-import-icon lucide-import"
    >
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path
        d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"
      />
    </svg>
  `,
})
export class ImportIconComponent {
  baseClass: string = 'w-8 h-8';
  @Input() className: string = '';

  mergedClassList(): string {
    return cn(this.baseClass, this.className);
  }
}
