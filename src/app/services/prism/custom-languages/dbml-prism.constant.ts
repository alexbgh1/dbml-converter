/*

  Custom Prism DBML Language Definition

  Add highlighs to:
  - Comments
  - Keywords (Table, Ref, Enum, Indexes, Note)
  - Entity names (Table names)
  - Types (int, varchar, text, timestamp, date, time, boolean, float, double, decimal, json)

*/

import * as Prism from 'prismjs';

(function (Prism: any) {
  Prism.languages.dbml = {
    comment: {
      pattern: /\/\/.*$/m,
      greedy: true,
    },
    keyword: {
      pattern: /\b(Table|Ref|Enum|Indexes|Note)\b/,
      greedy: true,
    },
    entity: {
      pattern: /\b([A-Z][a-zA-Z0-9_]*)\s*\{/,
      lookbehind: false,
      greedy: true,
      inside: {
        'entity-name': {
          pattern: /[A-Z][a-zA-Z0-9_]*/,
          alias: 'class-name',
        },
      },
    },
    type: {
      pattern:
        /\b(int|varchar|text|timestamp|date|time|boolean|float|double|decimal|json)\b/,
      greedy: true,
    },
    attribute: {
      pattern: /\[(.*?)\]/,
      greedy: true,
      inside: {
        'attribute-content': {
          pattern: /[\w\s:>]+/,
          alias: 'attr-value',
        },
        punctuation: /\[|\]/,
      },
    },
    operator: /[<>=]/,
    'enum-value': {
      // This token must run before `delimiter`; otherwise Prism removes `{`
      // first and makes the enum declaration name look like a standalone line.
      pattern: /(^[\t ]*)[a-zA-Z_][a-zA-Z0-9_]*(?=[\t ]*(?:\/\/.*)?$)/m,
      lookbehind: true,
      alias: 'property',
    },
    delimiter: /[{}()]/,
    string: {
      pattern: /(["'])(?:(?!\1).)*\1/,
      greedy: true,
    },
    property: {
      pattern: /\b([a-z][a-zA-Z0-9_]*)[\t ]+(?=\w)/,
      greedy: true,
    },
    identifier: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/,
  };
})(Prism);
