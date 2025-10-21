import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  AfterViewInit,
  viewChild,
  signal,
  effect,
  WritableSignal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DBML_DEFAULT_VALUE } from '../../constants';
import { PrismService } from '../../../../services/prism/prism.service';

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
export class DbmlCodeEditorComponent implements OnChanges, AfterViewInit {
  @Input() code: string = DBML_DEFAULT_VALUE;
  @Input() placeholder: string = DBML_DEFAULT_VALUE;
  @Input() height: string = '400px';
  @Output() codeChange = new EventEmitter<string>();

  editorTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('editorTextarea');
  highlightWrapper = viewChild<ElementRef<HTMLDivElement>>('highlightWrapper');
  outputElement = viewChild<ElementRef<HTMLPreElement>>('outputElement');
  editorContainer = viewChild<ElementRef<HTMLDivElement>>('editorContainer');

  highlighted: WritableSignal<string> = signal('');
  scrollTop: WritableSignal<number> = signal(0);
  scrollLeft: WritableSignal<number> = signal(0);
  private isScrolling: WritableSignal<boolean> = signal(false);

  ngAfterViewInit(): void {
    this.syncHighlighting();
  }

  handleScroll(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.scrollTop.set(textarea.scrollTop);
    this.scrollLeft.set(textarea.scrollLeft);
    this.syncHighlighting();
  }

  onCodeChange(): void {
    this.highlightCode();
    this.codeChange.emit(this.code);

    requestAnimationFrame(() => this.syncHighlighting());
  }

  private syncHighlighting(): void {
    const textarea = this.editorTextarea()?.nativeElement;
    const output = this.outputElement()?.nativeElement;

    if (!textarea || !output) return;

    output.style.width = textarea.scrollWidth + 'px';
    output.style.height = textarea.scrollHeight + 'px';
  }

  constructor(private prism: PrismService) {
    effect(() => {
      const textarea = this.editorTextarea();
      if (textarea) {
        textarea.nativeElement.focus();
      }
    });

    effect(() => {
      const textarea = this.editorTextarea();
      const output = this.outputElement();

      if (textarea && output) {
        this.syncHighlighting();
      }
    });
  }

  handleContainerScroll(event: Event): void {
    if (this.isScrolling()) return;

    this.isScrolling.set(true);
    const target = event.target as HTMLElement;
    this.scrollTop.set(target.scrollTop);
    this.scrollLeft.set(target.scrollLeft);

    requestAnimationFrame(() => {
      this.isScrolling.set(false);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['code']) {
      this.highlightCode();
    }
  }

  onSelectionChange(): void {
    requestAnimationFrame(() => {
      const textarea = this.editorTextarea()?.nativeElement;
      if (textarea) {
        this.scrollTop.set(textarea.scrollTop);
        this.scrollLeft.set(textarea.scrollLeft);
      }
    });
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();

      const textarea = event.target as HTMLTextAreaElement;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const tabChar = '\t';

      this.code =
        this.code.substring(0, start) + tabChar + this.code.substring(end);

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd =
          start + tabChar.length;
        this.onCodeChange();
      }, 0);
    }
  }

  private highlightCode(): void {
    this.highlighted.set(this.prism.highlight(this.code));
  }
}
