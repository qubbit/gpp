enum TokenType {
  Identifier = "identifier",
  BinaryOperator = "binary_op", // one of +, -, *, /
  Number = "number",
  String = "string",
  Assignment = "=",
  Let = "let",
  If = "if",
  Else = "else",
  While = "while",
  Fn = "fn",
  Continue = "continue",
  Break = "break",
  For = "for",
  Return = "return",
  LParen = "(",
  RParen = ")",
  LBrace = "{",
  RBrace = "}",
  True = "true",
  False = "false",
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
};

interface Token {
  type: TokenType;
  lexeme: string;
  value: any;
}

export class Lexer {
  private tokens: Token[] = [];
  private cursor: number = 0;

  public lex(source: string): Token[] {
    let cursor = this.cursor;
    while (cursor < source.length) {
      let c = source[cursor];

      if (source.slice(cursor, cursor + 2) === "//") {
        cursor += 2;

        while (cursor < source.length && source[cursor] !== "\n") {
          cursor++;
        }
        continue;
      }

      if (/\s/.test(c)) {
        cursor++;
        continue;
      }

      if (/[0-9]/.test(c)) {
        const start = cursor;
        while (cursor < source.length && /[0-9]|\./.test(source[cursor])) {
          cursor++;
        }
        const lexeme = source.slice(start, cursor);
        this.tokens.push({ type: TokenType.Number, lexeme, value: +lexeme });
        continue;
      }

      if ('"' === c) {
        cursor++;

        const start = cursor;
        while (cursor < source.length && source[cursor] !== '"') {
          cursor++;
        }
        if (cursor >= source.length) {
          throw new Error("Unterminated string");
        }
        const value = source.slice(start, cursor);
        cursor++;
        this.tokens.push({
          type: TokenType.String,
          lexeme: source.slice(start - 1, cursor),
          value,
        });
        continue;
      }

      if ("(" == c) {
        cursor++;
        this.tokens.push({ type: TokenType.LParen, value: c, lexeme: c });
        continue;
      }
      if (")" == c) {
        cursor++;
        this.tokens.push({ type: TokenType.RParen, value: c, lexeme: c });
        continue;
      }

      if ("{" == c) {
        cursor++;
        this.tokens.push({ type: TokenType.LBrace, value: c, lexeme: c });
        continue;
      }
      if ("}" == c) {
        cursor++;
        this.tokens.push({ type: TokenType.RBrace, value: c, lexeme: c });
        continue;
      }

      if ([">", "<", "!", "|", "&", "="].includes(c)) {
        const twoCharOperator = source.slice(cursor, cursor + 2);
        if (["||", "&&", ">=", "<=", "=="].includes(twoCharOperator)) {
          cursor += 2;
          this.tokens.push({
            type: TokenType.BinaryOperator,
            value: twoCharOperator,
            lexeme: twoCharOperator,
          });
        } else if ("=" == c) {
          cursor++;
          this.tokens.push({ type: TokenType.Assignment, value: c, lexeme: c });
        } else {
          cursor++;
          this.tokens.push({
            type: TokenType.BinaryOperator,
            value: c,
            lexeme: c,
          });
        }
        continue;
      }

      if (["+", "-", "*", "/"].includes(c)) {
        cursor++;
        this.tokens.push({
          type: TokenType.BinaryOperator,
          lexeme: c,
          value: c,
        });
        continue;
      }

      if (/[_a-zA-Z]/.test(c)) {
        let identifier = "";
        while (/\w/.test(c) && cursor < source.length) {
          identifier += c;
          c = source[++cursor];
        }
        if (identifier) {
          if (Object.keys(KEYWORDS).includes(identifier)) {
            this.tokens.push({
              type: identifier as TokenType,
              value: identifier,
              lexeme: identifier,
            });
            continue;
          }
          this.tokens.push({
            type: TokenType.Identifier,
            value: identifier,
            lexeme: identifier,
          });
        }
      }
      continue;
    }
    this.cursor = cursor;
    return this.tokens;
  }
}
