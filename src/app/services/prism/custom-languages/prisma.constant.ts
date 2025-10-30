/*
  Custom Prism Language Definition for Prisma Schema

  Highlights:
  - Comments (// and ///)
  - Keywords (model, enum, datasource, generator, type)
  - Model/Enum names
  - Field types (String, Int, Boolean, DateTime, Json, etc.)
  - Attributes (@id, @default, @relation, @map, @unique, etc.)
  - Attribute functions (autoincrement(), now(), cuid(), uuid())
  - Operators (?, [], @, @@)
  - Strings and values
*/

(function (Prism: any) {
  Prism.languages.prisma = {
    // Comments
    comment: [
      {
        pattern: /\/\/\/.*$/m,
        alias: 'doc-comment',
        greedy: true,
      },
      {
        pattern: /\/\/.*$/m,
        greedy: true,
      },
    ],

    keyword: {
      pattern: /\b(model|enum|datasource|generator|type)\b/,
      greedy: true,
    },

    'block-property': {
      pattern: /\b(provider|url|output|binaryTargets|previewFeatures)\b/,
      alias: 'property',
      greedy: true,
    },

    entity: {
      pattern: /\b(model|enum|type)\s+([A-Z][a-zA-Z0-9_]*)/,
      lookbehind: true,
      greedy: true,
      inside: {
        keyword: /\b(model|enum|type)\b/,
        'class-name': {
          pattern: /[A-Z][a-zA-Z0-9_]*/,
          alias: 'class-name',
        },
      },
    },

    decorator: {
      pattern: /@{1,2}[\w.]+/,
      greedy: true,
      inside: {
        at: {
          pattern: /@{1,2}/,
          alias: 'operator',
        },
        function: {
          pattern: /[\w.]+/,
          alias: 'function',
        },
      },
    },

    'attribute-function': {
      pattern: /\b(autoincrement|now|cuid|uuid|dbgenerated|env)\s*\(/,
      greedy: true,
      inside: {
        function: /\b\w+/,
        punctuation: /\(/,
      },
    },

    type: {
      pattern:
        /\b(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes|Unsupported)\b/,
      greedy: true,
    },

    'relation-action': {
      pattern: /\b(Cascade|SetNull|Restrict|NoAction|SetDefault)\b/,
      alias: 'constant',
      greedy: true,
    },

    string: {
      pattern: /(["'`])(?:(?!\1)[^\\\r\n]|\\.)*\1/,
      greedy: true,
    },

    'env-variable': {
      pattern: /env\s*\(\s*(["']).*?\1\s*\)/,
      greedy: true,
      inside: {
        function: /env/,
        string: /(["']).*?\1/,
        punctuation: /[()]/,
      },
    },

    number: /\b\d+(?:\.\d+)?\b/,

    boolean: /\b(true|false)\b/,

    operator: /[?[\]]/,

    punctuation: /[{}(),:=]/,

    property: {
      pattern: /\b[a-z_][a-zA-Z0-9_]*\b(?=\s+\w)/,
      greedy: true,
    },

    identifier: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/,
  };
})(Prism);
