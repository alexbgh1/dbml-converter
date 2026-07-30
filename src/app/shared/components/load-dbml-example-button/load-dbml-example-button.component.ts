import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';

import { ActionDialogComponent } from '../action-dialog/action-dialog.component';

@Component({
  selector: 'app-load-dbml-example-button',
  imports: [ActionDialogComponent],
  templateUrl: './load-dbml-example-button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadDbmlExampleButtonComponent {
  readonly label = input('Load example DBML code');
  readonly loadRequested = output<void>();
  readonly confirmationOpen = signal(false);

  cancel(): void {
    this.confirmationOpen.set(false);
  }

  confirm(): void {
    this.cancel();
    this.loadRequested.emit();
  }
}
