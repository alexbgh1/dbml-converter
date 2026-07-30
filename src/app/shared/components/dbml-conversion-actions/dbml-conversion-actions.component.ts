import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { ActionDialogComponent } from '../action-dialog/action-dialog.component';

@Component({
  selector: 'app-dbml-conversion-actions',
  imports: [ActionDialogComponent],
  templateUrl: './dbml-conversion-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-center gap-2' },
})
export class DbmlConversionActionsComponent {
  readonly isConverting = input(false);
  readonly convertRequested = output<void>();
  readonly clearRequested = output<void>();
  readonly clearConfirmationOpen = signal(false);

  requestClear(): void {
    this.clearConfirmationOpen.set(true);
  }

  cancelClear(): void {
    this.clearConfirmationOpen.set(false);
  }

  confirmClear(): void {
    this.cancelClear();
    this.clearRequested.emit();
  }
}
