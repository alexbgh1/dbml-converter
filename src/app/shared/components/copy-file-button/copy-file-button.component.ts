import {
  Component,
  DestroyRef,
  Input,
  inject,
  signal,
  WritableSignal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CopyIconComponent } from '../icons';

@Component({
  imports: [CopyIconComponent],
  selector: 'copy-file-button',
  host: {
    class: 'flex gap-1 items-center',
  },
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './copy-file-button.component.html',
})
export class CopyFileButtonComponent {
  private destroyRef = inject(DestroyRef);

  @Input() textToCopy: string = '';

  isCopied: WritableSignal<boolean> = signal(false);
  private copyTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.copyTimeout) clearTimeout(this.copyTimeout);
    });
  }

  copyToClipboard(event: MouseEvent) {
    event.stopPropagation();

    navigator.clipboard.writeText(this.textToCopy).then(() => {
      this.isCopied.set(true);

      if (this.copyTimeout) clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => {
        this.isCopied.set(false);
        this.copyTimeout = null;
      }, 2000);
    });
  }
}
