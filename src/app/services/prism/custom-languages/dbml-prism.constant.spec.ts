import { describe, expect, it } from 'vitest';
import * as Prism from 'prismjs';

import './dbml-prism.constant';

describe('DBML Prism grammar', () => {
  it('highlights every enum value, including the last one', () => {
    const code = `Enum enum_role {
  neighbor
  president
  treasurer
  secretary
  admin_support
}`;

    const html = Prism.highlight(code, Prism.languages['dbml'], 'dbml');
    const enumValues = Array.from(
      html.matchAll(/token enum-value property">([^<]+)</g),
      (match) => match[1],
    );

    expect(enumValues).toEqual([
      'neighbor',
      'president',
      'treasurer',
      'secretary',
      'admin_support',
    ]);
    expect(html).toContain(
      '<span class="token enum-value property">admin_support</span>',
    );
  });
});
