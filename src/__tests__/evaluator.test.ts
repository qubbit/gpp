import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../gpp.js";

// helpers ---------------------------------------------------------------------

/** runs a program and returns its printed lines, failing on any error. */
function output(source: string): string[] {
  const result = execute(source);
  assert.equal(result.error, null, `unexpected error: ${result.error?.message}`);
  return result.output;
}

/** runs a program expected to print exactly one line. */
function prints(source: string): string {
  const lines = output(source);
  assert.equal(lines.length, 1, `expected one line, got ${lines.length}`);
  return lines[0]!;
}

/** the error message a program raises, or null when it succeeds. */
function errorOf(source: string): string | null {
  return execute(source).error?.message ?? null;
}

// tests -----------------------------------------------------------------------

describe("literals and operators", () => {
  test("arithmetic follows precedence", () => {
    assert.equal(prints("print(1 + 2 * 3)"), "7");
    assert.equal(prints("print((1 + 2) * 3)"), "9");
  });

  test("division and modulo", () => {
    assert.equal(prints("print(10 / 4)"), "2.5");
    assert.equal(prints("print(7 % 3)"), "1");
  });

  test("comparison and equality", () => {
    assert.equal(prints("print(1 < 2)"), "true");
    assert.equal(prints("print(2 == 2)"), "true");
    assert.equal(prints("print(2 != 2)"), "false");
  });

  test("equality is structural for collections", () => {
    assert.equal(prints("print([1, 2] == [1, 2])"), "true");
    assert.equal(prints("print({a: 1} == {a: 1})"), "true");
    assert.equal(prints("print([1, 2] == [2, 1])"), "false");
  });

  test("string concatenation coerces the other side", () => {
    assert.equal(prints('print("a" + "b")'), "ab");
    assert.equal(prints('print("n" + 1)'), "n1");
  });

  test("arrays concatenate with +", () => {
    assert.equal(prints("print([1] + [2])"), "[1, 2]");
  });

  test("unary operators", () => {
    assert.equal(prints("print(-5)"), "-5");
    assert.equal(prints("print(!true)"), "false");
  });

  test("nil is a literal", () => {
    assert.equal(prints("print(nil)"), "nil");
    assert.equal(prints("print(type(nil))"), "nil");
  });

  test("a missing key compares equal to nil", () => {
    assert.equal(prints('let m = {}\nprint(m["x"] == nil)'), "true");
    assert.equal(prints('let m = {a: 1}\nprint(m["a"] != nil)'), "true");
  });

  // the reason the literal exists: a truthiness check would recompute a
  // cached 0, a comparison against nil does not
  test("comparing against nil distinguishes absent from falsy", () => {
    assert.equal(
      prints('let m = {}\nm["a"] = 0\nif m["a"] != nil {\n print("cached")\n}'),
      "cached",
    );
  });

  test("nil matches a nil pattern", () => {
    assert.equal(
      prints('print(match nil {\n nil -> "is nil"\n _ -> "other"\n})'),
      "is nil",
    );
    assert.equal(
      prints('print(match 1 {\n nil -> "is nil"\n _ -> "other"\n})'),
      "other",
    );
  });

  test("nil survives inside collections", () => {
    assert.equal(prints("print([1, nil, 3])"), "[1, nil, 3]");
  });

  test("truthiness covers only false and nil", () => {
    assert.equal(prints("print(!0)"), "false");
    assert.equal(prints('print(!"")'), "false");
    assert.equal(prints("print(!false)"), "true");
  });

  test("logical operators short circuit", () => {
    // calling undefined would throw if the right side were evaluated
    assert.equal(prints("print(false && nope)"), "false");
    assert.equal(prints("print(true || nope)"), "true");
  });
});

describe("variables and scope", () => {
  test("declaration and use", () => {
    assert.equal(prints("let x = 10\nlet y = x + 20\nprint(y)"), "30");
  });

  test("assignment updates an existing binding", () => {
    assert.equal(prints("let x = 1\nx = 2\nprint(x)"), "2");
  });

  test("compound assignment", () => {
    assert.equal(prints("let x = 5\nx += 3\nprint(x)"), "8");
    assert.equal(prints("let x = 5\nx *= 2\nprint(x)"), "10");
  });

  test("a block introduces a scope", () => {
    assert.equal(prints("let x = 1\n{\n let x = 2\n}\nprint(x)"), "1");
  });

  test("an inner scope can assign to an outer binding", () => {
    assert.equal(prints("let x = 1\n{\n x = 2\n}\nprint(x)"), "2");
  });

  test("using an undefined variable is an error", () => {
    assert.match(errorOf("print(nope)") ?? "", /Undefined variable 'nope'/);
  });

  test("assigning to an undefined variable is an error", () => {
    assert.match(errorOf("nope = 1") ?? "", /Cannot assign to undefined variable/);
  });
});

describe("control flow", () => {
  test("if and else", () => {
    assert.equal(prints('if 5 > 3 {\n print("big")\n} else {\n print("small")\n}'), "big");
    assert.equal(prints('if 1 > 3 {\n print("big")\n} else {\n print("small")\n}'), "small");
  });

  test("else if chains", () => {
    assert.equal(
      prints('let x = 0\nif x > 0 {\n print("pos")\n} else if x < 0 {\n print("neg")\n} else {\n print("zero")\n}'),
      "zero",
    );
  });

  test("while loops", () => {
    assert.deepEqual(output("let i = 0\nwhile i < 3 {\n print(i)\n i += 1\n}"), ["0", "1", "2"]);
  });

  test("break exits a loop", () => {
    assert.deepEqual(
      output("let i = 0\nwhile true {\n if i == 2 {\n  break\n }\n print(i)\n i += 1\n}"),
      ["0", "1"],
    );
  });

  test("continue skips to the next turn", () => {
    assert.deepEqual(
      output("let i = 0\nwhile i < 4 {\n i += 1\n if i % 2 == 0 {\n  continue\n }\n print(i)\n}"),
      ["1", "3"],
    );
  });

  test("for iterates arrays, strings and object keys", () => {
    assert.deepEqual(output("for x in [1,2,3] {\n print(x)\n}"), ["1", "2", "3"]);
    assert.deepEqual(output('for c in "ab" {\n print(c)\n}'), ["a", "b"]);
    assert.deepEqual(output("for k in {a: 1, b: 2} {\n print(k)\n}"), ["a", "b"]);
  });

  test("break and continue work in a for loop", () => {
    assert.deepEqual(
      output("for x in [1,2,3,4] {\n if x == 3 {\n  break\n }\n print(x)\n}"),
      ["1", "2"],
    );
  });

  test("a runaway loop is stopped by the step limit", () => {
    assert.match(
      errorOf("while true {\n let x = 1\n}") ?? "",
      /exceeded the step limit/,
    );
  });
});

describe("functions", () => {
  test("declaration and call", () => {
    assert.equal(prints("fn double(x) {\n return x * 2\n}\nprint(double(21))"), "42");
  });

  test("a function without a return yields nil", () => {
    assert.equal(prints("fn f() {\n}\nprint(f())"), "nil");
  });

  test("recursion", () => {
    assert.equal(
      prints("fn fact(n) {\n if n <= 1 {\n  return 1\n }\n return n * fact(n - 1)\n}\nprint(fact(10))"),
      "3628800",
    );
  });

  test("anonymous functions are values", () => {
    assert.equal(prints("let double = fn(x) {\n return x * 2\n}\nprint(double(4))"), "8");
  });

  // a closure captures the environment it was defined in
  test("closures capture their defining scope", () => {
    assert.equal(
      prints("fn adder(n) {\n return fn(x) {\n  return x + n\n }\n}\nlet add5 = adder(5)\nprint(add5(10))"),
      "15",
    );
  });

  test("each loop turn gets its own binding", () => {
    assert.deepEqual(
      output("let fns = []\nfor i in [1,2] {\n fns = push(fns, fn() {\n  return i\n })\n}\nfor f in fns {\n print(f())\n}"),
      ["1", "2"],
    );
  });

  test("an arity mismatch is reported", () => {
    assert.match(errorOf("fn f(a) {\n}\nf()") ?? "", /expects 1 argument\(s\) but received 0/);
  });

  test("calling a non function is an error", () => {
    assert.match(errorOf("let x = 1\nx()") ?? "", /Cannot call number/);
  });

  test("returning outside a function is an error", () => {
    assert.match(errorOf("return 1") ?? "", /Cannot return from outside a function/);
  });
});

describe("collections", () => {
  test("array indexing", () => {
    assert.equal(prints("print([10,20,30][1])"), "20");
  });

  test("a negative index counts from the end", () => {
    assert.equal(prints("print([1,2,3][-1])"), "3");
  });

  test("an out of bounds index is an error", () => {
    assert.match(errorOf("print([1][5])") ?? "", /out of bounds/);
  });

  test("index assignment mutates in place", () => {
    assert.equal(prints("let xs = [1,2]\nxs[0] = 9\nprint(xs)"), "[9, 2]");
  });

  test("object property access by dot and by key", () => {
    assert.equal(prints('let o = {a: 1}\nprint(o.a)'), "1");
    assert.equal(prints('let o = {a: 1}\nprint(o["a"])'), "1");
  });

  test("a missing property reads as nil", () => {
    assert.equal(prints("let o = {}\nprint(o.nope)"), "nil");
  });

  test("property assignment", () => {
    assert.equal(prints('let o = {}\no.a = 1\nprint(o)'), "{a: 1}");
    assert.equal(prints('let o = {}\no["b"] = 2\nprint(o)'), "{b: 2}");
  });

  test("length reads as a member", () => {
    assert.equal(prints("print([1,2,3].length)"), "3");
    assert.equal(prints('print("abcd".length)'), "4");
  });

  test("nested collections print structurally", () => {
    assert.equal(prints("print([1, [2, 3]])"), "[1, [2, 3]]");
    assert.equal(prints('print({a: [1], b: "x"})'), '{a: [1], b: "x"}');
  });
});

describe("destructuring", () => {
  test("object destructuring binds by name", () => {
    assert.equal(prints("let {a} = {a: 42, b: 1}\nprint(a)"), "42");
  });

  test("array destructuring binds by position", () => {
    assert.deepEqual(output("let [a, b] = [1, 2]\nprint(a)\nprint(b)"), ["1", "2"]);
  });

  test("a rest binding captures the tail", () => {
    assert.deepEqual(output("let [h, ...t] = [1,2,3]\nprint(h)\nprint(t)"), ["1", "[2, 3]"]);
  });
});

describe("match", () => {
  test("literal patterns", () => {
    assert.equal(prints('let m = match 2 {\n 1 -> "one"\n 2 -> "two"\n _ -> "other"\n}\nprint(m)'), "two");
  });

  test("the first matching arm wins", () => {
    assert.equal(prints('let m = match 1 {\n _ -> "wild"\n 1 -> "one"\n}\nprint(m)'), "wild");
  });

  test("array patterns match by shape", () => {
    assert.equal(prints('let m = match [1,2] {\n [1,2] -> "pair"\n _ -> "other"\n}\nprint(m)'), "pair");
    assert.equal(prints('let m = match [1,2,3] {\n [1,2] -> "pair"\n _ -> "other"\n}\nprint(m)'), "other");
  });

  test("patterns bind variables the body can use", () => {
    assert.equal(prints('let m = match [3,4] {\n [a, b] -> a + b\n}\nprint(m)'), "7");
  });

  test("a rest pattern binds the tail", () => {
    assert.equal(prints("let m = match [1,2,3] {\n [h, ...t] -> t\n}\nprint(m)"), "[2, 3]");
  });

  test("object patterns require the named keys", () => {
    assert.equal(prints('let m = match {p: 1} {\n {p} -> p\n _ -> 0\n}\nprint(m)'), "1");
  });

  test("guards run after the pattern binds", () => {
    assert.equal(
      prints('let o = {p: 5, q: 2}\nlet m = match o {\n {p, q} if p > q -> "p wins"\n _ -> "q wins"\n}\nprint(m)'),
      "p wins",
    );
  });

  test("a failing guard falls through to the next arm", () => {
    assert.equal(
      prints('let o = {p: 1, q: 2}\nlet m = match o {\n {p, q} if p > q -> "p wins"\n _ -> "q wins"\n}\nprint(m)'),
      "q wins",
    );
  });

  test("bindings do not leak between arms", () => {
    assert.match(
      errorOf('let m = match 1 {\n 2 -> "a"\n _ -> "b"\n}\nprint(a)') ?? "",
      /Undefined variable 'a'/,
    );
  });

  test("no matching arm is an error", () => {
    assert.match(errorOf('let m = match 9 {\n 1 -> "one"\n}') ?? "", /No match arm matched/);
  });

  test("nested patterns", () => {
    assert.equal(prints('let m = match [1,[2,3]] {\n [a,[b,c]] -> a + b + c\n}\nprint(m)'), "6");
  });
});

describe("prelude", () => {
  // the prelude is always in scope, so nothing needs importing
  test("print joins its arguments", () => {
    assert.equal(prints('print("a", 1, true)'), "a 1 true");
  });

  test("type reports the runtime type", () => {
    assert.deepEqual(
      output('print(type(1))\nprint(type("s"))\nprint(type(true))\nprint(type([]))\nprint(type({}))\nprint(type(print))'),
      ["number", "string", "bool", "array", "object", "function"],
    );
  });

  test("len covers strings, arrays and objects", () => {
    assert.deepEqual(output('print(len("abc"))\nprint(len([1,2]))\nprint(len({a: 1}))'), ["3", "2", "1"]);
  });

  test("array helpers", () => {
    assert.equal(prints("print(push([1], 2))"), "[1, 2]");
    assert.equal(prints("print(reverse([1,2,3]))"), "[3, 2, 1]");
    assert.equal(prints("print(range(0, 4))"), "[0, 1, 2, 3]");
    assert.equal(prints("print(contains([1,2], 2))"), "true");
  });

  test("higher order helpers", () => {
    assert.equal(prints("print(map([1,2,3], fn(v) {\n return v * 2\n}))"), "[2, 4, 6]");
    assert.equal(prints("print(filter([1,2,3,4], fn(v) {\n return v % 2 == 0\n}))"), "[2, 4]");
    assert.equal(prints("print(reduce([1,2,3,4], fn(a, b) {\n return a + b\n}, 0))"), "10");
  });

  test("object helpers", () => {
    assert.equal(prints('print(keys({a: 1, b: 2}))'), '["a", "b"]');
    assert.equal(prints('print(values({a: 1, b: 2}))'), "[1, 2]");
  });

  test("string helpers", () => {
    assert.equal(prints('print(upper("ab"))'), "AB");
    assert.equal(prints('print(split("a,b", ","))'), '["a", "b"]');
    assert.equal(prints('print(join([1,2], "-"))'), "1-2");
  });

  test("math helpers", () => {
    assert.deepEqual(output("print(abs(-3))\nprint(max(1,5,3))\nprint(floor(2.7))\nprint(sqrt(16))"),
      ["3", "5", "2", "4"]);
  });

  test("a builtin reports a bad argument type", () => {
    assert.match(errorOf('print(len(1))') ?? "", /len expects a string, array or object/);
  });

  test("a builtin reports a wrong argument count", () => {
    assert.match(errorOf("print(len())") ?? "", /expects 1 argument\(s\)/);
  });
});

describe("modules", () => {
  test("math exports constants and functions", () => {
    assert.equal(prints("from math import pi\nprint(floor(pi * 100))"), "314");
    assert.equal(prints("from math import sqrt\nprint(sqrt(25))"), "5");
  });

  // the prelude is auto imported, so spelling the import out changes nothing
  test("importing from the prelude is a legal no-op", () => {
    assert.equal(
      prints("from prelude import map, reduce, type\nprint(type(1))"),
      "number",
    );
  });

  test("an unknown module is an error", () => {
    assert.match(errorOf("from nope import x") ?? "", /Unknown module 'nope'/);
  });

  test("an unknown export is an error", () => {
    assert.match(errorOf("from math import nope") ?? "", /has no export named 'nope'/);
  });
});

describe("errors", () => {
  test("division and modulo by zero", () => {
    assert.match(errorOf("print(1 / 0)") ?? "", /Division by zero/);
    assert.match(errorOf("print(1 % 0)") ?? "", /Modulo by zero/);
  });

  test("mismatched operand types", () => {
    assert.match(errorOf('print("a" - 1)') ?? "", /Cannot apply '-' to string and number/);
  });

  test("indexing a non collection", () => {
    assert.match(errorOf("let x = 1\nprint(x[0])") ?? "", /Cannot index into number/);
  });

  test("errors carry a source position", () => {
    assert.match(errorOf("\n\nprint(nope)") ?? "", /line 3/);
  });

  test("a lex error is reported without running", () => {
    const result = execute("let x = @");
    assert.equal(result.error?.stage, "lex");
    assert.equal(result.ast, null);
  });

  test("a parse error is reported without running", () => {
    const result = execute("let x = 1 let y = 2");
    assert.equal(result.error?.stage, "parse");
    assert.equal(result.ast, null);
  });

  test("output produced before an error is retained", () => {
    const result = execute('print("before")\nprint(nope)');
    assert.deepEqual(result.output, ["before"]);
    assert.ok(result.error);
  });
});

describe("execute", () => {
  test("returns the ast alongside the output", () => {
    const result = execute('print("hi")');
    assert.equal(result.error, null);
    assert.deepEqual(result.output, ["hi"]);
    assert.equal(result.ast?.kind, "program");
  });

  test("interfaces have no runtime effect", () => {
    assert.equal(prints("interface P {\n x: number\n}\nprint(1)"), "1");
  });

  test("type annotations are ignored at runtime", () => {
    assert.equal(prints('let s: string = "ok"\nprint(s)'), "ok");
    // the checker will reject this later; the evaluator does not
    assert.equal(prints("let n: number = \"still runs\"\nprint(n)"), "still runs");
  });

  test("a whole program runs end to end", () => {
    const source = `fn fizzbuzz(n) {
  if n % 15 == 0 {
    return "fizzbuzz"
  }
  if n % 3 == 0 {
    return "fizz"
  }
  if n % 5 == 0 {
    return "buzz"
  }
  return n
}

for i in range(1, 16) {
  print(fizzbuzz(i))
}`;
    assert.deepEqual(output(source), [
      "1", "2", "fizz", "4", "buzz", "fizz", "7", "8",
      "fizz", "buzz", "11", "fizz", "13", "14", "fizzbuzz",
    ]);
  });
});
