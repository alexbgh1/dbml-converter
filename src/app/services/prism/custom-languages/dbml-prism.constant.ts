/*

  Custom Prism DBML Language Definition

  Add highlighs to:
  - Comments
  - Keywords (Table, Ref, Enum, Indexes, Note)
  - Entity names (Table names)
  - Types (int, varchar, text, timestamp, date, time, boolean, float, double, decimal, json)

*/

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
    delimiter: /[{}()]/,
    string: {
      pattern: /(["'])(?:(?!\1).)*\1/,
      greedy: true,
    },
    property: {
      pattern: /\b([a-z][a-zA-Z0-9_]*)\s+(?=\w)/,
      greedy: true,
    },
    identifier: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/,
  };
})(Prism);
