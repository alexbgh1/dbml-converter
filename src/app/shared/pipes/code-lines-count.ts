import { Pipe, PipeTransform } from '@angular/core';

/*
  Returns the count of lines in the code (primary size metric in the
  explorer; the char count stays as a secondary, de-emphasized signal)
*/
@Pipe({ name: 'codeLines' })
export class CodeLinesPipe implements PipeTransform {
  transform(code: string | null | undefined): number {
    if (!code) return 0;
    return code.split('\n').length;
  }
}
