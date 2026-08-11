export enum TokenType {
  Identifier = "identifier",
  BinaryOperator = "binary_op", // one of +, -, *, /, %, and the comparison/logical ops
  Number = "number",
  String = "string",
  // a string with `{...}` holes. `value` is an InterpolationParts describing
  // the literal chunks and the raw source of each hole.
  InterpolatedString = "interpolated_string",
  Assignment = "=",
  // compound assignment (+=, -=, *=, /=); the operator is kept in `value`.
  CompoundAssignment = "compound_assign",
  Arrow = "->",
  Dot = ".",
  Semicolon = ";",
  Question = "?",
  Let = "let",
  If = "if",
  Else = "else",
  While = "while",
  Fn = "fn",
  Continue = "continue",
  Break = "break",
  For = "for",
  Return = "return",
  Colon = ":",
  LParen = "(",
  RParen = ")",
  LBrace = "{",
  RBrace = "}",
  LBracket = "[",
  RBracket = "]",
  Comma = ",",
  True = "true",
  False = "false",
  Nil = "nil",
  EOF = "eof",
  From = "from",
  Import = "import",
  Export = "export",
  Interface = "interface",
  Type = "type",
  Match = "match",
}

const KEYWORDS: Record<string, TokenType> = {
  let: TokenType.Let,
  if: TokenType.If,
  else: TokenType.Else,
  while: TokenType.While,
  fn: TokenType.Fn,
  continue: TokenType.Continue,
  break: TokenType.Break,
  for: TokenType.For,
  return: TokenType.Return,
  true: TokenType.True,
  false: TokenType.False,
  nil: TokenType.Nil,
  from: TokenType.From,
  import: TokenType.Import,
  export: TokenType.Export,
  interface: TokenType.Interface,
  type: TokenType.Type,
  match: TokenType.Match,
};

const SINGLE_CHAR_TOKENS: Record<string, TokenType> = {
  ":": TokenType.Colon,
  ";": TokenType.Semicolon,
  "?": TokenType.Question,
  ".": TokenType.Dot,
  "(": TokenType.LParen,
  ")": TokenType.RParen,
  "{": TokenType.LBrace,
  "}": TokenType.RBrace,
  "[": TokenType.LBracket,
  "]": TokenType.RBracket,
  ",": TokenType.Comma,
};

// checked before the single-character operators so that `>=` never lexes as `>` then `=`.
const TWO_CHAR_OPERATORS = ["||", "&&", ">=", "<=", "==", "!="];
// also checked before single-character operators, so `+=` never lexes as `+` then `=`.
const COMPOUND_ASSIGNMENTS = ["+=", "-=", "*=", "/=", "%="];
// `|` also separates the members of a union type; the parser reads it by lexeme.
const SINGLE_CHAR_OPERATORS = ["+", "-", "*", "/", "%", ">", "<", "!", "|", "&"];

export interface Token {
  type: TokenType;
  lexeme: string;
  value: any;
  line: number;
  column: number;
}

/**
 * a hole in an interpolated string. the lexer captures the raw source rather
 * than tokens, and the parser lexes it in turn: that keeps the token stream
 * flat, so every consumer that walks tokens stays unaware of interpolation.
 */
export interface InterpolationHole {
  source: string;
  // position of the hole's first character, so errors inside it point at the
  // real place in the outer file rather than at the string
  line: number;
  column: number;
}

/**
 * `"a {b} c"` becomes literals ["a ", " c"] and one hole. there is always
 * exactly one more literal than hole, so the two zip together as
 * literal, hole, literal, hole, ..., literal.
 */
export interface InterpolationParts {
  literals: string[];
  holes: InterpolationHole[];
}

export class LexError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "LexError";
  }
}

export class Lexer {
  private source = "";
  private tokens: Token[] = [];
  private cursor = 0;
  // start of the token currently being scanned, used to slice its lexeme.
  private start = 0;
  private line = 1;
  // offset of the current line's first character, so column = cursor - lineStart + 1.
  private lineStart = 0;

  public lex(source: string): Token[] {
    this.reset(source);

    while (!this.isAtEnd()) {
      this.start = this.cursor;
      this.scanToken();
    }

    this.start = this.cursor;
    this.addToken(TokenType.EOF, "");
    return this.tokens;
  }

  // --- primitives -----------------------------------------------------------

  /** the character at the cursor without consuming it; "" past the end. */
  private peek(offset = 0): string {
    return this.source[this.cursor + offset] ?? "";
  }

  /** consumes and returns the character at the cursor, tracking line/column. */
  private advance(): string {
    const c = this.peek();
    this.cursor++;
    if (c === "\n") {
      this.line++;
      this.lineStart = this.cursor;
    }
    return c;
  }

  /** consumes `expected` only if it is next; reports whether it was consumed. */
  private match(expected: string): boolean {
    if (this.source.startsWith(expected, this.cursor)) {
      for (let i = 0; i < expected.length; i++) this.advance();
      return true;
    }
    return false;
  }

  /** consumes characters while `predicate` holds, returning how many were eaten. */
  private advanceWhile(predicate: (c: string) => boolean): number {
    const from = this.cursor;
    while (!this.isAtEnd() && predicate(this.peek())) this.advance();
    return this.cursor - from;
  }

  private isAtEnd(): boolean {
    return this.cursor >= this.source.length;
  }

  private addToken(type: TokenType, value: any, lexeme?: string): void {
    this.tokens.push({
      type,
      lexeme: lexeme ?? this.source.slice(this.start, this.cursor),
      value,
      line: this.line,
      column: this.start - this.lineStart + 1,
    });
  }

  private error(message: string): LexError {
    return new LexError(message, this.line, this.start - this.lineStart + 1);
  }

  private reset(source: string): void {
    this.source = source;
    this.tokens = [];
    this.cursor = 0;
    this.start = 0;
    this.line = 1;
    this.lineStart = 0;
  }

  // --- scanners -------------------------------------------------------------

  private scanToken(): void {
    // comments first: `//` must win over the `/` binary operator.
    if (this.match("//")) {
      this.advanceWhile((c) => c !== "\n");
      return;
    }

    const c = this.peek();

    if (isWhitespace(c)) {
      this.advance();
      return;
    }

    if (isDigit(c)) return this.scanNumber();
    if (c === '"') return this.scanString();
    if (isIdentifierStart(c)) return this.scanIdentifier();

    const singleCharType = SINGLE_CHAR_TOKENS[c];
    if (singleCharType) {
      this.advance();
      this.addToken(singleCharType, c);
      return;
    }

    // `->` before the `-` operator, otherwise match arms lex as minus/greater-than.
    if (this.match("->")) {
      this.addToken(TokenType.Arrow, "->");
      return;
    }

    for (const op of COMPOUND_ASSIGNMENTS) {
      if (this.match(op)) {
        this.addToken(TokenType.CompoundAssignment, op);
        return;
      }
    }

    for (const op of TWO_CHAR_OPERATORS) {
      if (this.match(op)) {
        this.addToken(TokenType.BinaryOperator, op);
        return;
      }
    }

    if (this.match("=")) {
      this.addToken(TokenType.Assignment, "=");
      return;
    }

    if (SINGLE_CHAR_OPERATORS.includes(c)) {
      this.advance();
      this.addToken(TokenType.BinaryOperator, c);
      return;
    }

    // always consume, so an unknown character can never spin the loop forever.
    this.advance();
    throw this.error(`Unexpected character '${c}'`);
  }

  private scanNumber(): void {
    this.advanceWhile(isDigit);

    // a single fractional part only; a second '.' ends the number and will be
    // reported on its own rather than folded into an unparseable lexeme.
    if (this.peek() === "." && isDigit(this.peek(1))) {
      this.advance();
      this.advanceWhile(isDigit);
    }

    const lexeme = this.source.slice(this.start, this.cursor);
    this.addToken(TokenType.Number, Number(lexeme), lexeme);
  }

  private scanString(): void {
    this.advance(); // opening quote

    // literal chunks and the holes between them. a string with no holes stays
    // a plain String token, so nothing downstream changes for ordinary strings.
    const literals: string[] = [];
    const holes: InterpolationHole[] = [];
    let value = "";

    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === "\\") {
        this.advance();
        if (this.isAtEnd()) break;
        value += unescape(this.advance());
        continue;
      }

      // `{{` and `}}` are the escapes for a literal brace
      if (this.peek() === "{" && this.peek(1) === "{") {
        this.advance();
        this.advance();
        value += "{";
        continue;
      }
      if (this.peek() === "}" && this.peek(1) === "}") {
        this.advance();
        this.advance();
        value += "}";
        continue;
      }

      if (this.peek() === "{") {
        literals.push(value);
        value = "";
        holes.push(this.scanHole());
        continue;
      }

      value += this.advance();
    }

    if (this.isAtEnd()) throw this.error("Unterminated string");

    this.advance(); // closing quote

    if (holes.length === 0) {
      this.addToken(TokenType.String, value);
      return;
    }

    // one more literal than hole, so the two alternate cleanly
    literals.push(value);
    this.addToken(TokenType.InterpolatedString, { literals, holes });
  }

  /**
   * reads a `{...}` hole, returning its raw source for the parser to lex.
   *
   * finding the closing brace means tracking nesting, because a hole may hold
   * an object literal, a call, an index, or another string that itself
   * contains braces. scanning naively to the first `}` breaks on all of those.
   */
  private scanHole(): InterpolationHole {
    const openedAt = { line: this.line, column: this.cursor - this.lineStart + 1 };
    this.advance(); // the opening brace

    const start = this.cursor;
    const from = { line: this.line, column: this.cursor - this.lineStart + 1 };
    let depth = 1;

    while (!this.isAtEnd()) {
      const c = this.peek();

      // a nested string is skipped wholesale: its braces and quotes are data,
      // not structure
      if (c === '"') {
        this.skipNestedString();
        continue;
      }

      if (c === "{" || c === "[" || c === "(") depth++;
      if (c === "}" || c === "]" || c === ")") {
        depth--;
        if (depth === 0) break;
      }

      this.advance();
    }

    if (this.isAtEnd()) {
      throw new LexError(
        "Unterminated interpolation, expected '}'",
        openedAt.line,
        openedAt.column,
      );
    }

    const source = this.source.slice(start, this.cursor);
    this.advance(); // the closing brace

    if (!source.trim()) {
      throw new LexError(
        "Empty interpolation, expected an expression between the braces",
        openedAt.line,
        openedAt.column,
      );
    }

    return { source, line: from.line, column: from.column };
  }

  /** consumes a complete string literal, escapes included, without decoding it. */
  private skipNestedString(): void {
    this.advance(); // opening quote
    while (!this.isAtEnd() && this.peek() !== '"') {
      // an escaped quote does not close the string
      if (this.peek() === "\\") this.advance();
      if (this.isAtEnd()) break;
      this.advance();
    }
    if (!this.isAtEnd()) this.advance(); // closing quote
  }

  private scanIdentifier(): void {
    this.advanceWhile(isIdentifierPart);
    const identifier = this.source.slice(this.start, this.cursor);
    this.addToken(KEYWORDS[identifier] ?? TokenType.Identifier, identifier);
  }
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\r" || c === "\n";
}

function isIdentifierStart(c: string): boolean {
  return c === "_" || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

function isIdentifierPart(c: string): boolean {
  return isIdentifierStart(c) || isDigit(c);
}

function unescape(c: string): string {
  switch (c) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    default:
      return c; // covers \" and \\
  }
}
