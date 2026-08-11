import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../lexer.js";
import { parse, ParseError } from "../parser.js";
import type { Expression, Program, Statement } from "../ast.js";

// helpers ---------------------------------------------------------------------

function ast(source: string): Program {
  return parse(new Lexer().lex(source));
}

function first(source: string): Statement {
  const [statement] = ast(source).body;
  assert.ok(statement, "expected at least one statement");
  return statement;
}

/**
 * renders an expression fully parenthesised, so precedence and associativity
 * are visible in the assertion rather than buried in a nested object.
 */
function sexp(node: any): string {
  switch (node.kind) {
    case "number_literal":
      return String(node.value);
    case "string_literal":
      return JSON.stringify(node.value);
    case "boolean_literal":
      return String(node.value);
    case "identifier":
      return node.name;
    case "binary_expression":
    case "logical_expression":
      return `(${sexp(node.left)} ${node.operator} ${sexp(node.right)})`;
    case "unary_expression":
      return `(${node.operator}${sexp(node.operand)})`;
    case "call_expression":
      return `${sexp(node.callee)}(${node.args.map(sexp).join(", ")})`;
    case "member_expression":
      return `${sexp(node.object)}.${node.property}`;
    case "index_expression":
      return `${sexp(node.object)}[${sexp(node.index)}]`;
    case "array_literal":
      return `[${node.elements.map(sexp).join(", ")}]`;
    case "object_literal":
      return `{${node.properties
        .map((p: any) => `${p.key}: ${sexp(p.value)}`)
        .join(", ")}}`;
    case "function_expression":
      return `fn(${node.params.map((p: any) => p.name).join(", ")})`;
    case "match_expression":
      return `match ${sexp(node.subject)} [${node.arms.length} arms]`;
    default:
      return node.kind;
  }
}

/** parses a single expression statement and renders it. */
function expr(source: string): string {
  const statement = first(source);
  assert.equal(
    statement.kind,
    "expression_statement",
    `expected an expression, got ${statement.kind}`,
  );
  return sexp((statement as any).expression);
}

/** the message of the parse error a source raises, or null when it parses. */
function errorOf(source: string): string | null {
  try {
    ast(source);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

// tests -----------------------------------------------------------------------

describe("operator precedence", () => {
  test("multiplication binds tighter than addition", () => {
    assert.equal(expr("a + b * c"), "(a + (b * c))");
    assert.equal(expr("a * b + c"), "((a * b) + c)");
  });

  test("parentheses override precedence", () => {
    assert.equal(expr("(a + b) * c"), "((a + b) * c)");
  });

  test("modulo binds like multiplication", () => {
    assert.equal(expr("a + b % c"), "(a + (b % c))");
  });

  test("arithmetic outranks comparison", () => {
    assert.equal(expr("a + b > c"), "((a + b) > c)");
  });

  test("comparison outranks equality", () => {
    assert.equal(expr("a > b == c < d"), "((a > b) == (c < d))");
  });

  test("and binds tighter than or", () => {
    assert.equal(expr("a || b && c"), "(a || (b && c))");
    assert.equal(expr("a && b || c && d"), "((a && b) || (c && d))");
  });

  test("comparison outranks the logical operators", () => {
    assert.equal(expr("a > 1 && b < 2"), "((a > 1) && (b < 2))");
  });

  test("binary operators are left associative", () => {
    assert.equal(expr("a - b - c"), "((a - b) - c)");
    assert.equal(expr("a / b / c"), "((a / b) / c)");
  });

  test("unary binds tighter than any binary operator", () => {
    assert.equal(expr("-a + b"), "((-a) + b)");
    assert.equal(expr("-a * b"), "((-a) * b)");
    assert.equal(expr("!a && b"), "((!a) && b)");
  });

  test("unary operators nest", () => {
    assert.equal(expr("!!a"), "(!(!a))");
    assert.equal(expr("--a"), "(-(-a))");
  });

  // short circuiting means the interpreter must not evaluate both sides eagerly
  test("logical operators get their own node kind", () => {
    const statement: any = first("a && b");
    assert.equal(statement.expression.kind, "logical_expression");
    const arithmetic: any = first("a + b");
    assert.equal(arithmetic.expression.kind, "binary_expression");
  });
});

describe("postfix expressions", () => {
  test("calls, indexes and member access", () => {
    assert.equal(expr("f(x)"), "f(x)");
    assert.equal(expr("f()"), "f()");
    assert.equal(expr("xs[0]"), "xs[0]");
    assert.equal(expr("a.b"), "a.b");
  });

  test("postfix operators chain in source order", () => {
    assert.equal(expr("a.b.c"), "a.b.c");
    assert.equal(expr("f(x)[0]"), "f(x)[0]");
    assert.equal(expr("xs[0](y)"), "xs[0](y)");
    assert.equal(expr("a.b[0].c(d)"), "a.b[0].c(d)");
  });

  test("calls take arbitrary expressions as arguments", () => {
    assert.equal(expr("f(g(x), h(y))"), "f(g(x), h(y))");
    assert.equal(expr("f(a + b)"), "f((a + b))");
  });

  test("an index accepts a computed key", () => {
    assert.equal(expr("xs[i + 1]"), "xs[(i + 1)]");
  });

  test("calls participate in binary expressions", () => {
    assert.equal(expr("f(x) + g(y)"), "(f(x) + g(y))");
  });
});

describe("literals", () => {
  test("arrays", () => {
    assert.equal(expr("[1, 2, 3]"), "[1, 2, 3]");
    assert.equal(expr("[]"), "[]");
    assert.equal(expr("[1, [2, 3]]"), "[1, [2, 3]]");
  });

  test("objects", () => {
    assert.equal(expr("({a: 1, b: 2})"), "{a: 1, b: 2}");
    assert.equal(expr("({})"), "{}");
  });

  test("object shorthand expands to a self reference", () => {
    assert.equal(expr("({a})"), "{a: a}");
    const statement: any = first("let obj = { a }");
    assert.equal(statement.value.properties[0].shorthand, true);
  });

  test("trailing commas are accepted", () => {
    assert.equal(expr("[1, 2,]"), "[1, 2]");
    assert.equal(expr("({a: 1,})"), "{a: 1}");
  });

  test("literal values survive parsing", () => {
    const statement: any = first('let a = [1, "two", true]');
    assert.deepEqual(
      statement.value.elements.map((e: any) => e.value),
      [1, "two", true],
    );
  });
});

describe("let declarations", () => {
  test("a simple binding", () => {
    const statement: any = first("let x = 1");
    assert.equal(statement.kind, "let_statement");
    assert.equal(statement.target.name, "x");
    assert.equal(sexp(statement.value), "1");
  });

  test("a declaration without an initialiser", () => {
    const statement: any = first("let x");
    assert.equal(statement.value, null);
  });

  test("a type annotation is retained for the checker", () => {
    const statement: any = first('let s: string = ""');
    assert.equal(statement.typeAnnotation.kind, "named_type");
    assert.equal(statement.typeAnnotation.name, "string");
  });

  test("array and union annotations", () => {
    const array: any = first("let xs: number[] = []");
    assert.equal(array.typeAnnotation.kind, "array_type");
    assert.equal(array.typeAnnotation.element.name, "number");

    const union: any = first("let v: number | string = 1");
    assert.equal(union.typeAnnotation.kind, "union_type");
    assert.deepEqual(
      union.typeAnnotation.options.map((o: any) => o.name),
      ["number", "string"],
    );
  });

  test("object destructuring", () => {
    const statement: any = first("let {a} = zz");
    assert.equal(statement.target.kind, "object_pattern");
    assert.equal(statement.target.fields[0].key, "a");
    // `{a}` binds a variable of the same name
    assert.equal(statement.target.fields[0].value.kind, "binding_pattern");
  });

  test("array destructuring", () => {
    const statement: any = first("let [a, b] = xs");
    assert.equal(statement.target.kind, "array_pattern");
    assert.deepEqual(
      statement.target.elements.map((e: any) => e.name),
      ["a", "b"],
    );
  });
});

describe("assignment", () => {
  test("assigning to a variable", () => {
    const statement: any = first("x = 1");
    assert.equal(statement.kind, "assignment_statement");
    assert.equal(statement.operator, "=");
    assert.equal(sexp(statement.target), "x");
  });

  test("assigning through an index or member", () => {
    assert.equal(sexp((first('zz["a"] = 5') as any).target), 'zz["a"]');
    assert.equal(sexp((first("a.b = 5") as any).target), "a.b");
  });

  test("compound assignment keeps its operator", () => {
    for (const op of ["+=", "-=", "*=", "/=", "%="]) {
      const statement: any = first(`f ${op} 1`);
      assert.equal(statement.kind, "assignment_statement");
      assert.equal(statement.operator, op);
    }
  });

  test("a non assignable target is rejected", () => {
    assert.equal(errorOf("1 = 2"), "Invalid assignment target (line 1, column 1)");
    assert.equal(errorOf("f() = 2"), "Invalid assignment target (line 1, column 1)");
  });
});

describe("if statements", () => {
  test("a bare condition", () => {
    const statement: any = first("if x > 1 {\n y = 2\n}");
    assert.equal(statement.kind, "if_statement");
    assert.equal(sexp(statement.condition), "(x > 1)");
    assert.equal(statement.consequent.body.length, 1);
    assert.equal(statement.alternate, null);
  });

  test("parentheses around the condition are optional", () => {
    assert.equal(sexp((first("if (y > 20) {\n y = 1\n}") as any).condition), "(y > 20)");
  });

  test("an else block", () => {
    const statement: any = first("if x {\n a = 1\n} else {\n a = 2\n}");
    assert.equal(statement.alternate.kind, "block_statement");
  });

  test("else if nests another if", () => {
    const statement: any = first(
      "if x {\n a = 1\n} else if y {\n a = 2\n} else {\n a = 3\n}",
    );
    assert.equal(statement.alternate.kind, "if_statement");
    assert.equal(statement.alternate.alternate.kind, "block_statement");
  });

  test("an empty body is allowed", () => {
    const statement: any = first("if x {\n}");
    assert.deepEqual(statement.consequent.body, []);
  });
});

describe("while loops", () => {
  test("a condition and body", () => {
    const statement: any = first("while x > 0 {\n x = x - 1\n}");
    assert.equal(statement.kind, "while_statement");
    assert.equal(sexp(statement.condition), "(x > 0)");
    assert.equal(statement.body.body.length, 1);
  });

  test("parentheses around the condition are optional", () => {
    assert.equal(sexp((first("while (i < 10) {\n i += 1\n}") as any).condition), "(i < 10)");
  });

  test("a literal condition", () => {
    const statement: any = first("while true {\n break\n}");
    assert.equal(sexp(statement.condition), "true");
  });

  test("break and continue", () => {
    const withBreak: any = first("while x {\n break\n}");
    assert.equal(withBreak.body.body[0].kind, "break_statement");
    const withContinue: any = first("while x {\n continue\n}");
    assert.equal(withContinue.body.body[0].kind, "continue_statement");
  });

  test("loops nest", () => {
    const statement: any = first("while a {\n while b {\n c = 1\n }\n}");
    assert.equal(statement.body.body[0].kind, "while_statement");
  });

  test("a compound assignment body", () => {
    const statement: any = first("while y > 0 {\n y -= 1\n}");
    assert.equal(statement.body.body[0].operator, "-=");
  });

  test("a logical condition", () => {
    assert.equal(
      sexp((first("while a && b {\n c = 1\n}") as any).condition),
      "(a && b)",
    );
  });
});

describe("for loops", () => {
  test("iterating a collection", () => {
    const statement: any = first("for x in xs {\n println(x)\n}");
    assert.equal(statement.kind, "for_statement");
    assert.equal(statement.binding, "x");
    assert.equal(sexp(statement.iterable), "xs");
  });

  test("the iterable may be any expression", () => {
    assert.equal(sexp((first("for x in range(10) {\n}") as any).iterable), "range(10)");
  });

  test("a missing in keyword is reported", () => {
    assert.equal(errorOf("for x of xs {\n}"), "Expected 'in' in for loop (line 1, column 7)");
  });
});

describe("functions", () => {
  test("a declaration with parameters", () => {
    const statement: any = first("fn double(x) {\n return x * 2\n}");
    assert.equal(statement.kind, "function_declaration");
    assert.equal(statement.name, "double");
    assert.deepEqual(statement.params.map((p: any) => p.name), ["x"]);
  });

  test("parameter and return types", () => {
    const statement: any = first(
      "fn add(a: number, b: number): number {\n return a + b\n}",
    );
    assert.deepEqual(statement.params.map((p: any) => p.type.name), ["number", "number"]);
    assert.equal(statement.returnType.name, "number");
  });

  test("no parameters", () => {
    assert.equal((first("fn f() {\n return 1\n}") as any).params.length, 0);
  });

  test("a returned expression", () => {
    const statement: any = first("fn f() {\n return x * 2\n}");
    assert.equal(sexp(statement.body.body[0].value), "(x * 2)");
  });

  test("a bare return has no value", () => {
    const statement: any = first("fn f() {\n return\n}");
    assert.equal(statement.body.body[0].value, null);
  });

  // a return with nothing after it must not absorb the next line
  test("a bare return does not swallow the following statement", () => {
    const statement: any = first("fn f() {\n return\n x = 1\n}");
    assert.equal(statement.body.body.length, 2);
    assert.equal(statement.body.body[0].value, null);
  });

  test("an anonymous function is an expression", () => {
    const statement: any = first("let f = fn(x) {\n return x\n}");
    assert.equal(statement.value.kind, "function_expression");
    assert.equal(statement.value.name, null);
  });

  test("calls nest inside a body", () => {
    const statement: any = first("fn sq(x) {\n return double(x * x)\n}");
    assert.equal(sexp(statement.body.body[0].value), "double((x * x))");
  });

  test("recursion parses", () => {
    const statement: any = first(
      "fn fact(n) {\n if n <= 1 {\n return 1\n }\n return n * fact(n - 1)\n}",
    );
    assert.equal(statement.body.body.length, 2);
  });
});

describe("match expressions", () => {
  test("arms are collected", () => {
    const statement: any = first('let a = match f(o) {\n [1,2] -> "s"\n [3,4] -> "f"\n}');
    assert.equal(statement.value.kind, "match_expression");
    assert.equal(statement.value.arms.length, 2);
    assert.equal(sexp(statement.value.subject), "f(o)");
  });

  test("literal patterns keep their values", () => {
    const statement: any = first('let a = match x {\n 42 -> "n"\n "s" -> "str"\n true -> "b"\n}');
    assert.deepEqual(
      statement.value.arms.map((a: any) => a.pattern.value),
      [42, "s", true],
    );
  });

  test("a negative literal pattern", () => {
    const statement: any = first('let a = match x {\n -1 -> "neg"\n}');
    assert.equal(statement.value.arms[0].pattern.value, -1);
  });

  test("array patterns match by position", () => {
    const statement: any = first('let a = match x {\n [1,2] -> "s"\n}');
    assert.deepEqual(
      statement.value.arms[0].pattern.elements.map((p: any) => p.value),
      [1, 2],
    );
  });

  test("identifiers in a pattern bind", () => {
    const statement: any = first("let a = match x {\n [p, q] -> p\n}");
    assert.deepEqual(
      statement.value.arms[0].pattern.elements.map((p: any) => [p.kind, p.name]),
      [["binding_pattern", "p"], ["binding_pattern", "q"]],
    );
  });

  test("underscore is a wildcard rather than a binding", () => {
    const statement: any = first('let a = match x {\n _ -> "d"\n}');
    assert.equal(statement.value.arms[0].pattern.kind, "wildcard_pattern");
  });

  test("object patterns and guards", () => {
    const statement: any = first('let a = match x {\n {p, q} if p > q -> "x"\n}');
    const arm = statement.value.arms[0];
    assert.equal(arm.pattern.kind, "object_pattern");
    assert.equal(sexp(arm.guard), "(p > q)");
  });

  test("an arm without a guard records null", () => {
    const statement: any = first('let a = match x {\n 1 -> "a"\n}');
    assert.equal(statement.value.arms[0].guard, null);
  });

  test("patterns nest", () => {
    const statement: any = first("let a = match x {\n [p, [q, r]] -> p\n}");
    assert.equal(statement.value.arms[0].pattern.elements[1].kind, "array_pattern");
  });

  test("a rest pattern captures the tail", () => {
    const statement: any = first("let a = match x {\n [h, ...t] -> h\n}");
    assert.equal(statement.value.arms[0].pattern.rest, "t");
    assert.equal(statement.value.arms[0].pattern.elements.length, 1);
  });

  test("an arm body may be a block", () => {
    const statement: any = first("let a = match x {\n 1 -> {\n y = 2\n }\n}");
    assert.equal(statement.value.arms[0].body.kind, "block_statement");
  });

  test("a missing arrow is reported", () => {
    assert.match(errorOf('let a = match x {\n 1 "s"\n}') ?? "", /Expected -> after a match pattern/);
  });
});

describe("interfaces", () => {
  test("fields and their types", () => {
    const statement: any = first("interface Point {\n x: number\n y: number\n}");
    assert.equal(statement.kind, "interface_declaration");
    assert.equal(statement.name, "Point");
    assert.deepEqual(
      statement.fields.map((f: any) => [f.name, f.type.name]),
      [["x", "number"], ["y", "number"]],
    );
  });

  test("semicolons between fields are optional", () => {
    const statement: any = first("interface Ok {\n value: any;\n}");
    assert.deepEqual(statement.fields.map((f: any) => f.name), ["value"]);
  });

  test("an empty interface", () => {
    assert.deepEqual((first("interface Empty {\n}") as any).fields, []);
  });

  test("an array typed field", () => {
    const statement: any = first("interface Bag {\n items: string[]\n}");
    assert.equal(statement.fields[0].type.kind, "array_type");
  });
});

describe("imports and exports", () => {
  test("importing from a bare module name", () => {
    const statement: any = first("from math import sin, cos");
    assert.equal(statement.kind, "import_statement");
    assert.equal(statement.source, "math");
    assert.deepEqual(statement.names.map((n: any) => n.name), ["sin", "cos"]);
  });

  test("importing from a quoted path", () => {
    const statement: any = first('from "abc" import xyz');
    assert.equal(statement.source, "abc");
    assert.deepEqual(statement.names.map((n: any) => n.name), ["xyz"]);
  });

  // `type` is a prelude export, so keywords must be importable as names
  test("a keyword may be imported as a name", () => {
    const statement: any = first("from prelude import map, reduce, type_of");
    assert.deepEqual(statement.names.map((n: any) => n.name), ["map", "reduce", "type_of"]);
  });

  test("exporting names", () => {
    const statement: any = first("export z, zz");
    assert.equal(statement.kind, "export_statement");
    assert.deepEqual(statement.names, ["z", "zz"]);
  });

  test("exporting a single name", () => {
    assert.deepEqual((first("export double") as any).names, ["double"]);
  });
});

describe("lambdas", () => {
  test("an expression body desugars to a returning block", () => {
    const statement: any = first("let f = (a) -> a*a");
    assert.equal(statement.value.kind, "function_expression");
    assert.equal(statement.value.name, null);
    assert.deepEqual(statement.value.params.map((p: any) => p.name), ["a"]);

    // the desugar is the whole design, so pin the shape rather than infer it
    const body = statement.value.body;
    assert.equal(body.kind, "block_statement");
    assert.equal(body.body.length, 1);
    assert.equal(body.body[0].kind, "return_statement");
    assert.equal(sexp(body.body[0].value), "(a * a)");
  });

  test("no parameters", () => {
    const statement: any = first('let f = () -> println("hi")');
    assert.deepEqual(statement.value.params, []);
  });

  test("several parameters", () => {
    const statement: any = first("let f = (a, b) -> a*a + b*b");
    assert.deepEqual(statement.value.params.map((p: any) => p.name), ["a", "b"]);
  });

  // parseParameters is reused wholesale, so annotations come for free
  test("parameters may be annotated", () => {
    const statement: any = first("let f = (a: number) -> a");
    assert.equal(statement.value.params[0].type.name, "number");
  });

  test("the body extends as far as the expression does", () => {
    const statement: any = first("let f = (a) -> a + 1 * 2");
    assert.equal(sexp(statement.value.body.body[0].value), "(a + (1 * 2))");
  });

  test("lambdas nest to the right", () => {
    const statement: any = first("let f = (a) -> (b) -> a + b");
    const outer = statement.value.body.body[0].value;
    assert.equal(outer.kind, "function_expression");
    assert.deepEqual(outer.params.map((p: any) => p.name), ["b"]);
  });

  test("a lambda may be an argument or an element", () => {
    const call: any = first("map(xs, (a) -> a*2)");
    assert.equal(call.expression.args[1].kind, "function_expression");

    const array: any = first("let xs = [(a) -> a, 2]");
    assert.equal(array.value.elements[0].kind, "function_expression");
  });

  test("a brace body is a block, used as written", () => {
    const statement: any = first("let f = (x) -> {\n return x\n}");
    const body = statement.value.body;
    assert.equal(body.kind, "block_statement");
    assert.equal(body.body[0].kind, "return_statement");
  });

  // the brace opens a body, so an object literal needs parentheses
  test("returning an object literal requires parentheses", () => {
    const statement: any = first("let f = (x) -> ({a: 1})");
    assert.equal(statement.value.body.body[0].value.kind, "object_literal");
    assert.throws(() => ast("let f = (x) -> { a: 1 }"), ParseError);
  });

  test("a lambda may be a match arm body", () => {
    const statement: any = first('let g = match 1 {\n 1 -> (a) -> a*a\n _ -> 0\n}');
    assert.equal(statement.value.arms[0].body.kind, "function_expression");
  });

  test("positions point at the parens and the body", () => {
    const statement: any = first("let f = (a) -> a*a");
    // the lambda starts at its `(`
    assert.equal(statement.value.column, 9);
    // the synthetic nodes carry the body's position, since the user wrote
    // neither a brace nor a return
    assert.equal(statement.value.body.column, 16);
    assert.equal(statement.value.body.body[0].column, 16);
  });

  test("an unparenthesised parameter list is rejected", () => {
    assert.throws(() => ast("let f = (1) -> x"), ParseError);
  });
});

// a lambda must never be mistaken for a grouped expression
describe("grouping still parses as grouping", () => {
  test("a parenthesised expression is unwrapped", () => {
    assert.equal(expr("(a)"), "a");
    assert.equal(expr("((a))"), "a");
  });

  test("parentheses still override precedence", () => {
    assert.equal(expr("(a + b) * c"), "((a + b) * c)");
  });

  test("a parenthesised argument is not a lambda", () => {
    const statement: any = first("f((a), 2)");
    assert.equal(statement.expression.args[0].kind, "identifier");
  });

  test("brackets and braces inside parentheses are unaffected", () => {
    assert.equal(expr("([1, 2])"), "[1, 2]");
    assert.equal(expr("({a: 1})"), "{a: 1}");
  });

  test("a following operator does not make a lambda", () => {
    assert.equal(expr("(a) + 1"), "(a + 1)");
  });

  test("an unterminated group reports its own error", () => {
    // the scan hits eof, declines, and the normal path produces the message
    assert.throws(
      () => ast("let x = (a"),
      /Expected \) to close a grouped expression/,
    );
  });
});

describe("brace disambiguation", () => {
  // `{` opens a block in statement position and an object literal in expression
  // position, so the header of a control statement must not eat the body
  test("an if header does not read its body as an object", () => {
    assert.equal(first("if x {\n y = 1\n}").kind, "if_statement");
  });

  test("a while header does not read its body as an object", () => {
    assert.equal(first("while x {\n y = 1\n}").kind, "while_statement");
  });

  test("an object literal inside a header still parses", () => {
    assert.equal(sexp((first("if f({a: 1}) {\n y = 1\n}") as any).condition), "f({a: 1})");
  });

  test("an object literal in a value position parses", () => {
    assert.equal(
      sexp((first('let zz = {a: 1, b: "h", c: []}') as any).value),
      '{a: 1, b: "h", c: []}',
    );
  });

  test("a bare block is a statement", () => {
    assert.equal(first("{\n let x = 1\n}").kind, "block_statement");
  });

  // a `{` in the first position of a header cannot be the body brace, because
  // the body cannot precede the header
  test("an object literal may open a header", () => {
    const match: any = first('let m = match {p: 1} {\n {p} -> p\n}');
    assert.equal(match.value.subject.kind, "object_literal");

    const loop: any = first("for k in {a: 1} {\n println(k)\n}");
    assert.equal(loop.iterable.kind, "object_literal");
  });

  test("an object opening a header can still be an operand", () => {
    const statement: any = first('if {a: 1} == other {\n x = 1\n}');
    assert.equal(statement.condition.kind, "binary_expression");
    assert.equal(statement.condition.left.kind, "object_literal");
  });

  test("a match subject does not absorb the arms", () => {
    const statement: any = first('let a = match f(x) {\n 1 -> "a"\n}');
    assert.equal(statement.value.kind, "match_expression");
    assert.equal(sexp(statement.value.subject), "f(x)");
  });
});

describe("statement termination", () => {
  // postfix `(` and `[` only continue an expression on the same line, otherwise
  // a following array literal parses as an index into the previous statement
  test("a newline ends a statement before a bracket", () => {
    assert.equal(ast("let a = f\n[1]").body.length, 2);
  });

  test("an index on the same line still applies", () => {
    assert.equal(ast("let a = f[1]").body.length, 1);
  });

  test("a match arm is not indexed by the next arm", () => {
    const statement: any = first('let a = match x {\n 1 -> "s"\n [2] -> "t"\n}');
    assert.equal(statement.value.arms.length, 2);
  });

  test("semicolons separate statements on one line", () => {
    assert.equal(ast("let a = 1; let b = 2").body.length, 2);
  });

  test("two statements on one line without a separator are rejected", () => {
    assert.equal(
      errorOf("let a = 1 let b = 2"),
      "Expected end of statement, found 'let' (line 1, column 11)",
    );
  });

  test("stray semicolons are tolerated", () => {
    assert.equal(ast(";;let a = 1;;").body.length, 1);
  });

  // the single line rule is scoped to match arms, where the next line starts a
  // new pattern. elsewhere a binary operator still continues the expression.
  test("a binary operator continues across a newline outside a match", () => {
    assert.equal(ast("let a = b\n- 1").body.length, 1);
    assert.equal(ast("let a = b +\n c").body.length, 1);
  });

  test("a leading minus starts the next arm rather than subtracting", () => {
    const statement: any = first('let m = match x {\n 1 -> "a"\n -1 -> "n"\n}');
    assert.equal(statement.value.arms.length, 2);
    assert.equal(statement.value.arms[1].pattern.value, -1);
  });

  test("a match arm body may still contain binary operators", () => {
    const statement: any = first("let m = match x {\n 1 -> a + b\n 2 -> c\n}");
    assert.equal(statement.value.arms.length, 2);
    assert.equal(sexp(statement.value.arms[0].body), "(a + b)");
  });

  test("delimiters lift the single line rule", () => {
    assert.equal(ast("f(\n  a + b,\n  c\n)").body.length, 1);
    assert.equal(ast("let xs = [\n 1,\n 2\n]").body.length, 1);
  });

  test("an empty program has no statements", () => {
    assert.deepEqual(ast("").body, []);
    assert.deepEqual(ast("// just a comment").body, []);
  });
});

describe("errors", () => {
  test("an unclosed grouping is reported at the end", () => {
    assert.match(errorOf("let a = (1 + 2") ?? "", /Expected \) to close a grouped expression/);
  });

  test("an unclosed block is reported", () => {
    assert.match(errorOf("if x {\n y = 1") ?? "", /Expected \} to close a block/);
  });

  test("an unclosed array is reported", () => {
    assert.match(errorOf("let a = [1, 2") ?? "", /Expected \] to close an array/);
  });

  test("a missing expression is reported", () => {
    assert.match(errorOf("let a = ") ?? "", /Unexpected token/);
  });

  test("a parse error is a ParseError with structured position", () => {
    try {
      ast("let a = 1 let b = 2");
      assert.fail("expected a throw");
    } catch (error) {
      assert.ok(error instanceof ParseError);
      assert.equal((error as ParseError).line, 1);
      assert.equal((error as ParseError).column, 11);
    }
  });
});

describe("positions", () => {
  test("statements carry their starting position", () => {
    assert.deepEqual(
      ast("let a = 1\nlet b = 2").body.map((s) => [s.line, s.column]),
      [[1, 1], [2, 1]],
    );
  });

  test("nested statements carry their own position", () => {
    const statement: any = first("if x {\n let y = 1\n}");
    assert.deepEqual(
      [statement.consequent.body[0].line, statement.consequent.body[0].column],
      [2, 2],
    );
  });

  test("expressions carry positions for runtime errors", () => {
    const statement: any = first("let a = b + c");
    assert.equal(statement.value.line, 1);
    assert.equal(statement.value.column, 9);
  });
});

describe("sample programs", () => {
  test("the declaration heavy sample parses", () => {
    const source = `if x > 1999.123 {
  println(x)
}

let name = "Gopal" // lol
let s: string = ""
let y = 4
let _z = 3
let can_i_eat = true

fn double(x) {
  return x * 2
}

fn square_double(x) {
  return double(x * x)
}
// some comment
export double
`;
    const program = ast(source);
    assert.deepEqual(program.body.map((s) => s.kind), [
      "if_statement",
      "let_statement",
      "let_statement",
      "let_statement",
      "let_statement",
      "let_statement",
      "function_declaration",
      "function_declaration",
      "export_statement",
    ]);
  });

  test("the feature heavy sample parses", () => {
    const source = `let x = 10
let y = x + 20

interface Point {
  x: number
  y: number
}

from "abc" import xyz
from math import sin, cos, tan, pi
from prelude import map, reduce, type_of

let zz = {a: 1, b: "hello", c: []}
let {a} = zz
let obj = { a }

let matched = match some_function(obj) {
  [1,2] -> "success"
  [3,4] -> "fail"
}

interface Ok {
  value: any;
}

zz["a"] = 5
f += 1

let z = [1,2,3,4, [1]]

while y > 0 {
  y -= 1
}

if (y > 20) {
  y = y * 2
}

export z, zz
`;
    const program = ast(source);
    assert.deepEqual(program.body.map((s) => s.kind), [
      "let_statement",
      "let_statement",
      "interface_declaration",
      "import_statement",
      "import_statement",
      "import_statement",
      "let_statement",
      "let_statement",
      "let_statement",
      "let_statement",
      "interface_declaration",
      "assignment_statement",
      "assignment_statement",
      "let_statement",
      "while_statement",
      "if_statement",
      "export_statement",
    ]);
  });
});
