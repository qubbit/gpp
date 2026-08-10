import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../lexer.js";
import { parse } from "../parser.js";
import { check } from "../checker.js";
import { execute } from "../gpp.js";

// helpers ---------------------------------------------------------------------

function errorsIn(source: string): string[] {
  return check(parse(new Lexer().lex(source))).errors.map((e) => e.message);
}

/** asserts a program produces no type errors. */
function clean(source: string): void {
  const errors = errorsIn(source);
  assert.deepEqual(errors, [], `expected no errors, got: ${errors.join(" | ")}`);
}

/** asserts a program produces an error matching `pattern`. */
function rejects(source: string, pattern: RegExp): void {
  const errors = errorsIn(source);
  assert.ok(errors.length > 0, "expected a type error, got none");
  assert.ok(
    errors.some((message) => pattern.test(message)),
    `no error matched ${pattern}; got: ${errors.join(" | ")}`,
  );
}

// tests -----------------------------------------------------------------------

describe("gradual typing", () => {
  // the whole point of the design: unannotated code is never rejected
  test("an unannotated program is clean", () => {
    clean("let x = 10\nlet y = x + 20\nprint(y)");
  });

  test("an unannotated parameter is any", () => {
    clean('fn double(x) {\n return x * 2\n}\ndouble("str")\ndouble(1)');
  });

  test("an unannotated function returns any", () => {
    clean('fn f(x) {\n return x\n}\nlet n: number = f(1)\nlet s: string = f("a")');
  });

  test("any is assignable in both directions", () => {
    clean('let x: any = 1\nx = "s"\nlet n: number = x');
  });

  test("annotating a function starts checking its calls", () => {
    clean("fn twice(n: number): number {\n return n * 2\n}\ntwice(1)");
    rejects(
      'fn twice(n: number): number {\n return n * 2\n}\ntwice("s")',
      /Cannot pass string as argument 1/,
    );
  });

  test("closures over untyped values stay clean", () => {
    clean(
      "fn adder(n) {\n return fn(x) {\n  return x + n\n }\n}\nprint(adder(1)(2))",
    );
  });
});

describe("inference", () => {
  test("a binding takes the type of its initialiser", () => {
    rejects('let x = 10\nx = "no"', /Cannot assign string to number/);
    rejects('let s = "a"\ns = 1', /Cannot assign number to string/);
  });

  test("an annotation overrides the inferred type", () => {
    // the annotation is what later use is checked against
    clean("let x: any = 10\nx = \"fine\"");
  });

  test("an initialiser must match its annotation", () => {
    rejects("let s: string = 42", /Cannot assign number to string/);
  });

  test("array element types are inferred", () => {
    rejects("let xs = [1, 2]\nlet s: string = xs[0]", /Cannot assign number to string/);
  });

  test("a mixed array infers a union", () => {
    clean('let xs = [1, "a"]\nlet v: number | string = xs[0]');
  });

  test("an empty array takes its type from the context", () => {
    clean("let xs: number[] = []\nlet n: number = xs[0]");
  });

  test("arithmetic yields number", () => {
    rejects("let x = 1 + 2\nlet s: string = x", /Cannot assign number to string/);
  });

  test("comparison yields bool", () => {
    rejects("let b = 1 < 2\nlet n: number = b", /Cannot assign bool to number/);
  });

  test("concatenation yields string", () => {
    rejects('let s = "a" + 1\nlet n: number = s', /Cannot assign string to number/);
  });

  test("a function expression infers its signature", () => {
    rejects(
      'let f = fn(n: number): number {\n return n\n}\nf("s")',
      /Cannot pass string as argument 1/,
    );
  });
});

describe("functions", () => {
  test("argument types are checked", () => {
    rejects(
      'fn f(a: number, b: string) {\n return a\n}\nf(1, 2)',
      /Cannot pass number as argument 2 of type string/,
    );
  });

  test("arity is checked", () => {
    rejects(
      "fn f(a: number) {\n return a\n}\nf(1, 2)",
      /Expected 1 argument\(s\) but received 2/,
    );
    rejects("fn f(a: number) {\n return a\n}\nf()", /Expected 1 argument/);
  });

  test("the return type is checked", () => {
    rejects(
      'fn f(): number {\n return "s"\n}',
      /Cannot return string from a function declared to return number/,
    );
  });

  test("a returned value must match on every path", () => {
    rejects(
      'fn f(flag: bool): number {\n if flag {\n  return 1\n }\n return "s"\n}',
      /Cannot return string/,
    );
  });

  test("functions may be mutually recursive", () => {
    clean(
      "fn even(n: number): bool {\n if n == 0 {\n  return true\n }\n return odd(n - 1)\n}\nfn odd(n: number): bool {\n if n == 0 {\n  return false\n }\n return even(n - 1)\n}",
    );
  });

  test("a function value must match its parameter type", () => {
    clean(
      "fn apply(f: fn(number): number, v: number): number {\n return f(v)\n}\napply(fn(x: number): number {\n return x\n}, 1)",
    );
    rejects(
      'fn apply(f: fn(number): number, v: number): number {\n return f(v)\n}\napply(1, 2)',
      /Cannot pass number as argument 1/,
    );
  });

  test("calling a non function is rejected", () => {
    rejects("let x: number = 1\nx()", /Cannot call number/);
  });

  test("return outside a function is rejected", () => {
    rejects("return 1", /Cannot return from outside a function/);
  });
});

describe("interfaces are structural", () => {
  test("a matching object literal satisfies an interface", () => {
    clean(
      "interface Point {\n x: number\n y: number\n}\nfn dist(p: Point): number {\n return p.x + p.y\n}\ndist({x: 1, y: 2})",
    );
  });

  test("extra fields are allowed", () => {
    clean(
      "interface Point {\n x: number\n}\nfn dist(p: Point): number {\n return p.x\n}\ndist({x: 1, y: 2, z: 3})",
    );
  });

  test("a missing field is reported by name", () => {
    rejects(
      "interface Point {\n x: number\n y: number\n}\nfn dist(p: Point): number {\n return p.x\n}\ndist({x: 1})",
      /missing 'y' required by Point/,
    );
  });

  test("a field of the wrong type is rejected", () => {
    rejects(
      'interface Point {\n x: number\n}\nfn dist(p: Point): number {\n return p.x\n}\ndist({x: "s"})',
      /Cannot pass .* as argument 1/,
    );
  });

  test("a variable satisfies an interface by shape alone", () => {
    clean(
      "interface Point {\n x: number\n}\nlet p = {x: 1}\nfn dist(q: Point): number {\n return q.x\n}\ndist(p)",
    );
  });

  test("an unknown property is rejected", () => {
    rejects(
      "interface Point {\n x: number\n}\nfn dist(p: Point): number {\n return p.y\n}",
      /Property 'y' does not exist on Point/,
    );
  });

  test("an optional field may be absent", () => {
    clean(
      "interface Config {\n name: string\n debug?: bool\n}\nfn use(c: Config): string {\n return c.name\n}\nuse({name: \"a\"})",
    );
  });

  test("a duplicate interface is reported", () => {
    rejects(
      "interface P {\n x: number\n}\ninterface P {\n y: number\n}",
      /already declared/,
    );
  });

  test("an interface may be used before it is declared", () => {
    clean(
      "fn dist(p: Point): number {\n return p.x\n}\ninterface Point {\n x: number\n}",
    );
  });

  test("an unknown type annotation is reported", () => {
    rejects("let x: Nope = 1", /Unknown type 'Nope'/);
  });
});

describe("objects are open records", () => {
  // `let o = {}` then `o.count = 1` is ordinary gpp, so assigning a new
  // property grows the record rather than erroring
  test("assigning a new property grows the object", () => {
    clean("let o = {}\no.count = 1\nprint(o.count)");
    clean('let o = {}\no["k"] = 1\nprint(o.k)');
  });

  test("a grown property keeps its type", () => {
    rejects('let o = {}\no.count = 1\no.count = "s"', /Cannot assign string to number/);
  });

  test("reading an undeclared property is still rejected", () => {
    rejects("let o = {a: 1}\nprint(o.b)", /Property 'b' does not exist/);
  });

  test("a grown record can satisfy an interface", () => {
    clean(
      "interface P {\n x: number\n}\nlet o = {}\no.x = 1\nfn g(p: P): number {\n return p.x\n}\ng(o)",
    );
  });
});

describe("operators", () => {
  test("arithmetic requires numbers", () => {
    rejects(
      'let a: string = "s"\nlet b: number = 1\nprint(a - b)',
      /Cannot apply '-' to string and number/,
    );
  });

  test("concatenation accepts a string on either side", () => {
    clean('let s: string = "a"\nprint(s + 1)\nprint(1 + s)');
  });

  test("arrays concatenate with +", () => {
    clean("let xs: number[] = [1]\nlet ys: number[] = xs + [2]");
  });

  test("comparison requires numbers", () => {
    rejects(
      'let s: string = "a"\nlet n: number = 1\nprint(s < n)',
      /Cannot apply '<'/,
    );
  });

  test("equality accepts any operands", () => {
    clean('let s: string = "a"\nlet n: number = 1\nprint(s == n)');
  });

  test("negation requires a number", () => {
    rejects('let s: string = "a"\nprint(-s)', /Cannot negate string/);
  });

  test("not accepts anything and yields bool", () => {
    rejects('let b = !1\nlet n: number = b', /Cannot assign bool to number/);
  });

  test("compound assignment is checked", () => {
    clean("let n: number = 1\nn += 1");
    rejects('let s: string = "a"\ns -= 1', /Cannot apply '-'/);
  });
});

describe("collections and indexing", () => {
  test("an array index must be a number", () => {
    rejects(
      'let xs: number[] = [1]\nprint(xs["a"])',
      /array index must be a number/,
    );
  });

  test("indexing yields the element type", () => {
    rejects(
      "let xs: number[] = [1]\nlet s: string = xs[0]",
      /Cannot assign number to string/,
    );
  });

  test("length reads as a number", () => {
    clean('let n: number = [1, 2].length\nlet m: number = "abc".length');
  });

  test("indexing a non collection is rejected", () => {
    rejects("let n: number = 1\nprint(n[0])", /Cannot index into number/);
  });

  test("nested array types are tracked", () => {
    rejects(
      "let grid: number[][] = [[1]]\nlet s: string = grid[0][0]",
      /Cannot assign number to string/,
    );
  });
});

describe("control flow", () => {
  test("a for loop binds the element type", () => {
    clean("for x in [1, 2] {\n let n: number = x\n}");
    rejects(
      "for x in [1, 2] {\n let s: string = x\n}",
      /Cannot assign number to string/,
    );
  });

  test("iterating a string binds characters", () => {
    clean('for c in "abc" {\n let s: string = c\n}');
  });

  test("iterating a non collection is rejected", () => {
    rejects("let n: number = 1\nfor x in n {\n print(x)\n}", /Cannot iterate over number/);
  });

  test("break and continue must be inside a loop", () => {
    rejects("break", /'break' is only allowed inside a loop/);
    rejects("continue", /'continue' is only allowed inside a loop/);
    clean("while true {\n break\n}");
    clean("for x in [1] {\n continue\n}");
  });

  test("a loop outside a function does not enclose its body", () => {
    rejects(
      "while true {\n fn f() {\n  break\n }\n}",
      /'break' is only allowed inside a loop/,
    );
  });

  test("a block introduces a scope", () => {
    rejects("{\n let inner = 1\n}\nprint(inner)", /Undefined variable 'inner'/);
  });
});

describe("destructuring", () => {
  test("object destructuring takes field types", () => {
    rejects(
      "interface P {\n x: number\n}\nfn g(p: P) {\n let {x} = p\n let s: string = x\n}",
      /Cannot assign number to string/,
    );
  });

  test("destructuring an unknown field is rejected", () => {
    rejects(
      "interface P {\n x: number\n}\nfn g(p: P) {\n let {y} = p\n}",
      /Property 'y' does not exist/,
    );
  });

  test("array destructuring takes the element type", () => {
    rejects(
      "let [a, b] = [1, 2]\nlet s: string = a",
      /Cannot assign number to string/,
    );
  });

  test("a rest binding is an array", () => {
    clean("let [h, ...t] = [1, 2, 3]\nlet rest: number[] = t");
  });
});

describe("match", () => {
  test("a match yields the union of its arms", () => {
    clean('let m: string = match 1 {\n 1 -> "one"\n _ -> "other"\n}');
    rejects(
      'let m: number = match 1 {\n 1 -> "one"\n _ -> "other"\n}',
      /Cannot assign string to number/,
    );
  });

  test("patterns bind for the arm body", () => {
    clean("let m: number = match [1, 2] {\n [a, b] -> a + b\n _ -> 0\n}");
  });

  test("a guard is checked", () => {
    clean("let m: number = match 1 {\n n if n > 0 -> n\n _ -> 0\n}");
  });

  test("bindings do not leak past their arm", () => {
    rejects('let m = match 1 {\n n -> n\n}\nprint(n)', /Undefined variable 'n'/);
  });
});

describe("modules and the prelude", () => {
  test("prelude names are in scope without importing", () => {
    clean('print(len([1, 2]))\nprint(upper("a"))');
  });

  test("prelude signatures are checked", () => {
    rejects("print(upper(1))", /Cannot pass number as argument 1 of type string/);
    rejects("print(sqrt(\"a\"))", /Cannot pass string as argument 1/);
  });

  test("variadic builtins accept any arity", () => {
    clean('print()\nprint(1)\nprint(1, "a", true)');
    clean("print(max(1, 2, 3))");
  });

  test("importing from the prelude is a legal no-op", () => {
    clean("from prelude import map, reduce, type\nprint(type(1))");
  });

  test("an unknown prelude name is reported", () => {
    rejects("from prelude import nope", /prelude has no export named 'nope'/);
  });

  test("math exports are typed", () => {
    clean("from math import pi, sqrt\nlet n: number = sqrt(pi)");
    rejects('from math import sqrt\nsqrt("a")', /Cannot pass string as argument 1/);
  });

  test("an unknown module is reported", () => {
    rejects("from nope import x", /Unknown module 'nope'/);
  });

  test("an unknown export is reported", () => {
    rejects("from math import nope", /has no export named 'nope'/);
  });

  test("exporting an undefined name is reported", () => {
    rejects("export nope", /Cannot export undefined name 'nope'/);
  });
});

describe("null", () => {
  test("the literal has type null", () => {
    rejects("let n: number = null", /Cannot assign null to number/);
  });

  test("null is writable as a type", () => {
    clean("let x: null = null");
  });

  test("a nullable union accepts either side", () => {
    clean("let x: number | null = null\nx = 5");
    rejects('let x: number | null = "s"', /Cannot assign string/);
  });

  test("an optional field reads as nullable", () => {
    // absent at runtime, so the declared type is widened with null
    rejects(
      "interface C {\n debug?: bool\n}\nfn f(c: C) {\n let b: bool = c.debug\n}",
      /Cannot assign bool \| null to bool/,
    );
  });
});

describe("unions", () => {
  test("either option may be assigned", () => {
    clean('let v: number | string = 1\nv = "s"');
  });

  test("a third type is rejected", () => {
    rejects("let v: number | string = true", /Cannot assign bool/);
  });

  test("a union is not assignable to one of its options", () => {
    rejects(
      "fn f(v: number | string) {\n let n: number = v\n}",
      /Cannot assign number \| string to number/,
    );
  });

  test("an option is assignable to the union", () => {
    clean("fn f(v: number | string) {\n return v\n}\nf(1)\nf(\"s\")");
  });
});

describe("error reporting", () => {
  test("every error carries a position", () => {
    const errors = check(parse(new Lexer().lex("\n\nlet s: string = 42"))).errors;
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.line, 3);
    assert.ok(errors[0]!.column > 0);
  });

  test("checking continues past the first error", () => {
    const errors = errorsIn('let a: string = 1\nlet b: number = "s"');
    assert.equal(errors.length, 2);
  });

  test("a bad annotation does not cascade", () => {
    // resolving to any keeps one unknown type from producing errors everywhere
    const errors = errorsIn("let x: Nope = 1\nprint(x + 1)\nprint(x)");
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Unknown type 'Nope'/);
  });
});

describe("execute integration", () => {
  // checking is advisory: the evaluator is dynamically typed, so a type error
  // reports alongside whatever the program produced
  test("a type error does not stop execution", () => {
    const result = execute('let s: string = 42\nprint("still ran")');
    assert.deepEqual(result.output, ["still ran"]);
    assert.equal(result.error, null);
    assert.equal(result.typeErrors.length, 1);
  });

  test("a clean program reports no type errors", () => {
    const result = execute('print("hi")');
    assert.deepEqual(result.typeErrors, []);
  });

  test("a parse error yields no type errors", () => {
    const result = execute("let x = 1 let y = 2");
    assert.equal(result.error?.stage, "parse");
    assert.deepEqual(result.typeErrors, []);
  });
});
