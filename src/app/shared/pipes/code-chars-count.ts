import { Pipe, PipeTransform } from '@angular/core';

/*
  Returns the count of characters in the code
*/
@Pipe({ name: 'codeChars' })
export class CodeCharsPipe implements PipeTransform {
  transform(code: string | null | undefined): number {
    if (!code) return 0;

    // Exclude special characters (\n, \t, spaces)
    const cleanedCode = code.replace(/[\n\t ]/g, '');
    return cleanedCode.length;
  }
}
