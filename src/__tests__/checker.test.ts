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
    clean("let x = 10\nlet y = x + 20\nprintln(y)");
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
      "fn adder(n) {\n return fn(x) {\n  return x + n\n }\n}\nprintln(adder(1)(2))",
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
    clean("let o = {}\no.count = 1\nprintln(o.count)");
    clean('let o = {}\no["k"] = 1\nprintln(o.k)');
  });

  test("a grown property keeps its type", () => {
    rejects('let o = {}\no.count = 1\no.count = "s"', /Cannot assign string to number/);
  });

  test("reading an undeclared property is still rejected", () => {
    rejects("let o = {a: 1}\nprintln(o.b)", /Property 'b' does not exist/);
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
      'let a: string = "s"\nlet b: number = 1\nprintln(a - b)',
      /Cannot apply '-' to string and number/,
    );
  });

  test("concatenation accepts a string on either side", () => {
    clean('let s: string = "a"\nprintln(s + 1)\nprintln(1 + s)');
  });

  test("arrays concatenate with +", () => {
    clean("let xs: number[] = [1]\nlet ys: number[] = xs + [2]");
  });

  test("comparison requires numbers", () => {
    rejects(
      'let s: string = "a"\nlet n: number = 1\nprintln(s < n)',
      /Cannot apply '<'/,
    );
  });

  test("equality accepts any operands", () => {
    clean('let s: string = "a"\nlet n: number = 1\nprintln(s == n)');
  });

  test("negation requires a number", () => {
    rejects('let s: string = "a"\nprintln(-s)', /Cannot negate string/);
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
      'let xs: number[] = [1]\nprintln(xs["a"])',
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
    rejects("let n: number = 1\nprintln(n[0])", /Cannot index into number/);
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

  test("the second binding is an index for arrays, a key for objects", () => {
    clean("for i, v in [1, 2] {\n let n: number = i\n}");
    clean('for k, v in {a: 1} {\n let s: string = k\n}');
    rejects(
      "for i, v in [1, 2] {\n let s: string = i\n}",
      /Cannot assign number to string/,
    );
  });

  // the one binding form yields an object's keys, so the pair form must yield
  // its values instead rather than reusing that type
  test("the value binding takes an object's field types", () => {
    clean('for k, v in {a: 1, b: 2} {\n let n: number = v\n}');
    rejects(
      'for k, v in {a: 1} {\n let s: string = v\n}',
      /Cannot assign number to string/,
    );
  });

  test("iterating a non collection is rejected", () => {
    rejects("let n: number = 1\nfor x in n {\n println(x)\n}", /Cannot iterate over number/);
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
    rejects("{\n let inner = 1\n}\nprintln(inner)", /Undefined variable 'inner'/);
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
    rejects('let m = match 1 {\n n -> n\n}\nprintln(n)', /Undefined variable 'n'/);
  });
});

describe("modules and the prelude", () => {
  test("prelude names are in scope without importing", () => {
    clean('println(len([1, 2]))\nprintln(upper("a"))');
  });

  test("prelude signatures are checked", () => {
    rejects("println(upper(1))", /Cannot pass number as argument 1 of type string/);
    rejects("println(sqrt(\"a\"))", /Cannot pass string as argument 1/);
  });

  test("variadic builtins accept any arity", () => {
    clean('println()\nprintln(1)\nprintln(1, "a", true)');
    clean("println(max(1, 2, 3))");
  });

  test("importing from the prelude is a legal no-op", () => {
    clean("from prelude import map, reduce, type\nprintln(type(1))");
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

// lambdas are function_expression by the time the checker sees them, so no
// checker changes were needed. these tests prove the body is really visited.
describe("lambdas", () => {
  test("a lambda satisfies a function type", () => {
    clean("let f: fn(number): number = (a) -> a * 2\nprintln(f(2))");
  });

  test("a type error inside a lambda body is reported", () => {
    rejects('let f = (a) -> a - "s"', /Cannot apply '-'/);
  });

  test("an annotated parameter is checked", () => {
    clean("let f = (a: number) -> a * 2");
    rejects('let f = (a: number) -> a\nf("s")', /Cannot pass string as argument 1/);
  });

  test("an unannotated parameter stays any", () => {
    clean('let f = (a) -> a * 2\nf(1)\nf("s")');
  });

  test("a brace body is checked like a function body", () => {
    rejects('let f = (a) -> {\n return a - "s"\n}', /Cannot apply '-'/);
  });

  test("the enclosing return context is restored", () => {
    // a lambda sets expectedReturn while checking its body; a top level return
    // afterwards must still be an error
    rejects("let f = (a) -> a\nreturn 1", /Cannot return from outside a function/);
  });

  test("a lambda passed to a prelude builtin checks clean", () => {
    clean("println(map([1, 2], (v) -> v * 2))");
  });
});

describe("narrowing", () => {
  test("a nil test refines the branch", () => {
    clean("fn f(x: number | nil) {\n if x != nil {\n  let n: number = x\n }\n}");
    clean("fn f(x: number | nil) {\n if x == nil {\n } else {\n  let n: number = x\n }\n}");
  });

  test("a type test refines the branch", () => {
    clean('fn f(x: number | string) {\n if type(x) == "number" {\n  let n: number = x\n }\n}');
    clean('fn f(x: number | string) {\n if type(x) != "number" {\n  let s: string = x\n }\n}');
  });

  // the early exit idiom: reaching the next line means the guard was false
  test("a guarded return refines the rest of the block", () => {
    clean("fn f(x: number | nil): number {\n return 0 if x == nil\n return x\n}");
  });

  // the early exit idiom: if the branch always leaves, reaching the next line
  // proves the condition was false
  test("an if that always returns refines the rest of the block", () => {
    clean(
      'fn f(x: number | nil): string {\n if x == nil {\n  return "none"\n }\n return "got {x * 2}"\n}',
    );
    clean(
      'fn f(v: number | string): string {\n if type(v) == "number" {\n  return "n"\n }\n return upper(v)\n}',
    );
  });

  test("a branch that may fall through does not refine", () => {
    rejects(
      'fn f(x: number | nil) {\n if x == nil {\n  println("none")\n }\n let n: number = x\n}',
      /Cannot assign number \| nil to number/,
    );
  });

  test("a bare if refines a nilable value", () => {
    clean("fn f(x: number | nil) {\n if x {\n  let n: number = x\n }\n}");
  });

  test("and narrows both operands, not inverts", () => {
    clean(
      "fn f(x: number | nil, y: number | nil) {\n if x != nil && y != nil {\n  let a: number = x\n  let b: number = y\n }\n}",
    );
    clean("fn f(x: number | nil) {\n if !(x == nil) {\n  let n: number = x\n }\n}");
  });

  test("the wrong branch is still rejected", () => {
    rejects(
      "fn f(x: number | nil) {\n if x != nil {\n } else {\n  let n: number = x\n }\n}",
      /Cannot assign nil to number/,
    );
  });

  test("an unrelated name is not narrowed", () => {
    rejects(
      "fn f(x: number | nil, y: number | nil) {\n if x != nil {\n  let n: number = y\n }\n}",
      /Cannot assign number \| nil to number/,
    );
  });

  // a refinement belongs to its branch, not to the enclosing scope
  test("narrowing does not leak past the if", () => {
    rejects(
      "fn f(x: number | nil) {\n if x != nil {\n  let a: number = x\n }\n let n: number = x\n}",
      /Cannot assign number \| nil to number/,
    );
  });

  // narrowing must never make gradual code stricter than the author asked for
  test("an any value stays usable as anything", () => {
    clean("fn f(x) {\n if x != nil {\n  let n: number = x\n  let s: string = x\n }\n}");
  });
});

describe("exhaustive matching", () => {
  test("a bool subject must cover both values", () => {
    clean("fn f(b: bool) {\n match b {\n  true -> 1\n  false -> 2\n }\n}");
    rejects(
      "fn f(b: bool) {\n match b {\n  true -> 1\n }\n}",
      /does not cover false/,
    );
  });

  test("every member of a union must be covered", () => {
    clean("fn f(x: bool | nil) {\n match x {\n  true -> 1\n  false -> 2\n  nil -> 3\n }\n}");
    rejects(
      "fn f(x: bool | nil) {\n match x {\n  true -> 1\n  false -> 2\n }\n}",
      /does not cover nil/,
    );
  });

  test("a catch-all satisfies the check", () => {
    clean("fn f(b: bool) {\n match b {\n  true -> 1\n  _ -> 2\n }\n}");
    // a bare binding catches everything too
    clean("fn f(b: bool) {\n match b {\n  v -> v\n }\n}");
  });

  // a guard may fail even when the pattern matches, so the arm cannot be
  // counted towards coverage
  test("a guarded arm does not count as coverage", () => {
    rejects(
      "fn f(b: bool) {\n match b {\n  true if b -> 1\n  false -> 2\n }\n}",
      /does not cover true/,
    );
  });

  test("an unenumerable subject needs a catch-all", () => {
    rejects(
      'fn f(n: number) {\n match n {\n  1 -> "one"\n }\n}',
      /does not cover every other number/,
    );
    clean('fn f(n: number) {\n match n {\n  1 -> "one"\n  _ -> "other"\n }\n}');
  });

  // warning on an any subject would break the promise that unannotated code
  // is never rejected
  test("an any subject is left alone", () => {
    clean('fn f(x) {\n match x {\n  1 -> "one"\n }\n}');
    clean("fn f(v) {\n match v {\n  true -> 1\n }\n}");
  });
});

describe("nil", () => {
  test("the literal has type nil", () => {
    rejects("let n: number = nil", /Cannot assign nil to number/);
  });

  test("nil is writable as a type", () => {
    clean("let x: nil = nil");
  });

  test("a nilable union accepts either side", () => {
    clean("let x: number | nil = nil\nx = 5");
    rejects('let x: number | nil = "s"', /Cannot assign string/);
  });

  test("an optional field reads as nilable", () => {
    // absent at runtime, so the declared type is widened with nil
    rejects(
      "interface C {\n debug?: bool\n}\nfn f(c: C) {\n let b: bool = c.debug\n}",
      /Cannot assign bool \| nil to bool/,
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
    const errors = errorsIn("let x: Nope = 1\nprintln(x + 1)\nprintln(x)");
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Unknown type 'Nope'/);
  });
});

describe("execute integration", () => {
  // checking is advisory: the evaluator is dynamically typed, so a type error
  // reports alongside whatever the program produced
  test("a type error does not stop execution", () => {
    const result = execute('let s: string = 42\nprintln("still ran")');
    assert.deepEqual(result.output, ["still ran"]);
    assert.equal(result.error, null);
    assert.equal(result.typeErrors.length, 1);
  });

  test("a clean program reports no type errors", () => {
    const result = execute('println("hi")');
    assert.deepEqual(result.typeErrors, []);
  });

  test("a parse error yields no type errors", () => {
    const result = execute("let x = 1 let y = 2");
    assert.equal(result.error?.stage, "parse");
    assert.deepEqual(result.typeErrors, []);
  });
});
