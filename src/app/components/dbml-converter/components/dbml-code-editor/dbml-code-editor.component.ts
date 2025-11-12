import {
  Component,
  ElementRef,
  viewChild,
  signal,
  effect,
  WritableSignal,
  computed,
  input,
  model,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PrismService } from '../../../../services/prism/prism.service';

import { DBML_DEFAULT_VALUE } from '../../constants';

import { CodeLine } from '../../interfaces/editor.interface';

/*
  This component has two main parts:
  1. A textarea where the user can input DBML code.
  2. A pre element that displays the syntax-highlighted version of the code.

  There are some functions to keep the scroll positions (X and Y overflow) and sizes in sync between these two elements.
*/
@Component({
  imports: [FormsModule],
  selector: 'app-dbml-code-editor',
  templateUrl: './dbml-code-editor.component.html',
  styleUrls: ['./dbml-code-editor.component.css'],
})
export class DbmlCodeEditorComponent {
  code = model(DBML_DEFAULT_VALUE);
  placeholder = input(DBML_DEFAULT_VALUE);
  height = input('400px');

  editorTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('editorTextarea');

  highlighted: WritableSignal<string> = signal('');
  scrollTop: WritableSignal<number> = signal(0);
  scrollLeft: WritableSignal<number> = signal(0);

  codeLines = computed<CodeLine[]>(() => {
    const lines = this.highlighted().split('\n');
    return lines.map((line, index) => ({
      number: index + 1,
      content: line || '&nbsp;',
    }));
  });

  constructor(private prism: PrismService) {
    effect(() => {
      this.highlightCode();
    });
  }

  /*
  Sync scroll positions (X and Y) between the textarea and the highlighted code display.
  */
  handleScroll(): void {
    if (!this.editorTextarea()?.nativeElement) return;

    const textarea = this.editorTextarea()!.nativeElement;
    this.scrollTop.set(textarea.scrollTop);
    this.scrollLeft.set(textarea.scrollLeft);
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Tab') {
      event.preventDefault();

      if (!this.code()) {
        this.code.set(this.placeholder());
        return;
      }

      /* Handle tab insertion */
      const textarea = event.target as HTMLTextAreaElement;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const tabChar = '\t';

      const newValue =
        this.code().substring(0, start) + tabChar + this.code().substring(end);

      this.code.set(newValue);
      textarea.value = newValue;

      textarea.selectionStart = textarea.selectionEnd = start + tabChar.length;
    }
  }

  private highlightCode(): void {
    this.highlighted.set(this.prism.highlight(this.code()));
  }
}
