import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Lexer, LexError, TokenType, type Token } from "../lexer.js";

// helpers ---------------------------------------------------------------------

/** lexes and drops the trailing eof, which every stream ends with. */
function lex(source: string): Token[] {
  return new Lexer().lex(source).slice(0, -1);
}

/** renders each token as `type(lexeme)` so assertions read like the source. */
function shapes(source: string): string[] {
  return lex(source).map((t) => `${t.type}(${t.lexeme})`);
}

function lexemes(source: string): string[] {
  return lex(source).map((t) => t.lexeme);
}

function types(source: string): TokenType[] {
  return lex(source).map((t) => t.type);
}

function values(source: string): unknown[] {
  return lex(source).map((t) => t.value);
}

/** the message of the error a source raises, or null when it lexes cleanly. */
function errorOf(source: string): string | null {
  try {
    new Lexer().lex(source);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

// tests -----------------------------------------------------------------------

describe("regressions", () => {
  // an unrecognised character used to hit a `continue` that never advanced the
  // cursor, so a single comma hung the process forever.
  test("an unknown character terminates instead of looping", () => {
    assert.equal(errorOf("a @ b"), "Unexpected character '@' (line 1, column 3)");
  });

  test("every unknown character is consumed before throwing", () => {
    // if any of these failed to advance the cursor the call would not return
    for (const char of ["@", "#", "$", "~", "'", "`", "\\"]) {
      assert.match(errorOf(`a ${char} b`) ?? "", /Unexpected character/);
    }
  });

  // cursor and tokens persisted across calls, so a second lex() started past the
  // end of the new source and replayed the first call's tokens.
  test("an instance can lex more than once", () => {
    const lexer = new Lexer();
    assert.deepEqual(
      lexer.lex("let a = 1").map((t) => t.lexeme),
      ["let", "a", "=", "1", ""],
    );
    assert.deepEqual(
      lexer.lex("let b = 2").map((t) => t.lexeme),
      ["let", "b", "=", "2", ""],
    );
  });

  test("repeated lexing of the same source is stable", () => {
    const lexer = new Lexer();
    const once = lexer.lex("f(x) + 1").map((t) => t.lexeme);
    const twice = lexer.lex("f(x) + 1").map((t) => t.lexeme);
    assert.deepEqual(once, twice);
  });

  // `1.2.3` used to fold into one lexeme and produce a silent NaN
  test("a malformed number never becomes a silent NaN", () => {
    assert.deepEqual(values("1.2.3"), [1.2, ".", 3]);
    for (const token of lex("1.2.3")) {
      assert.ok(!Number.isNaN(token.value), `${token.lexeme} produced NaN`);
    }
  });

  test("a trailing dot splits off the number", () => {
    assert.deepEqual(types("1."), [TokenType.Number, TokenType.Dot]);
  });

  test("the stream always ends with eof", () => {
    for (const source of ["", "x", "let x = 1", "  \n "]) {
      assert.equal(new Lexer().lex(source).at(-1)!.type, TokenType.EOF);
    }
  });
});

describe("literals", () => {
  test("integers and floats", () => {
    assert.deepEqual(values("1 2.5 1999.123"), [1, 2.5, 1999.123]);
  });

  test("a number keeps its lexeme and numeric value", () => {
    const [token] = lex("42");
    assert.equal(token!.lexeme, "42");
    assert.equal(token!.value, 42);
  });

  test("strings expose the unquoted value and the quoted lexeme", () => {
    const [token] = lex('"Gopal"');
    assert.equal(token!.value, "Gopal");
    assert.equal(token!.lexeme, '"Gopal"');
  });

  test("empty string", () => {
    assert.equal(lex('""')[0]!.value, "");
  });

  test("escape sequences", () => {
    assert.equal(lex('"a\\nb"')[0]!.value, "a\nb");
    assert.equal(lex('"a\\tb"')[0]!.value, "a\tb");
    assert.equal(lex('"a\\"b"')[0]!.value, 'a"b');
    assert.equal(lex('"a\\\\b"')[0]!.value, "a\\b");
  });

  test("an unknown escape keeps the escaped character", () => {
    assert.equal(lex('"a\\qb"')[0]!.value, "aqb");
  });

  test("brackets and operators inside a string stay literal", () => {
    assert.equal(lex('"[a] + {b}"')[0]!.value, "[a] + {b}");
  });

  test("an unterminated string is reported", () => {
    assert.equal(errorOf('"abc'), "Unterminated string (line 1, column 1)");
  });

  test("a trailing backslash does not swallow the terminator", () => {
    assert.equal(errorOf('"abc\\'), "Unterminated string (line 1, column 1)");
  });

  test("booleans are keywords, not identifiers", () => {
    assert.deepEqual(types("true false"), [TokenType.True, TokenType.False]);
  });

  test("nil is a keyword, not an identifier", () => {
    assert.deepEqual(types("nil"), [TokenType.Nil]);
    // a word merely starting with it is still an identifier
    assert.deepEqual(types("nilable"), [TokenType.Identifier]);
  });
});

describe("identifiers and keywords", () => {
  test("every keyword maps to its own token type", () => {
    const keywords: [string, TokenType][] = [
      ["let", TokenType.Let],
      ["if", TokenType.If],
      ["else", TokenType.Else],
      ["while", TokenType.While],
      ["fn", TokenType.Fn],
      ["continue", TokenType.Continue],
      ["break", TokenType.Break],
      ["for", TokenType.For],
      ["return", TokenType.Return],
      ["true", TokenType.True],
      ["false", TokenType.False],
      ["nil", TokenType.Nil],
      ["from", TokenType.From],
      ["import", TokenType.Import],
      ["export", TokenType.Export],
      ["interface", TokenType.Interface],
      ["match", TokenType.Match],
    ];
    for (const [source, expected] of keywords) {
      assert.equal(lex(source)[0]!.type, expected, `keyword ${source}`);
    }
  });

  // gpp declares every binding with let, so const is an ordinary identifier
  test("const is not a keyword", () => {
    assert.equal(lex("const")[0]!.type, TokenType.Identifier);
  });

  test("a word that merely starts with a keyword is an identifier", () => {
    for (const source of ["iffy", "letter", "format", "returns", "matching"]) {
      assert.equal(lex(source)[0]!.type, TokenType.Identifier, source);
    }
  });

  test("identifiers accept underscores and digits", () => {
    assert.deepEqual(
      types("_z x1 can_i_eat _"),
      Array(4).fill(TokenType.Identifier),
    );
  });

  test("an identifier cannot start with a digit", () => {
    // this is two tokens rather than one identifier
    assert.deepEqual(types("1abc"), [TokenType.Number, TokenType.Identifier]);
  });
});

describe("operators", () => {
  test("single character operators", () => {
    assert.deepEqual(
      types("+ - * / % > < !"),
      Array(8).fill(TokenType.BinaryOperator),
    );
  });

  // the two character forms must be tried before the single character ones
  test("two character operators are not split", () => {
    assert.deepEqual(lexemes("a >= b"), ["a", ">=", "b"]);
    assert.deepEqual(lexemes("a <= b"), ["a", "<=", "b"]);
    assert.deepEqual(lexemes("a == b"), ["a", "==", "b"]);
    assert.deepEqual(lexemes("a != b"), ["a", "!=", "b"]);
    assert.deepEqual(lexemes("a && b"), ["a", "&&", "b"]);
    assert.deepEqual(lexemes("a || b"), ["a", "||", "b"]);
  });

  test("a lone = is assignment, == is comparison", () => {
    assert.equal(lex("a = b")[1]!.type, TokenType.Assignment);
    assert.equal(lex("a == b")[1]!.type, TokenType.BinaryOperator);
  });

  test("compound assignment beats the operator plus equals reading", () => {
    for (const op of ["+=", "-=", "*=", "/=", "%="]) {
      const [, token] = lex(`f ${op} 1`);
      assert.equal(token!.type, TokenType.CompoundAssignment, op);
      assert.equal(token!.lexeme, op);
    }
  });

  // `->` has to win over `-`, otherwise match arms lex as minus then greater-than
  test("the arrow is one token", () => {
    assert.deepEqual(shapes("x -> y"), [
      "identifier(x)",
      "->(->)",
      "identifier(y)",
    ]);
  });

  test("subtraction still lexes after adding the arrow", () => {
    assert.deepEqual(shapes("a - b"), [
      "identifier(a)",
      "binary_op(-)",
      "identifier(b)",
    ]);
  });

  test("a negative number is a minus followed by a number", () => {
    assert.deepEqual(types("-1"), [TokenType.BinaryOperator, TokenType.Number]);
  });
});

describe("punctuation", () => {
  // `?` marks an optional interface field
  test("a question mark is its own token", () => {
    assert.deepEqual(types("debug?: bool"), [
      TokenType.Identifier,
      TokenType.Question,
      TokenType.Colon,
      TokenType.Identifier,
    ]);
  });

  test("each punctuation character has its own type", () => {
    assert.deepEqual(types("( ) { } [ ] , : ; ."), [
      TokenType.LParen,
      TokenType.RParen,
      TokenType.LBrace,
      TokenType.RBrace,
      TokenType.LBracket,
      TokenType.RBracket,
      TokenType.Comma,
      TokenType.Colon,
      TokenType.Semicolon,
      TokenType.Dot,
    ]);
  });

  test("dot access does not disturb decimals", () => {
    assert.deepEqual(shapes("1.5 + a.b"), [
      "number(1.5)",
      "binary_op(+)",
      "identifier(a)",
      ".(.)",
      "identifier(b)",
    ]);
  });

  test("array syntax", () => {
    assert.deepEqual(lexemes("[1, 2]"), ["[", "1", ",", "2", "]"]);
    assert.deepEqual(lexemes("xs[0][1]"), ["xs", "[", "0", "]", "[", "1", "]"]);
    assert.deepEqual(lexemes("[[1], [2]]"), [
      "[", "[", "1", "]", ",", "[", "2", "]", "]",
    ]);
  });
});

describe("comments and whitespace", () => {
  // `//` must be tried before the `/` operator
  test("a comment runs to end of line", () => {
    assert.deepEqual(lexemes("a // hi\nb"), ["a", "b"]);
  });

  test("a comment at end of input needs no newline", () => {
    assert.deepEqual(lexemes("a // trailing"), ["a"]);
  });

  test("division is not mistaken for a comment", () => {
    assert.deepEqual(shapes("a / b"), [
      "identifier(a)",
      "binary_op(/)",
      "identifier(b)",
    ]);
  });

  test("a comment marker inside a string is not a comment", () => {
    assert.equal(lex('"a // b"')[0]!.value, "a // b");
  });

  test("whitespace only source yields just eof", () => {
    assert.deepEqual(types("  \t\r\n  "), []);
    assert.equal(new Lexer().lex("  \n ").length, 1);
  });

  test("empty source yields just eof", () => {
    assert.deepEqual(new Lexer().lex("").map((t) => t.type), [TokenType.EOF]);
  });
});

describe("positions", () => {
  test("line numbers advance with newlines", () => {
    assert.deepEqual(
      lex("a\nb\nc").map((t) => t.line),
      [1, 2, 3],
    );
  });

  test("columns are one based and reset each line", () => {
    assert.deepEqual(
      lex("let x\nlet yy").map((t) => [t.line, t.column]),
      [
        [1, 1],
        [1, 5],
        [2, 1],
        [2, 5],
      ],
    );
  });

  test("a multi line string does not desynchronise later positions", () => {
    const tokens = lex('"a\nb"\nx');
    assert.deepEqual(tokens.at(-1)!.line, 3);
  });

  test("errors carry the position of the offending character", () => {
    assert.equal(errorOf("a\nb\n  @"), "Unexpected character '@' (line 3, column 3)");
  });

  test("a lex error is a LexError with structured position", () => {
    try {
      new Lexer().lex("@");
      assert.fail("expected a throw");
    } catch (error) {
      assert.ok(error instanceof LexError);
      assert.equal((error as LexError).line, 1);
      assert.equal((error as LexError).column, 1);
    }
  });
});

describe("whole programs", () => {
  test("a program round trips to its source tokens", () => {
    const source = [
      "let xs = [1, 2, 3]",
      "let first = xs[0]",
      "if first >= 1 {",
      '  print("ok")',
      "}",
    ].join("\n");

    assert.deepEqual(lexemes(source), [
      "let", "xs", "=", "[", "1", ",", "2", ",", "3", "]",
      "let", "first", "=", "xs", "[", "0", "]",
      "if", "first", ">=", "1", "{",
      "print", "(", '"ok"', ")",
      "}",
    ]);
  });

  test("the sample program lexes without error", () => {
    const source = `let x = 10
let y = x + 20

interface Point {
  x: number
  y: number
}

from math import sin, cos
let zz = {a: 1, b: "hello", c: []}
let {a} = zz

let matched = match some_function(obj) {
  [1,2] -> "success"
  _ -> "fail"
}

zz["a"] = 5
f += 1

while y > 0 {
  y -= 1
}

export z, zz`;

    assert.equal(errorOf(source), null);
  });
});
