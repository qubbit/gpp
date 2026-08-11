// monaco language definition for gpp: tokenizer, bracket handling and themes.

import type { Monaco } from "@monaco-editor/react";

export const LANGUAGE_ID = "gpp";

// kept in step with KEYWORDS in src/lexer.ts
const KEYWORDS = [
  "let",
  "if",
  "else",
  "while",
  "fn",
  "continue",
  "break",
  "for",
  "return",
  "true",
  "false",
  "nil",
  "from",
  "import",
  "export",
  "interface",
  "match",
];

// not keywords in the lexer, but recognised in annotation position
const TYPE_KEYWORDS = ["number", "string", "bool", "any", "void"];

// the prelude is always in scope, so highlighting it helps discoverability
const BUILTINS = [
  "println", "print", "type", "len", "push", "pop", "slice", "concat", "reverse",
  "contains", "range", "map", "filter", "reduce", "keys", "values",
  "upper", "lower", "trim", "split", "join", "str", "num",
  "abs", "min", "max", "floor", "ceil", "round", "sqrt",
  // sorting and searching
  "sort", "sort_by", "index_of", "find", "any", "all", "sum",
  "unique", "flatten", "zip",
  // objects
  "remove", "has", "merge",
  // strings
  "replace", "substring", "starts_with", "ends_with", "repeat",
  "pad_start", "pad_end", "chars", "ord", "chr",
];

// constructors from the collections module, highlighted once imported
const COLLECTIONS = [
  "stack", "queue", "set", "linked_list", "priority_queue",
];

export function registerGppLanguage(monaco: Monaco): void {
  // registering twice would stack duplicate providers on a hot reload
  if (monaco.languages.getLanguages().some((lang: { id: string }) => lang.id === LANGUAGE_ID)) return;

  monaco.languages.register({ id: LANGUAGE_ID });

  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: "//" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
    indentationRules: {
      increaseIndentPattern: /\{[^}]*$/,
      decreaseIndentPattern: /^\s*\}/,
    },
  });

  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    keywords: KEYWORDS,
    typeKeywords: TYPE_KEYWORDS,
    builtins: BUILTINS,
    collections: COLLECTIONS,

    // longest first, so `->` and `==` win over `-` and `=`
    operators: [
      "->", "==", "!=", "<=", ">=", "&&", "||",
      "+=", "-=", "*=", "/=", "%=",
      "=", "+", "-", "*", "/", "%", "<", ">", "!", "|", "&",
    ],

    symbols: /[=><!~?:&|+\-*/^%]+/,
    escapes: /\\(?:[nrt"\\])/,

    tokenizer: {
      root: [
        // a match arm arrow reads better as a keyword than an operator
        [/->/, "keyword.operator.arrow"],

        // fn name(...) — highlight the declared name
        [/(\bfn\b)(\s+)([a-zA-Z_]\w*)/, ["keyword", "white", "entity.name.function"]],

        // a name followed by ( is a call
        [/[a-zA-Z_]\w*(?=\s*\()/, {
          cases: {
            "@keywords": "keyword",
            "@builtins": "support.function",
            "@collections": "support.class",
            "@default": "entity.name.function",
          },
        }],

        // an identifier after a colon is a type annotation
        [/(:)(\s*)([a-zA-Z_]\w*)/, ["delimiter", "white", {
          cases: {
            "@typeKeywords": "type",
            "@default": "type.identifier",
          },
        }]],

        [/[a-zA-Z_]\w*/, {
          cases: {
            "@keywords": "keyword",
            "@builtins": "support.function",
            "@default": "identifier",
          },
        }],

        { include: "@whitespace" },

        [/[{}()[\]]/, "@brackets"],

        // numbers before operators so a decimal point is not an operator
        [/\d+\.\d+/, "number.float"],
        [/\d+/, "number"],

        [/[;,.]/, "delimiter"],

        [/@symbols/, {
          cases: {
            "@operators": "operator",
            "@default": "",
          },
        }],

        [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
      ],

      string: [
        // a doubled brace is a literal brace, so it must be matched first
        [/\{\{|\}\}/, "string.escape"],
        // an interpolation hole is highlighted as code, not as string
        [/\{/, { token: "delimiter.bracket", next: "@interpolation" }],
        [/[^\\"{}]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      ],

      // inside `{...}`, fall back to the root rules so the expression is
      // highlighted like ordinary code
      interpolation: [
        [/\}/, { token: "delimiter.bracket", next: "@pop" }],
        { include: "root" },
      ],

      whitespace: [
        [/[ \t\r\n]+/, "white"],
        [/\/\/.*$/, "comment"],
      ],
    },
  });

  // completions for the keywords and the prelude
  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = [
        ...KEYWORDS.map((label) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: label,
          range,
        })),
        ...BUILTINS.map((label) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: label,
          range,
        })),
        ...COLLECTIONS.map((label) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: label,
          range,
        })),
        ...TYPE_KEYWORDS.map((label) => ({
          label,
          kind: monaco.languages.CompletionItemKind.TypeParameter,
          insertText: label,
          range,
        })),
      ];

      return { suggestions };
    },
  });

  monaco.editor.defineTheme("gpp-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "c792ea", fontStyle: "bold" },
      { token: "keyword.operator.arrow", foreground: "89ddff" },
      { token: "support.function", foreground: "82aaff" },
      { token: "support.class", foreground: "7fdbca" },
      { token: "entity.name.function", foreground: "82aaff" },
      { token: "type", foreground: "ffcb6b" },
      { token: "type.identifier", foreground: "ffcb6b" },
      { token: "number", foreground: "f78c6c" },
      { token: "number.float", foreground: "f78c6c" },
      { token: "string", foreground: "c3e88d" },
      { token: "string.escape", foreground: "89ddff" },
      { token: "comment", foreground: "5c6a76", fontStyle: "italic" },
      { token: "operator", foreground: "89ddff" },
      { token: "identifier", foreground: "eeffff" },
    ],
    colors: {
      "editor.background": "#0f1720",
      "editor.foreground": "#eeffff",
      "editorLineNumber.foreground": "#3b4a5a",
      "editorLineNumber.activeForeground": "#8aa2b8",
      "editor.selectionBackground": "#1f3547",
      "editor.lineHighlightBackground": "#16202b",
      "editorCursor.foreground": "#89ddff",
      "editorWidget.background": "#16202b",
    },
  });

  monaco.editor.defineTheme("gpp-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "7c3aed", fontStyle: "bold" },
      { token: "keyword.operator.arrow", foreground: "0369a1" },
      { token: "support.function", foreground: "2563eb" },
      { token: "support.class", foreground: "0f766e" },
      { token: "entity.name.function", foreground: "2563eb" },
      { token: "type", foreground: "b45309" },
      { token: "type.identifier", foreground: "b45309" },
      { token: "number", foreground: "c2410c" },
      { token: "number.float", foreground: "c2410c" },
      { token: "string", foreground: "15803d" },
      { token: "string.escape", foreground: "0369a1" },
      { token: "comment", foreground: "94a3b8", fontStyle: "italic" },
      { token: "operator", foreground: "0369a1" },
      { token: "identifier", foreground: "0f172a" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#0f172a",
    },
  });
}
