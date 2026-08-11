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
    assert.equal(prints("println(1 + 2 * 3)"), "7");
    assert.equal(prints("println((1 + 2) * 3)"), "9");
  });

  test("division and modulo", () => {
    assert.equal(prints("println(10 / 4)"), "2.5");
    assert.equal(prints("println(7 % 3)"), "1");
  });

  test("comparison and equality", () => {
    assert.equal(prints("println(1 < 2)"), "true");
    assert.equal(prints("println(2 == 2)"), "true");
    assert.equal(prints("println(2 != 2)"), "false");
  });

  test("equality is structural for collections", () => {
    assert.equal(prints("println([1, 2] == [1, 2])"), "true");
    assert.equal(prints("println({a: 1} == {a: 1})"), "true");
    assert.equal(prints("println([1, 2] == [2, 1])"), "false");
  });

  test("string concatenation coerces the other side", () => {
    assert.equal(prints('println("a" + "b")'), "ab");
    assert.equal(prints('println("n" + 1)'), "n1");
  });

  test("arrays concatenate with +", () => {
    assert.equal(prints("println([1] + [2])"), "[1, 2]");
  });

  test("unary operators", () => {
    assert.equal(prints("println(-5)"), "-5");
    assert.equal(prints("println(!true)"), "false");
  });

  test("nil is a literal", () => {
    assert.equal(prints("println(nil)"), "nil");
    assert.equal(prints("println(type_of(nil))"), "nil");
  });

  test("a missing key compares equal to nil", () => {
    assert.equal(prints('let m = {}\nprintln(m["x"] == nil)'), "true");
    assert.equal(prints('let m = {a: 1}\nprintln(m["a"] != nil)'), "true");
  });

  // the reason the literal exists: a truthiness check would recompute a
  // cached 0, a comparison against nil does not
  test("comparing against nil distinguishes absent from falsy", () => {
    assert.equal(
      prints('let m = {}\nm["a"] = 0\nif m["a"] != nil {\n println("cached")\n}'),
      "cached",
    );
  });

  test("nil matches a nil pattern", () => {
    assert.equal(
      prints('println(match nil {\n nil -> "is nil"\n _ -> "other"\n})'),
      "is nil",
    );
    assert.equal(
      prints('println(match 1 {\n nil -> "is nil"\n _ -> "other"\n})'),
      "other",
    );
  });

  test("nil survives inside collections", () => {
    assert.equal(prints("println([1, nil, 3])"), "[1, nil, 3]");
  });

  test("truthiness covers only false and nil", () => {
    assert.equal(prints("println(!0)"), "false");
    assert.equal(prints('println(!"")'), "false");
    assert.equal(prints("println(!false)"), "true");
  });

  test("logical operators short circuit", () => {
    // calling undefined would throw if the right side were evaluated
    assert.equal(prints("println(false && nope)"), "false");
    assert.equal(prints("println(true || nope)"), "true");
  });
});

describe("for with two bindings", () => {
  test("an array yields index and value", () => {
    assert.deepEqual(
      output('for i, v in ["a", "b"] {\n println("{i}: {v}")\n}'),
      ["0: a", "1: b"],
    );
  });

  test("a string yields index and character", () => {
    assert.deepEqual(
      output('for i, c in "hi" {\n println("{i}={c}")\n}'),
      ["0=h", "1=i"],
    );
  });

  // the python-shaped case: an object walks key and value together
  test("an object yields key and value", () => {
    assert.deepEqual(
      output('for k, v in {a: 1, b: 2} {\n println("{k} -> {v}")\n}'),
      ["a -> 1", "b -> 2"],
    );
  });

  test("the single binding form is unchanged", () => {
    assert.deepEqual(output("for v in [1, 2] {\n println(v)\n}"), ["1", "2"]);
    // one binding over an object still walks its keys
    assert.deepEqual(output("for k in {a: 1, b: 2} {\n println(k)\n}"), ["a", "b"]);
  });

  test("break and continue still work", () => {
    assert.deepEqual(
      output("for i, v in [1, 2, 3, 4] {\n if i == 1 {\n  continue\n }\n if i == 3 {\n  break\n }\n println(i, v)\n}"),
      ["0 1", "2 3"],
    );
  });

  test("each turn still gets its own bindings", () => {
    assert.deepEqual(
      output('let fs = []\nfor i, v in ["a", "b"] {\n fs = push(fs, () -> "{i}{v}")\n}\nfor f in fs {\n println(f())\n}'),
      ["0a", "1b"],
    );
  });

  test("iterating a non collection is still an error", () => {
    assert.match(errorOf("for k, v in 5 {\n println(k)\n}") ?? "", /Cannot iterate over number/);
  });
});

describe("output", () => {
  test("println ends the line", () => {
    assert.deepEqual(output('println("a")\nprintln("b")'), ["a", "b"]);
  });

  // print leaves the line open, so successive calls build one line
  test("print appends without ending the line", () => {
    assert.deepEqual(
      output('print("a")\nprint("b")\nprintln("c")\nprintln("d")'),
      ["abc", "d"],
    );
  });

  test("a trailing print is still flushed", () => {
    assert.deepEqual(output('print("no newline")'), ["no newline"]);
  });

  test("both join their arguments with a space", () => {
    assert.deepEqual(output('println("a", 1, true)'), ["a 1 true"]);
  });
});

describe("sorting", () => {
  test("the default order handles numbers and strings", () => {
    assert.equal(prints("println(sort([3, 1, 2]))"), "[1, 2, 3]");
    assert.equal(
      prints('println(sort(["pear", "apple", "fig"]))'),
      '["apple", "fig", "pear"]',
    );
  });

  test("a comparator overrides the order", () => {
    assert.equal(prints("println(sort([3, 1, 2], (a, b) -> b - a))"), "[3, 2, 1]");
  });

  test("sort_by orders by a derived key", () => {
    assert.equal(
      prints('let p = [{n: "c", a: 3}, {n: "a", a: 1}]\nprintln(map(sort_by(p, (x) -> x.a), (x) -> x.n))'),
      '["a", "c"]',
    );
  });

  test("sorting does not mutate the original", () => {
    assert.deepEqual(
      output("let xs = [2, 1]\nlet ys = sort(xs)\nprintln(xs)\nprintln(ys)"),
      ["[2, 1]", "[1, 2]"],
    );
  });

  test("mixed types still sort deterministically", () => {
    assert.equal(prints('println(sort([2, "b", 1, "a"]))'), '[1, 2, "a", "b"]');
  });

  test("a comparator must return a number", () => {
    assert.match(
      errorOf('println(sort([1, 2], (a, b) -> "no"))') ?? "",
      /must return a number/,
    );
  });
});

describe("searching and aggregating", () => {
  test("index_of works on arrays and strings", () => {
    assert.equal(prints("println(index_of([1, 2, 3], 2))"), "1");
    assert.equal(prints('println(index_of("hello", "ll"))'), "2");
    // -1 rather than nil, so the result is always a number
    assert.equal(prints("println(index_of([1], 9))"), "-1");
  });

  test("find returns the first match or nil", () => {
    assert.equal(prints("println(find([1, 2, 3], (v) -> v > 1))"), "2");
    assert.equal(prints("println(find([1], (v) -> v > 9))"), "nil");
  });

  test("any and all", () => {
    assert.equal(prints("println(any([1, 2], (v) -> v > 1))"), "true");
    assert.equal(prints("println(all([1, 2], (v) -> v > 0))"), "true");
    assert.equal(prints("println(all([1, 2], (v) -> v > 1))"), "false");
  });

  test("sum, unique, flatten and zip", () => {
    assert.equal(prints("println(sum([1, 2, 3]))"), "6");
    assert.equal(prints("println(unique([1, 2, 2, 3, 1]))"), "[1, 2, 3]");
    assert.equal(prints("println(flatten([[1, 2], [3], 4]))"), "[1, 2, 3, 4]");
    assert.equal(prints('println(zip([1, 2, 3], ["a", "b"]))'), '[[1, "a"], [2, "b"]]');
  });

  test("unique compares structurally", () => {
    assert.equal(prints("println(unique([[1], [1], [2]]))"), "[[1], [2]]");
  });
});

describe("object helpers", () => {
  // remove returns a new object rather than mutating, matching push
  test("remove leaves the original alone", () => {
    assert.deepEqual(
      output('let o = {a: 1, b: 2}\nprintln(remove(o, "a"))\nprintln(o)'),
      ["{b: 2}", "{a: 1, b: 2}"],
    );
  });

  test("has reports whether a key is present", () => {
    assert.equal(prints('println(has({a: 1}, "a"))'), "true");
    assert.equal(prints('println(has({a: 1}, "z"))'), "false");
  });

  test("merge prefers the second object on a clash", () => {
    assert.equal(prints("println(merge({a: 1}, {b: 2, a: 9}))"), "{a: 9, b: 2}");
  });
});

describe("string helpers", () => {
  test("replace changes every occurrence", () => {
    assert.equal(prints('println(replace("a-b-c", "-", "+"))'), "a+b+c");
  });

  test("substring accepts negative indices", () => {
    assert.equal(prints('println(substring("hello", 1, 3))'), "el");
    assert.equal(prints('println(substring("hello", 0, -1))'), "hell");
  });

  test("starts_with and ends_with", () => {
    assert.equal(prints('println(starts_with("hello", "he"))'), "true");
    assert.equal(prints('println(ends_with("hello", "lo"))'), "true");
  });

  test("repeat and padding", () => {
    assert.equal(prints('println(repeat("ab", 3))'), "ababab");
    assert.equal(prints('println(pad_start("7", 3, "0"))'), "007");
    assert.equal(prints('println(pad_end("7", 3, "."))'), "7..");
  });

  test("chr rejects a code point outside the unicode range", () => {
    // fromCodePoint would throw a host RangeError that escapes the interpreter
    assert.match(errorOf("println(chr(-1))") ?? "", /between 0 and 1114111/);
    assert.match(errorOf("println(chr(99999999))") ?? "", /between 0 and 1114111/);
  });

  test("chars, ord and chr", () => {
    assert.equal(prints('println(chars("hi"))'), '["h", "i"]');
    assert.equal(prints('println(ord("a"))'), "97");
    assert.equal(prints("println(chr(98))"), "b");
  });
});

describe("string interpolation", () => {
  test("a hole is replaced by its value", () => {
    assert.equal(prints('let name = "gpp"\nprintln("hello {name}")'), "hello gpp");
  });

  test("a hole may hold any expression", () => {
    assert.equal(prints('let a = 2\nlet b = 3\nprintln("{a} + {b} = {a + b}")'), "2 + 3 = 5");
    assert.equal(prints('println("len is {len([1, 2, 3])}")'), "len is 3");
    assert.equal(prints('let xs = [10, 20]\nprintln("first {xs[0]}")'), "first 10");
  });

  // the case python could not lex until 3.12
  test("a hole may contain a string with its own quotes", () => {
    assert.equal(
      prints('let o = {name: "ada"}\nprintln("who: {o["name"]}")'),
      "who: ada",
    );
  });

  // a leading brace in a hole is an object literal, not a block
  test("a hole may contain braces", () => {
    assert.equal(prints('let k = "a"\nprintln("v = { {a: 1}[k] }")'), "v = 1");
  });

  test("interpolations nest", () => {
    assert.equal(prints('let x = 1\nprintln("outer {"inner {x}"}")'), "outer inner 1");
  });

  test("values are rendered the way print renders them", () => {
    assert.equal(
      prints('println("n={1} b={true} nil={nil} arr={[1, 2]}")'),
      "n=1 b=true nil=nil arr=[1, 2]",
    );
  });

  test("a doubled brace is a literal brace", () => {
    assert.equal(prints('println("{{not a hole}}")'), "{not a hole}");
  });

  test("a string with no holes is unchanged", () => {
    assert.equal(prints('println("plain")'), "plain");
  });

  test("an empty hole is rejected", () => {
    assert.match(errorOf('println("{}")') ?? "", /Empty interpolation/);
  });

  test("an unterminated hole is rejected", () => {
    assert.match(errorOf('println("{oops")') ?? "", /Unterminated interpolation/);
  });

  test("a statement in a hole is rejected", () => {
    assert.match(errorOf('println("{let x = 1}")') ?? "", /Unexpected token 'let'/);
  });

  test("an error inside a hole is still reported", () => {
    assert.match(errorOf('println("{nope}")') ?? "", /Undefined variable 'nope'/);
  });
});

describe("variables and scope", () => {
  test("declaration and use", () => {
    assert.equal(prints("let x = 10\nlet y = x + 20\nprintln(y)"), "30");
  });

  test("assignment updates an existing binding", () => {
    assert.equal(prints("let x = 1\nx = 2\nprintln(x)"), "2");
  });

  test("compound assignment", () => {
    assert.equal(prints("let x = 5\nx += 3\nprintln(x)"), "8");
    assert.equal(prints("let x = 5\nx *= 2\nprintln(x)"), "10");
  });

  test("a block introduces a scope", () => {
    assert.equal(prints("let x = 1\n{\n let x = 2\n}\nprintln(x)"), "1");
  });

  test("an inner scope can assign to an outer binding", () => {
    assert.equal(prints("let x = 1\n{\n x = 2\n}\nprintln(x)"), "2");
  });

  test("using an undefined variable is an error", () => {
    assert.match(errorOf("println(nope)") ?? "", /Undefined variable 'nope'/);
  });

  test("assigning to an undefined variable is an error", () => {
    assert.match(errorOf("nope = 1") ?? "", /Cannot assign to undefined variable/);
  });
});

describe("control flow", () => {
  test("if and else", () => {
    assert.equal(prints('if 5 > 3 {\n println("big")\n} else {\n println("small")\n}'), "big");
    assert.equal(prints('if 1 > 3 {\n println("big")\n} else {\n println("small")\n}'), "small");
  });

  test("else if chains", () => {
    assert.equal(
      prints('let x = 0\nif x > 0 {\n println("pos")\n} else if x < 0 {\n println("neg")\n} else {\n println("zero")\n}'),
      "zero",
    );
  });

  test("while loops", () => {
    assert.deepEqual(output("let i = 0\nwhile i < 3 {\n println(i)\n i += 1\n}"), ["0", "1", "2"]);
  });

  test("break exits a loop", () => {
    assert.deepEqual(
      output("let i = 0\nwhile true {\n if i == 2 {\n  break\n }\n println(i)\n i += 1\n}"),
      ["0", "1"],
    );
  });

  test("continue skips to the next turn", () => {
    assert.deepEqual(
      output("let i = 0\nwhile i < 4 {\n i += 1\n if i % 2 == 0 {\n  continue\n }\n println(i)\n}"),
      ["1", "3"],
    );
  });

  test("for iterates arrays, strings and object keys", () => {
    assert.deepEqual(output("for x in [1,2,3] {\n println(x)\n}"), ["1", "2", "3"]);
    assert.deepEqual(output('for c in "ab" {\n println(c)\n}'), ["a", "b"]);
    assert.deepEqual(output("for k in {a: 1, b: 2} {\n println(k)\n}"), ["a", "b"]);
  });

  test("break and continue work in a for loop", () => {
    assert.deepEqual(
      output("for x in [1,2,3,4] {\n if x == 3 {\n  break\n }\n println(x)\n}"),
      ["1", "2"],
    );
  });

  // the evaluator recurses on the host stack, so unbounded gpp recursion would
  // otherwise overflow it and escape as a raw RangeError
  test("unbounded recursion is stopped by the depth limit", () => {
    assert.match(
      errorOf("fn f(n) {\n return f(n + 1)\n}\nf(0)") ?? "",
      /Call depth exceeded/,
    );
  });

  test("ordinary recursion still fits within the limit", () => {
    assert.equal(
      prints("fn fib(n) {\n if n < 2 {\n  return n\n }\n return fib(n - 1) + fib(n - 2)\n}\nprintln(fib(20))"),
      "6765",
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
    assert.equal(prints("fn double(x) {\n return x * 2\n}\nprintln(double(21))"), "42");
  });

  test("an empty function body yields nil", () => {
    assert.equal(prints("fn f() {\n}\nprintln(f())"), "nil");
  });

  // a body that falls off the end yields its last statement's value
  test("a function returns its last expression implicitly", () => {
    assert.equal(prints("fn f() {\n 42\n}\nprintln(f())"), "42");
    assert.equal(prints("fn double(x) {\n x * 2\n}\nprintln(double(21))"), "42");
  });

  test("an explicit return still wins over the implicit one", () => {
    assert.equal(prints("fn f() {\n return 1\n 2\n}\nprintln(f())"), "1");
  });

  test("a statement with no value yields nil", () => {
    assert.equal(prints("fn f() {\n let x = 1\n}\nprintln(f())"), "nil");
    assert.equal(prints("fn f() {\n while false {\n }\n}\nprintln(f())"), "nil");
  });

  test("recursion", () => {
    assert.equal(
      prints("fn fact(n) {\n if n <= 1 {\n  return 1\n }\n return n * fact(n - 1)\n}\nprintln(fact(10))"),
      "3628800",
    );
  });

  test("anonymous functions are values", () => {
    assert.equal(prints("let double = fn(x) {\n return x * 2\n}\nprintln(double(4))"), "8");
  });

  // a closure captures the environment it was defined in
  test("closures capture their defining scope", () => {
    assert.equal(
      prints("fn adder(n) {\n return fn(x) {\n  return x + n\n }\n}\nlet add5 = adder(5)\nprintln(add5(10))"),
      "15",
    );
  });

  test("each loop turn gets its own binding", () => {
    assert.deepEqual(
      output("let fns = []\nfor i in [1,2] {\n fns = push(fns, fn() {\n  return i\n })\n}\nfor f in fns {\n println(f())\n}"),
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

describe("if as an expression", () => {
  test("it evaluates to the branch that ran", () => {
    const source = (n: string) =>
      `let v = if ${n} > 0 {\n "positive"\n} else if ${n} < 0 {\n "negative"\n} else {\n "zero"\n}\nprintln(v)`;
    assert.equal(prints(source("5")), "positive");
    assert.equal(prints(source("-5")), "negative");
    assert.equal(prints(source("0")), "zero");
  });

  test("a branch yields its last statement", () => {
    assert.equal(
      prints("let v = if true {\n let a = 2\n a * 21\n} else {\n 0\n}\nprintln(v)"),
      "42",
    );
  });

  test("it can be used anywhere an expression can", () => {
    assert.equal(prints('println(if 1 > 0 { "yes" } else { "no" })'), "yes");
    assert.equal(
      prints('println("n is " + if 1 > 0 { "pos" } else { "neg" })'),
      "n is pos",
    );
  });

  // without an else a false condition would have nothing to evaluate to
  test("an else is required", () => {
    assert.match(
      errorOf("let v = if true { 1 }") ?? "",
      /needs an else/,
    );
  });

  test("the statement form still works without an else", () => {
    assert.equal(prints('if 1 > 0 {\n println("pos")\n}'), "pos");
  });
});

describe("guarded return", () => {
  test("it returns only when the guard holds", () => {
    const source = "fn f(x) {\n return 5 if x > 10\n return 0\n}";
    assert.equal(prints(source + "\nprintln(f(20))"), "5");
    assert.equal(prints(source + "\nprintln(f(1))"), "0");
  });

  test("a false guard falls through to the rest of the body", () => {
    const source = 'fn f(x) {\n return "big" if x > 10\n "small"\n}';
    assert.equal(prints(source + "\nprintln(f(20))"), "big");
    assert.equal(prints(source + "\nprintln(f(1))"), "small");
  });

  // `return if done` reads as "return, if done", so the if is the guard
  test("a bare return may be guarded", () => {
    assert.deepEqual(
      output('fn f(x) {\n return if x\n println("continued")\n}\nf(false)\nf(true)'),
      ["continued"],
    );
  });

  test("an unguarded return is unaffected", () => {
    assert.equal(prints("fn f() {\n return 7\n}\nprintln(f())"), "7");
  });
});

describe("implicit return", () => {
  test("a trailing if yields the branch that ran", () => {
    const source = (n: string) =>
      `fn f(x) {\n if x > 0 {\n  "pos"\n } else {\n  "neg"\n }\n}\nprintln(f(${n}))`;
    assert.equal(prints(source("1")), "pos");
    assert.equal(prints(source("-1")), "neg");
  });

  test("an else if chain yields the branch that ran", () => {
    const source = (n: string) =>
      `fn f(x) {\n if x > 0 {\n  "pos"\n } else if x < 0 {\n  "neg"\n } else {\n  "zero"\n }\n}\nprintln(f(${n}))`;
    assert.equal(prints(source("1")), "pos");
    assert.equal(prints(source("-1")), "neg");
    assert.equal(prints(source("0")), "zero");
  });

  // there is no branch to take a value from
  test("an if with no else that did not run yields nil", () => {
    assert.equal(prints('fn f(x) {\n if x {\n  "yes"\n }\n}\nprintln(f(false))'), "nil");
  });

  test("a trailing match yields the arm that matched", () => {
    assert.equal(
      prints('fn f(x) {\n match x {\n  1 -> "one"\n  _ -> "other"\n }\n}\nprintln(f(1))'),
      "one",
    );
  });

  test("a block bodied match arm yields its last statement", () => {
    assert.equal(
      prints('let v = match 1 {\n 1 -> {\n  "from a block"\n }\n _ -> "no"\n}\nprintln(v)'),
      "from a block",
    );
  });

  test("a nested block yields its last statement", () => {
    assert.equal(prints("fn f() {\n {\n  7\n }\n}\nprintln(f())"), "7");
  });

  test("an early return inside a branch still unwinds", () => {
    assert.equal(
      prints('fn f(x) {\n if x {\n  return "early"\n }\n "fell through"\n}\nprintln(f(true))'),
      "early",
    );
    assert.equal(
      prints('fn f(x) {\n if x {\n  return "early"\n }\n "fell through"\n}\nprintln(f(false))'),
      "fell through",
    );
  });

  test("a loop contributes no value", () => {
    assert.equal(
      prints("fn f() {\n let n = 0\n while n < 3 {\n  n += 1\n }\n}\nprintln(f())"),
      "nil",
    );
  });

  test("statements before the last one are still run", () => {
    assert.deepEqual(
      output('fn f() {\n println("side effect")\n "value"\n}\nprintln(f())'),
      ["side effect", "value"],
    );
  });
});

// lambdas desugar to function_expression in the parser, so the evaluator needs
// no lambda-specific handling. these tests exist to prove that.
describe("lambdas", () => {
  test("an expression body returns implicitly", () => {
    assert.equal(prints("let sq = (a) -> a*a\nprintln(sq(5))"), "25");
  });

  test("no parameters", () => {
    assert.equal(prints('let hi = () -> "hello"\nprintln(hi())'), "hello");
  });

  test("several parameters", () => {
    assert.equal(prints("let f = (a, b) -> a*a + b*b\nprintln(f(3, 4))"), "25");
  });

  test("a brace body returns explicitly or implicitly", () => {
    assert.equal(prints("let f = (x) -> {\n return x * 2\n}\nprintln(f(21))"), "42");
    // falls off the end, so the last statement's value is returned
    assert.equal(prints("let f = (x) -> {\n x + 1\n}\nprintln(f(1))"), "2");
  });

  test("the target syntax from the design", () => {
    assert.deepEqual(
      output("let f = (x, y) -> {\n println(x)\n x + y\n}\nprintln(f(1, 2))"),
      ["1", "3"],
    );
  });

  test("a lambda captures its defining scope", () => {
    assert.equal(
      prints("fn adder(n) {\n return (x) -> x + n\n}\nlet add5 = adder(5)\nprintln(add5(10))"),
      "15",
    );
  });

  test("each loop turn gets its own capture", () => {
    assert.deepEqual(
      output("let fns = []\nfor i in [1, 2] {\n fns = push(fns, () -> i)\n}\nfor f in fns {\n println(f())\n}"),
      ["1", "2"],
    );
  });

  test("lambdas curry", () => {
    assert.equal(prints("let add = (a) -> (b) -> a + b\nprintln(add(2)(3))"), "5");
  });

  test("a lambda can be called immediately", () => {
    assert.equal(prints("println(((a) -> a*2)(21))"), "42");
  });

  test("lambdas work with the prelude's higher order functions", () => {
    assert.equal(prints("println(map([1, 2, 3], (v) -> v * 2))"), "[2, 4, 6]");
    assert.equal(
      prints("println(reduce(filter(range(1, 11), (n) -> n % 2 == 0), (a, b) -> a + b, 0))"),
      "30",
    );
  });

  test("an arity mismatch is reported", () => {
    // anonymous, so the message says "This function"
    assert.match(
      errorOf("let f = (a) -> a\nf(1, 2)") ?? "",
      /This function expects 1 argument\(s\) but received 2/,
    );
  });

  test("a lambda may be a match arm body", () => {
    assert.equal(
      prints('let g = match 1 {\n 1 -> (a) -> a*a\n _ -> (a) -> a\n}\nprintln(g(6))'),
      "36",
    );
  });

  test("returning an object literal needs parentheses", () => {
    assert.equal(prints("let f = (x) -> ({a: x})\nprintln(f(1))"), "{a: 1}");
  });
});

describe("collections", () => {
  test("array indexing", () => {
    assert.equal(prints("println([10,20,30][1])"), "20");
  });

  test("a negative index counts from the end", () => {
    assert.equal(prints("println([1,2,3][-1])"), "3");
  });

  test("an out of bounds index is an error", () => {
    assert.match(errorOf("println([1][5])") ?? "", /out of bounds/);
  });

  test("index assignment mutates in place", () => {
    assert.equal(prints("let xs = [1,2]\nxs[0] = 9\nprintln(xs)"), "[9, 2]");
  });

  test("object property access by dot and by key", () => {
    assert.equal(prints('let o = {a: 1}\nprintln(o.a)'), "1");
    assert.equal(prints('let o = {a: 1}\nprintln(o["a"])'), "1");
  });

  test("a missing property reads as nil", () => {
    assert.equal(prints("let o = {}\nprintln(o.nope)"), "nil");
  });

  test("property assignment", () => {
    assert.equal(prints('let o = {}\no.a = 1\nprintln(o)'), "{a: 1}");
    assert.equal(prints('let o = {}\no["b"] = 2\nprintln(o)'), "{b: 2}");
  });

  test("length reads as a member", () => {
    assert.equal(prints("println([1,2,3].length)"), "3");
    assert.equal(prints('println("abcd".length)'), "4");
  });

  test("nested collections print structurally", () => {
    assert.equal(prints("println([1, [2, 3]])"), "[1, [2, 3]]");
    assert.equal(prints('println({a: [1], b: "x"})'), '{a: [1], b: "x"}');
  });
});

describe("destructuring", () => {
  test("object destructuring binds by name", () => {
    assert.equal(prints("let {a} = {a: 42, b: 1}\nprintln(a)"), "42");
  });

  test("array destructuring binds by position", () => {
    assert.deepEqual(output("let [a, b] = [1, 2]\nprintln(a)\nprintln(b)"), ["1", "2"]);
  });

  test("a rest binding captures the tail", () => {
    assert.deepEqual(output("let [h, ...t] = [1,2,3]\nprintln(h)\nprintln(t)"), ["1", "[2, 3]"]);
  });
});

describe("match", () => {
  test("literal patterns", () => {
    assert.equal(prints('let m = match 2 {\n 1 -> "one"\n 2 -> "two"\n _ -> "other"\n}\nprintln(m)'), "two");
  });

  test("the first matching arm wins", () => {
    assert.equal(prints('let m = match 1 {\n _ -> "wild"\n 1 -> "one"\n}\nprintln(m)'), "wild");
  });

  test("array patterns match by shape", () => {
    assert.equal(prints('let m = match [1,2] {\n [1,2] -> "pair"\n _ -> "other"\n}\nprintln(m)'), "pair");
    assert.equal(prints('let m = match [1,2,3] {\n [1,2] -> "pair"\n _ -> "other"\n}\nprintln(m)'), "other");
  });

  test("patterns bind variables the body can use", () => {
    assert.equal(prints('let m = match [3,4] {\n [a, b] -> a + b\n}\nprintln(m)'), "7");
  });

  test("a rest pattern binds the tail", () => {
    assert.equal(prints("let m = match [1,2,3] {\n [h, ...t] -> t\n}\nprintln(m)"), "[2, 3]");
  });

  test("object patterns require the named keys", () => {
    assert.equal(prints('let m = match {p: 1} {\n {p} -> p\n _ -> 0\n}\nprintln(m)'), "1");
  });

  test("guards run after the pattern binds", () => {
    assert.equal(
      prints('let o = {p: 5, q: 2}\nlet m = match o {\n {p, q} if p > q -> "p wins"\n _ -> "q wins"\n}\nprintln(m)'),
      "p wins",
    );
  });

  test("a failing guard falls through to the next arm", () => {
    assert.equal(
      prints('let o = {p: 1, q: 2}\nlet m = match o {\n {p, q} if p > q -> "p wins"\n _ -> "q wins"\n}\nprintln(m)'),
      "q wins",
    );
  });

  test("bindings do not leak between arms", () => {
    assert.match(
      errorOf('let m = match 1 {\n 2 -> "a"\n _ -> "b"\n}\nprintln(a)') ?? "",
      /Undefined variable 'a'/,
    );
  });

  test("no matching arm is an error", () => {
    assert.match(errorOf('let m = match 9 {\n 1 -> "one"\n}') ?? "", /No match arm matched/);
  });

  test("nested patterns", () => {
    assert.equal(prints('let m = match [1,[2,3]] {\n [a,[b,c]] -> a + b + c\n}\nprintln(m)'), "6");
  });
});

describe("prelude", () => {
  // the prelude is always in scope, so nothing needs importing
  test("print joins its arguments", () => {
    assert.equal(prints('println("a", 1, true)'), "a 1 true");
  });

  test("type reports the runtime type", () => {
    assert.deepEqual(
      output('println(type_of(1))\nprintln(type_of("s"))\nprintln(type_of(true))\nprintln(type_of([]))\nprintln(type_of({}))\nprintln(type_of(print))'),
      ["number", "string", "bool", "array", "object", "function"],
    );
  });

  test("len covers strings, arrays and objects", () => {
    assert.deepEqual(output('println(len("abc"))\nprintln(len([1,2]))\nprintln(len({a: 1}))'), ["3", "2", "1"]);
  });

  test("array helpers", () => {
    assert.equal(prints("println(push([1], 2))"), "[1, 2]");
    assert.equal(prints("println(reverse([1,2,3]))"), "[3, 2, 1]");
    assert.equal(prints("println(range(0, 4))"), "[0, 1, 2, 3]");
    assert.equal(prints("println(contains([1,2], 2))"), "true");
  });

  test("higher order helpers", () => {
    assert.equal(prints("println(map([1,2,3], fn(v) {\n return v * 2\n}))"), "[2, 4, 6]");
    assert.equal(prints("println(filter([1,2,3,4], fn(v) {\n return v % 2 == 0\n}))"), "[2, 4]");
    assert.equal(prints("println(reduce([1,2,3,4], fn(a, b) {\n return a + b\n}, 0))"), "10");
  });

  test("object helpers", () => {
    assert.equal(prints('println(keys({a: 1, b: 2}))'), '["a", "b"]');
    assert.equal(prints('println(values({a: 1, b: 2}))'), "[1, 2]");
  });

  test("string helpers", () => {
    assert.equal(prints('println(upper("ab"))'), "AB");
    assert.equal(prints('println(split("a,b", ","))'), '["a", "b"]');
    assert.equal(prints('println(join([1,2], "-"))'), "1-2");
  });

  test("math helpers", () => {
    assert.deepEqual(output("println(abs(-3))\nprintln(max(1,5,3))\nprintln(floor(2.7))\nprintln(sqrt(16))"),
      ["3", "5", "2", "4"]);
  });

  test("a builtin reports a bad argument type", () => {
    assert.match(errorOf('println(len(1))') ?? "", /len expects a string, array or object/);
  });

  test("a builtin reports a wrong argument count", () => {
    assert.match(errorOf("println(len())") ?? "", /expects 1 argument\(s\)/);
  });
});

describe("modules", () => {
  test("math exports constants and functions", () => {
    assert.equal(prints("from math import pi\nprintln(floor(pi * 100))"), "314");
    assert.equal(prints("from math import sqrt\nprintln(sqrt(25))"), "5");
  });

  // the prelude is auto imported, so spelling the import out changes nothing
  test("importing from the prelude is a legal no-op", () => {
    assert.equal(
      prints("from prelude import map, reduce, type_of\nprintln(type_of(1))"),
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
    assert.match(errorOf("println(1 / 0)") ?? "", /Division by zero/);
    assert.match(errorOf("println(1 % 0)") ?? "", /Modulo by zero/);
  });

  test("mismatched operand types", () => {
    assert.match(errorOf('println("a" - 1)') ?? "", /Cannot apply '-' to string and number/);
  });

  test("indexing a non collection", () => {
    assert.match(errorOf("let x = 1\nprintln(x[0])") ?? "", /Cannot index into number/);
  });

  test("errors carry a source position", () => {
    assert.match(errorOf("\n\nprintln(nope)") ?? "", /line 3/);
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
    const result = execute('println("before")\nprintln(nope)');
    assert.deepEqual(result.output, ["before"]);
    assert.ok(result.error);
  });
});

describe("execute", () => {
  test("returns the ast alongside the output", () => {
    const result = execute('println("hi")');
    assert.equal(result.error, null);
    assert.deepEqual(result.output, ["hi"]);
    assert.equal(result.ast?.kind, "program");
  });

  test("interfaces have no runtime effect", () => {
    assert.equal(prints("interface P {\n x: number\n}\nprintln(1)"), "1");
  });

  test("type annotations are ignored at runtime", () => {
    assert.equal(prints('let s: string = "ok"\nprintln(s)'), "ok");
    // the checker will reject this later; the evaluator does not
    assert.equal(prints("let n: number = \"still runs\"\nprintln(n)"), "still runs");
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
  println(fizzbuzz(i))
}`;
    assert.deepEqual(output(source), [
      "1", "2", "fizz", "4", "buzz", "fizz", "7", "8",
      "fizz", "buzz", "11", "fizz", "13", "14", "fizzbuzz",
    ]);
  });
});
