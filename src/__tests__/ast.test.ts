import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../lexer.js";
import { parse } from "../parser.js";
import type { Node, Program } from "../ast.js";

// helpers ---------------------------------------------------------------------

function ast(source: string): Program {
  return parse(new Lexer().lex(source));
}

/** every child node reachable from `node`, depth first, including `node`. */
function walk(node: any, seen: any[] = []): any[] {
  if (node === null || typeof node !== "object") return seen;

  if (Array.isArray(node)) {
    for (const item of node) walk(item, seen);
    return seen;
  }

  if (typeof node.kind === "string") seen.push(node);
  for (const key of Object.keys(node)) {
    if (key === "kind" || key === "line" || key === "column") continue;
    walk(node[key], seen);
  }
  return seen;
}

// a program exercising every construct the front end supports, used to assert
// invariants that must hold across the whole tree at once.
const KITCHEN_SINK = `let x: number = 10
let name = "gopal"
let flag = true
let xs = [1, 2, [3]]
let obj = {a: 1, b: "two", c: []}
let {a} = obj
let [head, ...tail] = xs

interface Point {
  x: number
  y: number
}

from math import sin, cos

fn add(a: number, b: number): number {
  return a + b
}

let anon = fn(v) {
  return v * 2
}

if x > 5 && flag {
  x = x - 1
} else if x < 0 {
  x += 1
} else {
  x = 0
}

while x > 0 {
  x -= 1
  if x == 3 {
    continue
  }
  if x == 1 {
    break
  }
}

for item in xs {
  print(item)
}

let negated = -x
let inverted = !flag

let matched = match add(1, 2) {
  [1, 2] -> "pair"
  {p, q} if p > q -> "object"
  -1 -> "negative"
  _ -> "fallback"
}

obj["a"] = 5
obj.b = "three"

export x, name
`;

// tests -----------------------------------------------------------------------

describe("tree invariants", () => {
  test("the kitchen sink program parses", () => {
    assert.doesNotThrow(() => ast(KITCHEN_SINK));
  });

  test("every node carries a usable source position", () => {
    for (const node of walk(ast(KITCHEN_SINK))) {
      assert.equal(typeof node.line, "number", `${node.kind} has no line`);
      assert.equal(typeof node.column, "number", `${node.kind} has no column`);
      assert.ok(node.line >= 1, `${node.kind} has line ${node.line}`);
      assert.ok(node.column >= 1, `${node.kind} has column ${node.column}`);
    }
  });

  test("every node has a kind the interpreter can switch on", () => {
    for (const node of walk(ast(KITCHEN_SINK))) {
      assert.equal(typeof node.kind, "string");
      // snake_case keeps node kinds consistent with the language's own style
      assert.match(node.kind, /^[a-z][a-z_]*$/, `unexpected kind ${node.kind}`);
    }
  });

  test("the tree is finite and acyclic", () => {
    // walk would not terminate on a cycle, so reaching this point is the check
    const nodes = walk(ast(KITCHEN_SINK));
    assert.ok(nodes.length > 50, `expected a large tree, got ${nodes.length}`);
    assert.equal(new Set(nodes).size, nodes.length, "a node was reached twice");
  });

  test("the program node wraps the top level statements", () => {
    const program = ast(KITCHEN_SINK);
    assert.equal(program.kind, "program");
    assert.ok(Array.isArray(program.body));
    assert.ok(program.body.length > 0);
  });

  test("the tree survives a json round trip", () => {
    // the interpreter may ship the tree to a worker, so it must be plain data
    const program = ast(KITCHEN_SINK);
    const copy = JSON.parse(JSON.stringify(program));
    assert.deepEqual(copy, program);
  });
});

describe("node coverage", () => {
  test("the kitchen sink reaches every statement kind", () => {
    const kinds = new Set(walk(ast(KITCHEN_SINK)).map((n) => n.kind));
    const expected = [
      "let_statement",
      "expression_statement",
      "assignment_statement",
      "block_statement",
      "if_statement",
      "while_statement",
      "for_statement",
      "function_declaration",
      "return_statement",
      "break_statement",
      "continue_statement",
      "interface_declaration",
      "import_statement",
      "export_statement",
    ];
    for (const kind of expected) {
      assert.ok(kinds.has(kind), `never produced ${kind}`);
    }
  });

  test("the kitchen sink reaches every expression kind", () => {
    const kinds = new Set(walk(ast(KITCHEN_SINK)).map((n) => n.kind));
    const expected = [
      "number_literal",
      "string_literal",
      "boolean_literal",
      "identifier",
      "array_literal",
      "object_literal",
      "unary_expression",
      "binary_expression",
      "logical_expression",
      "call_expression",
      "member_expression",
      "index_expression",
      "function_expression",
      "match_expression",
    ];
    for (const kind of expected) {
      assert.ok(kinds.has(kind), `never produced ${kind}`);
    }
  });

  test("the kitchen sink reaches every pattern kind", () => {
    const kinds = new Set(walk(ast(KITCHEN_SINK)).map((n) => n.kind));
    for (const kind of [
      "wildcard_pattern",
      "literal_pattern",
      "binding_pattern",
      "array_pattern",
      "object_pattern",
    ]) {
      assert.ok(kinds.has(kind), `never produced ${kind}`);
    }
  });

  test("type nodes are retained for the checker", () => {
    const kinds = new Set(walk(ast(KITCHEN_SINK)).map((n) => n.kind));
    assert.ok(kinds.has("named_type"));

    const withArray = new Set(walk(ast("let xs: string[] = []")).map((n) => n.kind));
    assert.ok(withArray.has("array_type"));

    const withUnion = new Set(walk(ast("let v: number | string = 1")).map((n) => n.kind));
    assert.ok(withUnion.has("union_type"));

    const withFn = new Set(
      walk(ast("let f: fn(number): number = g")).map((n) => n.kind),
    );
    assert.ok(withFn.has("function_type"));

    const withObject = new Set(
      walk(ast("let p: {x: number} = q")).map((n) => n.kind),
    );
    assert.ok(withObject.has("object_type"));
  });
});

describe("evaluation order is recoverable", () => {
  // a tree walk interpreter reads operands left to right, so the tree has to
  // preserve the order the source wrote them in
  test("binary operands keep source order", () => {
    const statement: any = ast("let a = first + second").body[0];
    assert.equal(statement.value.left.name, "first");
    assert.equal(statement.value.right.name, "second");
  });

  test("call arguments keep source order", () => {
    const statement: any = ast("f(one, two, three)").body[0];
    assert.deepEqual(
      statement.expression.args.map((a: any) => a.name),
      ["one", "two", "three"],
    );
  });

  test("statements keep source order", () => {
    const program = ast("let a = 1\nlet b = 2\nlet c = 3");
    assert.deepEqual(
      program.body.map((s: any) => s.target.name),
      ["a", "b", "c"],
    );
  });

  test("match arms keep source order so the first match wins", () => {
    const statement: any = ast('let m = match x {\n 1 -> "a"\n 2 -> "b"\n _ -> "c"\n}').body[0];
    assert.deepEqual(
      statement.value.arms.map((a: any) => a.body.value),
      ["a", "b", "c"],
    );
  });

  test("object properties keep source order", () => {
    const statement: any = ast("let o = {z: 1, a: 2, m: 3}").body[0];
    assert.deepEqual(
      statement.value.properties.map((p: any) => p.key),
      ["z", "a", "m"],
    );
  });
});

describe("positions point at the right token", () => {
  test("a statement starts at its first keyword", () => {
    const statement: any = ast("\n\n  let x = 1").body[0];
    assert.deepEqual([statement.line, statement.column], [3, 3]);
  });

  test("a binary expression starts at its left operand", () => {
    const statement: any = ast("let a = b + c").body[0];
    assert.equal(statement.value.column, 9);
  });

  test("a call starts at its callee", () => {
    const statement: any = ast("  f(x)").body[0];
    assert.equal(statement.expression.column, 3);
  });

  test("a nested statement reports its own line", () => {
    const statement: any = ast("fn f() {\n  return 1\n}").body[0];
    assert.equal(statement.body.body[0].line, 2);
  });
});
