import { Injectable, signal } from '@angular/core';
import * as Prism from 'prismjs';

/*
Load languages beforehand to ensure they are registered in Prism
*/
import './custom-languages/dbml-prism.constant';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';

import {
  DEFAULT_EDITOR_LANGUAGE,
  DEFAULT_PRISM_LANGUAGE,
} from '../../shared/constants/code-language';

@Injectable({ providedIn: 'root' })
export class PrismService {
  private _initialized = signal(false);
  readonly initialized = this._initialized.asReadonly();

  readonly DEFAULT_EDITOR_LANGUAGE = DEFAULT_EDITOR_LANGUAGE;
  readonly DEFAULT_PRISM_LANGUAGE = DEFAULT_PRISM_LANGUAGE;

  constructor() {
    this.initializePrism();
  }

  private initializePrism(): void {
    this._initialized.set(true);
  }

  highlight(
    code: string,
    language: string = this.DEFAULT_EDITOR_LANGUAGE
  ): string {
    if (!Prism.languages[language]) {
      console.warn(
        `Prism language '${language}' not found, falling back to '${this.DEFAULT_PRISM_LANGUAGE}'`
      );
      language = this.DEFAULT_PRISM_LANGUAGE;
    }

    return Prism.highlight(code, Prism.languages[language], language);
  }
}
