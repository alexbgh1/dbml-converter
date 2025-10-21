import { Component, Input, signal, WritableSignal } from '@angular/core';
import { CopyIconComponent } from '../icons';

@Component({
  imports: [CopyIconComponent],
  selector: 'copy-file-button',
  host: {
    class: 'flex gap-1 items-center',
  },
  templateUrl: './copy-file-button.component.html',
})
export class CopyFileButtonComponent {
  @Input() textToCopy: string = '';

  isCopied: WritableSignal<boolean> = signal(false);
  private copyTimeout: any = null;

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
