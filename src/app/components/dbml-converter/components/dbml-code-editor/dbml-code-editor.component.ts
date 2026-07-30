import {
  Component,
  ElementRef,
  viewChild,
  signal,
  WritableSignal,
  computed,
  input,
  model,
  ChangeDetectionStrategy,
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
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./dbml-code-editor.component.css'],
})
export class DbmlCodeEditorComponent {
  code = model(DBML_DEFAULT_VALUE);
  placeholder = input(DBML_DEFAULT_VALUE);
  height = input('400px');

  editorTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('editorTextarea');

  highlighted = computed(() => this.prism.highlight(this.code()));
  scrollTop: WritableSignal<number> = signal(0);
  scrollLeft: WritableSignal<number> = signal(0);

  codeLines = computed<CodeLine[]>(() => {
    const lines = this.highlighted().split('\n');
    return lines.map((line, index) => ({
      number: index + 1,
      content: line || '&nbsp;',
    }));
  });

  constructor(private prism: PrismService) {}

  /*
  Sync scroll positions (X and Y) between the textarea and the highlighted code display.
  */
  handleScroll(): void {
    const textarea = this.editorTextarea()?.nativeElement;
    if (!textarea) return;
    this.scrollTop.set(textarea.scrollTop);
    this.scrollLeft.set(textarea.scrollLeft);
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
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

  /*
    Move the caret to a 1-based source line, select it and scroll it into
    view. Used by the diagnostics panel to navigate to a problem.
  */
  scrollToLine(line: number): void {
    const textarea = this.editorTextarea()?.nativeElement;
    if (!textarea) return;

    const lines = this.code().split('\n');
    const targetLine = Math.min(Math.max(line, 1), lines.length);

    // Character offset of the target line start
    let offset = 0;
    for (let i = 0; i < targetLine - 1; i++) {
      offset += lines[i].length + 1; // +1 for the newline
    }

    textarea.focus();
    textarea.setSelectionRange(
      offset,
      offset + (lines[targetLine - 1]?.length ?? 0),
    );

    // Approximate vertical scroll so the line sits near the top
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    textarea.scrollTop = Math.max(0, (targetLine - 3) * lineHeight);
    this.handleScroll();
  }
}
