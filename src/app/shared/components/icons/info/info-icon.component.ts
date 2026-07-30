import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { cn } from '../../../utils/cn';

@Component({
  selector: 'info-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  `,
})
export class InfoIconComponent {
  readonly baseClass = 'w-5 h-5';
  @Input() className = '';

  mergedClassList(): string {
    return cn(this.baseClass, this.className);
  }
}
