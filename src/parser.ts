import { TokenType, type Token } from "./lexer.js";
import type {
  ArrayLiteral,
  ArrayPattern,
  BlockStatement,
  Expression,
  ExportStatement,
  FunctionDeclaration,
  Identifier,
  IfStatement,
  ImportStatement,
  ImportSpecifier,
  InterfaceDeclaration,
  MatchArm,
  MatchExpression,
  MemberExpression,
  IndexExpression,
  ObjectLiteral,
  ObjectPattern,
  ObjectPatternField,
  ObjectProperty,
  Parameter,
  Pattern,
  Program,
  Statement,
  TypeField,
  TypeNode,
} from "./ast.js";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "ParseError";
  }
}

// binding powers for the binary operators, loosest first. the pratt loop in
// parseBinary uses these to shape the tree without one method per level.
const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

// tokens that may begin a statement, used to resynchronise after an error.
const STATEMENT_START = new Set([
  TokenType.Let,
  TokenType.If,
  TokenType.While,
  TokenType.For,
  TokenType.Fn,
  TokenType.Return,
  TokenType.Break,
  TokenType.Continue,
  TokenType.Interface,
  TokenType.From,
  TokenType.Import,
  TokenType.Export,
]);

export class Parser {
  private tokens: Token[] = [];
  private cursor = 0;
  // while true a bare `{` ends the current expression instead of starting an
  // object literal. set for the header expressions of if/while/for/match, whose
  // `{` opens a body.
  private noBrace = false;
  // while true an expression cannot be continued by an operator on a later
  // line. set for match arm bodies, where the next line starts a new arm.
  private singleLine = false;

  public parse(tokens: Token[]): Program {
    this.tokens = tokens;
    this.cursor = 0;

    const start = this.peek();
    const body: Statement[] = [];
    while (!this.isAtEnd()) {
      // tolerate stray separators between statements
      if (this.match(TokenType.Semicolon)) continue;
      body.push(this.parseStatement());
    }

    return {
      kind: "program",
      body,
      line: start.line,
      column: start.column,
    };
  }

  // --- primitives -----------------------------------------------------------

  /** the token at the cursor without consuming it. */
  private peek(offset = 0): Token {
    const index = this.cursor + offset;
    // the token stream always ends with eof, so clamping yields a real token
    // and callers never have to null-check.
    return this.tokens[Math.min(index, this.tokens.length - 1)]!;
  }

  /** consumes and returns the current token. */
  private advance(): Token {
    const token = this.peek();
    if (!this.isAtEnd()) this.cursor++;
    return token;
  }

  /** true when the current token is of `type`, without consuming it. */
  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  /** consumes the current token only if it matches one of `types`. */
  private match(...types: TokenType[]): boolean {
    if (types.some((type) => this.check(type))) {
      this.advance();
      return true;
    }
    return false;
  }

  /** consumes a token of `type` or fails with a positioned error. */
  private expect(type: TokenType, context: string): Token {
    if (this.check(type)) return this.advance();
    const found = this.isAtEnd() ? "end of input" : `'${this.peek().lexeme}'`;
    throw this.error(`Expected ${type} ${context}, found ${found}`);
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private error(message: string, token: Token = this.peek()): ParseError {
    return new ParseError(message, token.line, token.column);
  }

  /**
   * statements are newline-terminated; semicolons are optional. the lexer drops
   * newlines, so a statement boundary is inferred from a line change instead.
   */
  private endStatement(): void {
    if (this.match(TokenType.Semicolon)) return;
    if (this.isAtEnd() || this.check(TokenType.RBrace)) return;
    const previous = this.peek(-1);
    if (this.peek().line > previous.line) return;
    throw this.error(
      `Expected end of statement, found '${this.peek().lexeme}'`,
    );
  }

  /** discards tokens until the next plausible statement boundary. */
  private synchronize(): void {
    while (!this.isAtEnd()) {
      if (this.peek(-1).type === TokenType.Semicolon) return;
      if (STATEMENT_START.has(this.peek().type)) return;
      this.advance();
    }
  }

  // --- statements -----------------------------------------------------------

  private parseStatement(): Statement {
    if (this.check(TokenType.Let)) return this.parseLet();
    if (this.check(TokenType.If)) return this.parseIf();
    if (this.check(TokenType.While)) return this.parseWhile();
    if (this.check(TokenType.For)) return this.parseFor();
    if (this.check(TokenType.Interface)) return this.parseInterface();
    if (this.check(TokenType.From) || this.check(TokenType.Import)) {
      return this.parseImport();
    }
    if (this.check(TokenType.Export)) return this.parseExport();
    if (this.check(TokenType.Return)) return this.parseReturn();

    if (this.check(TokenType.Break)) {
      const token = this.advance();
      this.endStatement();
      return { kind: "break_statement", line: token.line, column: token.column };
    }
    if (this.check(TokenType.Continue)) {
      const token = this.advance();
      this.endStatement();
      return {
        kind: "continue_statement",
        line: token.line,
        column: token.column,
      };
    }

    // `fn name(...)` declares; a bare `fn(...)` is an expression.
    if (this.check(TokenType.Fn) && this.peek(1).type === TokenType.Identifier) {
      return this.parseFunctionDeclaration();
    }

    // in statement position `{` opens a block, never an object literal.
    if (this.check(TokenType.LBrace)) return this.parseBlock();

    return this.parseExpressionOrAssignment();
  }

  private parseLet(): Statement {
    const token = this.expect(TokenType.Let, "to start a declaration");
    const target = this.parsePattern();

    const typeAnnotation = this.match(TokenType.Colon)
      ? this.parseType()
      : null;

    const value = this.match(TokenType.Assignment)
      ? this.parseExpression()
      : null;

    this.endStatement();
    return {
      kind: "let_statement",
      target,
      typeAnnotation,
      value,
      line: token.line,
      column: token.column,
    };
  }

  private parseExpressionOrAssignment(): Statement {
    const token = this.peek();
    const expression = this.parseExpression();

    if (this.check(TokenType.Assignment) || this.check(TokenType.CompoundAssignment)) {
      const operator = this.advance();
      if (
        expression.kind !== "identifier" &&
        expression.kind !== "member_expression" &&
        expression.kind !== "index_expression"
      ) {
        throw this.error("Invalid assignment target", token);
      }
      const value = this.parseExpression();
      this.endStatement();
      return {
        kind: "assignment_statement",
        target: expression as Identifier | MemberExpression | IndexExpression,
        operator: operator.lexeme,
        value,
        line: token.line,
        column: token.column,
      };
    }

    this.endStatement();
    return {
      kind: "expression_statement",
      expression,
      line: token.line,
      column: token.column,
    };
  }

  private parseBlock(): BlockStatement {
    const token = this.expect(TokenType.LBrace, "to open a block");
    const body: Statement[] = [];

    while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
      if (this.match(TokenType.Semicolon)) continue;
      try {
        body.push(this.parseStatement());
      } catch (error) {
        if (!(error instanceof ParseError)) throw error;
        // resynchronise so one bad statement does not cascade
        this.synchronize();
        if (this.check(TokenType.RBrace) || this.isAtEnd()) break;
        throw error;
      }
    }

    this.expect(TokenType.RBrace, "to close a block");
    return {
      kind: "block_statement",
      body,
      line: token.line,
      column: token.column,
    };
  }

  private parseIf(): IfStatement {
    const token = this.expect(TokenType.If, "to start an if statement");
    // parentheses around the condition are optional
    const condition = this.parseHeaderExpression();
    const consequent = this.parseBlock();

    let alternate: BlockStatement | IfStatement | null = null;
    if (this.match(TokenType.Else)) {
      alternate = this.check(TokenType.If) ? this.parseIf() : this.parseBlock();
    }

    return {
      kind: "if_statement",
      condition,
      consequent,
      alternate,
      line: token.line,
      column: token.column,
    };
  }

  private parseWhile(): Statement {
    const token = this.expect(TokenType.While, "to start a while loop");
    const condition = this.parseHeaderExpression();
    const body = this.parseBlock();
    return {
      kind: "while_statement",
      condition,
      body,
      line: token.line,
      column: token.column,
    };
  }

  private parseFor(): Statement {
    const token = this.expect(TokenType.For, "to start a for loop");
    const binding = this.expect(TokenType.Identifier, "as the loop variable");
    const inKeyword = this.expect(TokenType.Identifier, "after the loop variable");
    if (inKeyword.lexeme !== "in") {
      throw this.error("Expected 'in' in for loop", inKeyword);
    }
    const iterable = this.parseHeaderExpression();
    const body = this.parseBlock();
    return {
      kind: "for_statement",
      binding: binding.lexeme,
      iterable,
      body,
      line: token.line,
      column: token.column,
    };
  }

  private parseFunctionDeclaration(): FunctionDeclaration {
    const token = this.expect(TokenType.Fn, "to start a function");
    const name = this.expect(TokenType.Identifier, "as the function name");
    const params = this.parseParameters();
    const returnType = this.match(TokenType.Colon) ? this.parseType() : null;
    const body = this.parseBlock();

    return {
      kind: "function_declaration",
      name: name.lexeme,
      params,
      returnType,
      body,
      line: token.line,
      column: token.column,
    };
  }

  private parseParameters(): Parameter[] {
    this.expect(TokenType.LParen, "to open the parameter list");
    const params: Parameter[] = [];

    while (!this.check(TokenType.RParen) && !this.isAtEnd()) {
      const name = this.expect(TokenType.Identifier, "as a parameter name");
      const type = this.match(TokenType.Colon) ? this.parseType() : null;
      params.push({
        name: name.lexeme,
        type,
        line: name.line,
        column: name.column,
      });
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RParen, "to close the parameter list");
    return params;
  }

  private parseReturn(): Statement {
    const token = this.expect(TokenType.Return, "to start a return");

    // a value must begin on the same line, otherwise this is a bare return
    const hasValue =
      !this.check(TokenType.RBrace) &&
      !this.check(TokenType.Semicolon) &&
      !this.isAtEnd() &&
      this.peek().line === token.line;

    const value = hasValue ? this.parseExpression() : null;
    this.endStatement();
    return {
      kind: "return_statement",
      value,
      line: token.line,
      column: token.column,
    };
  }

  private parseInterface(): InterfaceDeclaration {
    const token = this.expect(TokenType.Interface, "to start an interface");
    const name = this.expect(TokenType.Identifier, "as the interface name");
    this.expect(TokenType.LBrace, "to open the interface body");

    const fields: TypeField[] = [];
    while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
      if (this.match(TokenType.Semicolon) || this.match(TokenType.Comma)) continue;
      const fieldName = this.expect(TokenType.Identifier, "as a field name");
      // `name?: type` marks the field optional
      const optional = this.match(TokenType.Question);
      this.expect(TokenType.Colon, "after a field name");
      const type = this.parseType();
      fields.push({
        name: fieldName.lexeme,
        type,
        optional,
        line: fieldName.line,
        column: fieldName.column,
      });
    }

    this.expect(TokenType.RBrace, "to close the interface body");
    return {
      kind: "interface_declaration",
      name: name.lexeme,
      fields,
      line: token.line,
      column: token.column,
    };
  }

  /** `from source import a, b` and the bare `import a, b` form. */
  private parseImport(): ImportStatement {
    const token = this.peek();
    let source = "";

    if (this.match(TokenType.From)) {
      // the module is either a bare name or a quoted path
      if (this.check(TokenType.String)) {
        source = this.advance().value;
      } else {
        source = this.expect(TokenType.Identifier, "as the module name").lexeme;
      }
      this.expect(TokenType.Import, "after the module name");
    } else {
      this.expect(TokenType.Import, "to start an import");
    }

    const names: ImportSpecifier[] = [];
    do {
      // keywords double as importable names (`type` in the prelude)
      const specifier = this.advance();
      names.push({
        name: specifier.lexeme,
        line: specifier.line,
        column: specifier.column,
      });
    } while (this.match(TokenType.Comma));

    this.endStatement();
    return {
      kind: "import_statement",
      source,
      names,
      line: token.line,
      column: token.column,
    };
  }

  private parseExport(): ExportStatement {
    const token = this.expect(TokenType.Export, "to start an export");
    const names: string[] = [];
    do {
      names.push(this.expect(TokenType.Identifier, "as an exported name").lexeme);
    } while (this.match(TokenType.Comma));

    this.endStatement();
    return {
      kind: "export_statement",
      names,
      line: token.line,
      column: token.column,
    };
  }

  // --- expressions ----------------------------------------------------------

  private parseExpression(): Expression {
    return this.parseBinary(0);
  }

  /**
   * parses a header expression, where a following `{` opens a body rather than
   * an object literal. `if x {`, `match f(x) {` and friends rely on this;
   * parenthesising the header still allows an object literal inside.
   *
   * a `{` in the very first position is unambiguous: the body brace cannot come
   * before the header, so it must open an object literal.
   */
  private parseHeaderExpression(): Expression {
    if (this.check(TokenType.LBrace)) {
      const object = this.withNoBrace(false, () => this.parseObjectLiteral());
      // the object may still be the left side of a larger header expression
      return this.withNoBrace(true, () => this.parseBinaryFrom(object, 0));
    }
    return this.withNoBrace(true, () => this.parseExpression());
  }

  /**
   * runs `body` with the no-brace rule forced on or off. inside brackets,
   * parentheses and argument lists the rule is lifted, so `if f({a: 1}) {`
   * still reads the inner braces as an object literal.
   */
  private withNoBrace<T>(value: boolean, body: () => T): T {
    const previous = this.noBrace;
    this.noBrace = value;
    try {
      return body();
    } finally {
      this.noBrace = previous;
    }
  }

  /**
   * parses an expression nested inside a delimiter, where both the no-brace and
   * single-line rules are lifted: the closing delimiter marks the end, so an
   * argument or element may span lines and contain object literals.
   */
  private parseNestedExpression(): Expression {
    const previousSingleLine = this.singleLine;
    this.singleLine = false;
    try {
      return this.withNoBrace(false, () => this.parseExpression());
    } finally {
      this.singleLine = previousSingleLine;
    }
  }

  /** parses a match arm body, which ends at the newline before the next arm. */
  private parseArmBody(): Expression {
    const previousSingleLine = this.singleLine;
    this.singleLine = true;
    try {
      return this.withNoBrace(false, () => this.parseExpression());
    } finally {
      this.singleLine = previousSingleLine;
    }
  }

  /**
   * precedence climbing: parse a unary operand, then keep absorbing operators
   * that bind at least as tightly as `minPrecedence`.
   */
  private parseBinary(minPrecedence: number): Expression {
    return this.parseBinaryFrom(this.parseUnary(), minPrecedence);
  }

  /** continues a binary expression from an already parsed left operand. */
  private parseBinaryFrom(
    initial: Expression,
    minPrecedence: number,
  ): Expression {
    let left = initial;

    while (this.check(TokenType.BinaryOperator)) {
      const operator = this.peek().lexeme;
      const precedence = BINARY_PRECEDENCE[operator];
      if (precedence === undefined || precedence < minPrecedence) break;

      // inside a match body a leading `-` on the next line starts the next
      // arm's pattern, so the operator must not continue this expression.
      if (this.singleLine && this.peek().line > this.peek(-1).line) break;

      this.advance();
      // all binary operators here are left-associative, so the right operand
      // binds one level tighter
      const right = this.parseBinary(precedence + 1);

      left =
        operator === "&&" || operator === "||"
          ? {
              kind: "logical_expression",
              operator,
              left,
              right,
              line: left.line,
              column: left.column,
            }
          : {
              kind: "binary_expression",
              operator,
              left,
              right,
              line: left.line,
              column: left.column,
            };
    }

    return left;
  }

  private parseUnary(): Expression {
    if (this.check(TokenType.BinaryOperator)) {
      const lexeme = this.peek().lexeme;
      if (lexeme === "-" || lexeme === "!") {
        const token = this.advance();
        return {
          kind: "unary_expression",
          operator: lexeme,
          operand: this.parseUnary(),
          line: token.line,
          column: token.column,
        };
      }
    }
    return this.parseCallOrAccess();
  }

  /** applies the postfix operators: calls, dot access and indexing. */
  private parseCallOrAccess(): Expression {
    let expression = this.parsePrimary();

    for (;;) {
      // `(` and `[` only continue the expression on the same line. across a
      // newline they start a new statement, so `f(x)` followed by `[1,2] -> ...`
      // is two constructs rather than an index into the call's result.
      const sameLine = this.peek().line === this.peek(-1).line;

      if (sameLine && this.check(TokenType.LParen)) {
        this.advance();
        const args: Expression[] = [];
        while (!this.check(TokenType.RParen) && !this.isAtEnd()) {
          args.push(this.parseNestedExpression());
          if (!this.match(TokenType.Comma)) break;
        }
        this.expect(TokenType.RParen, "to close the argument list");
        expression = {
          kind: "call_expression",
          callee: expression,
          args,
          line: expression.line,
          column: expression.column,
        };
      } else if (this.match(TokenType.Dot)) {
        const property = this.expect(TokenType.Identifier, "after '.'");
        expression = {
          kind: "member_expression",
          object: expression,
          property: property.lexeme,
          line: expression.line,
          column: expression.column,
        };
      } else if (sameLine && this.check(TokenType.LBracket)) {
        this.advance();
        const index = this.parseNestedExpression();
        this.expect(TokenType.RBracket, "to close an index");
        expression = {
          kind: "index_expression",
          object: expression,
          index,
          line: expression.line,
          column: expression.column,
        };
      } else {
        return expression;
      }
    }
  }

  private parsePrimary(): Expression {
    const token = this.peek();

    switch (token.type) {
      case TokenType.Number:
        this.advance();
        return {
          kind: "number_literal",
          value: token.value,
          line: token.line,
          column: token.column,
        };

      case TokenType.String:
        this.advance();
        return {
          kind: "string_literal",
          value: token.value,
          line: token.line,
          column: token.column,
        };

      case TokenType.True:
      case TokenType.False:
        this.advance();
        return {
          kind: "boolean_literal",
          value: token.type === TokenType.True,
          line: token.line,
          column: token.column,
        };

      case TokenType.Nil:
        this.advance();
        return {
          kind: "nil_literal",
          line: token.line,
          column: token.column,
        };

      case TokenType.Identifier:
        this.advance();
        return {
          kind: "identifier",
          name: token.lexeme,
          line: token.line,
          column: token.column,
        };

      case TokenType.LParen: {
        this.advance();
        const inner = this.parseNestedExpression();
        this.expect(TokenType.RParen, "to close a grouped expression");
        return inner;
      }

      case TokenType.LBracket:
        return this.parseArrayLiteral();

      case TokenType.LBrace:
        // in a header position this brace belongs to the enclosing body
        if (this.noBrace) {
          throw this.error(`Unexpected token '${token.lexeme}' in expression`);
        }
        return this.parseObjectLiteral();

      case TokenType.Match:
        return this.parseMatch();

      case TokenType.Fn:
        return this.parseFunctionExpression();

      default:
        throw this.error(`Unexpected token '${token.lexeme}' in expression`);
    }
  }

  private parseArrayLiteral(): ArrayLiteral {
    const token = this.expect(TokenType.LBracket, "to open an array");
    const elements: Expression[] = [];

    while (!this.check(TokenType.RBracket) && !this.isAtEnd()) {
      elements.push(this.parseNestedExpression());
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RBracket, "to close an array");
    return {
      kind: "array_literal",
      elements,
      line: token.line,
      column: token.column,
    };
  }

  private parseObjectLiteral(): ObjectLiteral {
    const token = this.expect(TokenType.LBrace, "to open an object");
    const properties: ObjectProperty[] = [];

    while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
      const key = this.expect(TokenType.Identifier, "as a property name");

      if (this.match(TokenType.Colon)) {
        properties.push({
          key: key.lexeme,
          value: this.parseNestedExpression(),
          shorthand: false,
          line: key.line,
          column: key.column,
        });
      } else {
        // `{ a }` is shorthand for `{ a: a }`
        properties.push({
          key: key.lexeme,
          value: {
            kind: "identifier",
            name: key.lexeme,
            line: key.line,
            column: key.column,
          },
          shorthand: true,
          line: key.line,
          column: key.column,
        });
      }

      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RBrace, "to close an object");
    return {
      kind: "object_literal",
      properties,
      line: token.line,
      column: token.column,
    };
  }

  private parseFunctionExpression(): Expression {
    const token = this.expect(TokenType.Fn, "to start a function");
    const name = this.check(TokenType.Identifier)
      ? this.advance().lexeme
      : null;
    const params = this.parseParameters();
    const returnType = this.match(TokenType.Colon) ? this.parseType() : null;
    const body = this.parseBlock();

    return {
      kind: "function_expression",
      name,
      params,
      returnType,
      body,
      line: token.line,
      column: token.column,
    };
  }

  private parseMatch(): MatchExpression {
    const token = this.expect(TokenType.Match, "to start a match");
    const subject = this.parseHeaderExpression();
    this.expect(TokenType.LBrace, "to open the match body");

    const arms: MatchArm[] = [];
    while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
      if (this.match(TokenType.Semicolon) || this.match(TokenType.Comma)) continue;

      const armStart = this.peek();
      const pattern = this.parsePattern();
      // an arm guard reuses `if`; it is unambiguous because a guard can only
      // appear between a pattern and its arrow.
      const guard = this.match(TokenType.If)
        ? this.withNoBrace(true, () => this.parseExpression())
        : null;
      this.expect(TokenType.Arrow, "after a match pattern");
      const body = this.check(TokenType.LBrace)
        ? this.parseBlock()
        : this.parseArmBody();

      arms.push({
        pattern,
        guard,
        body,
        line: armStart.line,
        column: armStart.column,
      });
    }

    this.expect(TokenType.RBrace, "to close the match body");
    return {
      kind: "match_expression",
      subject,
      arms,
      line: token.line,
      column: token.column,
    };
  }

  // --- patterns -------------------------------------------------------------

  private parsePattern(): Pattern {
    const token = this.peek();

    switch (token.type) {
      case TokenType.Number:
        this.advance();
        return {
          kind: "literal_pattern",
          value: token.value,
          line: token.line,
          column: token.column,
        };

      case TokenType.String:
        this.advance();
        return {
          kind: "literal_pattern",
          value: token.value,
          line: token.line,
          column: token.column,
        };

      case TokenType.True:
      case TokenType.False:
        this.advance();
        return {
          kind: "literal_pattern",
          value: token.type === TokenType.True,
          line: token.line,
          column: token.column,
        };

      case TokenType.Nil:
        this.advance();
        return {
          kind: "literal_pattern",
          value: null,
          line: token.line,
          column: token.column,
        };

      case TokenType.BinaryOperator:
        // negative number literals in pattern position
        if (token.lexeme === "-" && this.peek(1).type === TokenType.Number) {
          this.advance();
          const number = this.advance();
          return {
            kind: "literal_pattern",
            value: -number.value,
            line: token.line,
            column: token.column,
          };
        }
        throw this.error(`Unexpected token '${token.lexeme}' in pattern`);

      case TokenType.Identifier:
        this.advance();
        // `_` matches without binding
        if (token.lexeme === "_") {
          return {
            kind: "wildcard_pattern",
            line: token.line,
            column: token.column,
          };
        }
        return {
          kind: "binding_pattern",
          name: token.lexeme,
          line: token.line,
          column: token.column,
        };

      case TokenType.LBracket:
        return this.parseArrayPattern();

      case TokenType.LBrace:
        return this.parseObjectPattern();

      default:
        throw this.error(`Unexpected token '${token.lexeme}' in pattern`);
    }
  }

  private parseArrayPattern(): ArrayPattern {
    const token = this.expect(TokenType.LBracket, "to open an array pattern");
    const elements: Pattern[] = [];
    let rest: string | null = null;

    while (!this.check(TokenType.RBracket) && !this.isAtEnd()) {
      if (this.matchRest()) {
        rest = this.expect(TokenType.Identifier, "after '...'").lexeme;
        break;
      }
      elements.push(this.parsePattern());
      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RBracket, "to close an array pattern");
    return {
      kind: "array_pattern",
      elements,
      rest,
      line: token.line,
      column: token.column,
    };
  }

  private parseObjectPattern(): ObjectPattern {
    const token = this.expect(TokenType.LBrace, "to open an object pattern");
    const fields: ObjectPatternField[] = [];
    let rest: string | null = null;

    while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
      if (this.matchRest()) {
        rest = this.expect(TokenType.Identifier, "after '...'").lexeme;
        break;
      }

      const key = this.expect(TokenType.Identifier, "as a pattern field name");
      // `{a}` binds `a`; `{a: pattern}` matches the property against a pattern
      const value: Pattern = this.match(TokenType.Colon)
        ? this.parsePattern()
        : {
            kind: "binding_pattern",
            name: key.lexeme,
            line: key.line,
            column: key.column,
          };

      fields.push({
        key: key.lexeme,
        value,
        line: key.line,
        column: key.column,
      });

      if (!this.match(TokenType.Comma)) break;
    }

    this.expect(TokenType.RBrace, "to close an object pattern");
    return {
      kind: "object_pattern",
      fields,
      rest,
      line: token.line,
      column: token.column,
    };
  }

  /** the lexer emits `...` as three dots, so rest syntax is matched here. */
  private matchRest(): boolean {
    if (
      this.check(TokenType.Dot) &&
      this.peek(1).type === TokenType.Dot &&
      this.peek(2).type === TokenType.Dot
    ) {
      this.advance();
      this.advance();
      this.advance();
      return true;
    }
    return false;
  }

  // --- types ----------------------------------------------------------------

  /** a type is one or more alternatives separated by `|`. */
  private parseType(): TypeNode {
    const first = this.parseTypeSuffix();
    if (!this.isUnionBar()) return first;

    const options: TypeNode[] = [first];
    while (this.isUnionBar()) {
      this.advance();
      options.push(this.parseTypeSuffix());
    }

    return {
      kind: "union_type",
      options,
      line: first.line,
      column: first.column,
    };
  }

  // `|` arrives as a binary operator token, so unions are detected by lexeme.
  private isUnionBar(): boolean {
    return this.check(TokenType.BinaryOperator) && this.peek().lexeme === "|";
  }

  /** applies trailing `[]` to make array types. */
  private parseTypeSuffix(): TypeNode {
    let type = this.parseTypePrimary();

    while (this.check(TokenType.LBracket)) {
      this.advance();
      this.expect(TokenType.RBracket, "to close an array type");
      type = {
        kind: "array_type",
        element: type,
        line: type.line,
        column: type.column,
      };
    }

    return type;
  }

  private parseTypePrimary(): TypeNode {
    const token = this.peek();

    // `fn(number, number): number`
    if (this.check(TokenType.Fn)) {
      this.advance();
      this.expect(TokenType.LParen, "to open a function type");
      const params: TypeNode[] = [];
      while (!this.check(TokenType.RParen) && !this.isAtEnd()) {
        params.push(this.parseType());
        if (!this.match(TokenType.Comma)) break;
      }
      this.expect(TokenType.RParen, "to close a function type");
      this.expect(TokenType.Colon, "before a function return type");
      const returns = this.parseType();
      return {
        kind: "function_type",
        params,
        returns,
        line: token.line,
        column: token.column,
      };
    }

    // inline object type: `{ x: number, y: number }`
    if (this.check(TokenType.LBrace)) {
      this.advance();
      const fields: TypeField[] = [];
      while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
        if (this.match(TokenType.Semicolon) || this.match(TokenType.Comma)) continue;
        const name = this.expect(TokenType.Identifier, "as a field name");
        const optional = this.match(TokenType.Question);
        this.expect(TokenType.Colon, "after a field name");
        fields.push({
          name: name.lexeme,
          type: this.parseType(),
          optional,
          line: name.line,
          column: name.column,
        });
      }
      this.expect(TokenType.RBrace, "to close an object type");
      return {
        kind: "object_type",
        fields,
        line: token.line,
        column: token.column,
      };
    }

    // `nil` is a keyword rather than an identifier, but it names a type too,
    // which is what makes `number | nil` writable
    if (this.check(TokenType.Identifier) || this.check(TokenType.Nil)) {
      this.advance();
      return {
        kind: "named_type",
        name: token.lexeme,
        line: token.line,
        column: token.column,
      };
    }

    throw this.error(`Expected a type, found '${token.lexeme}'`);
  }
}

/** convenience wrapper: tokens in, program out. */
export function parse(tokens: Token[]): Program {
  return new Parser().parse(tokens);
}

export default parse;
