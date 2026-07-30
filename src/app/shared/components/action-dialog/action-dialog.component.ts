import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  input,
  output,
} from '@angular/core';

export type ActionDialogTone = 'default' | 'danger';

@Component({
  selector: 'app-action-dialog',
  templateUrl: './action-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionDialogComponent {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly primaryLabel = input<string | null>(null);
  readonly secondaryLabel = input<string | null>(null);
  readonly primaryTone = input<ActionDialogTone>('default');
  readonly primaryDisabled = input(false);

  readonly primary = output<void>();
  readonly secondary = output<void>();
  readonly dismissed = output<void>();

  onBackdropPointerDown(event: PointerEvent): void {
    if (event.target === event.currentTarget) this.dismissed.emit();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.open()) return;
    event.preventDefault();
    this.dismissed.emit();
  }
}
