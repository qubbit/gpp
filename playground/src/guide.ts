// the language guide shown in the playground's Guide tab.
//
// every snippet is a complete, runnable program rather than a fragment, and
// every one is covered by a test that runs it through the real evaluator. a
// guide that drifts from the language is worse than no guide.

export interface GuideSnippet {
  title: string;
  // what the reader should take away, in one or two sentences
  note: string;
  source: string;
}

export interface GuideSection {
  id: string;
  title: string;
  blurb: string;
  snippets: GuideSnippet[];
}

export const GUIDE: GuideSection[] = [
  {
    id: "basics",
    title: "The basics",
    blurb:
      "gpp is dynamically typed and runs top to bottom. Every binding uses let.",
    snippets: [
      {
        title: "Values and printing",
        note: "print takes any number of arguments and separates them with spaces.",
        source: `let name = "gpp"
let version = 0.1
let ready = true

print("hello from", name)
print("version", version, "ready:", ready)

// numbers are all floats under the hood
print(7 / 2)
print(7 % 2)`,
      },
      {
        title: "Bindings are all let",
        note:
          "There is no const, var or global. A binding can be reassigned, and an inner scope can shadow an outer one.",
        source: `let count = 1
count = count + 1
count += 1
print("count:", count)

let shadowed = "outer"
{
  // a block introduces a scope
  let shadowed = "inner"
  print(shadowed)
}
print(shadowed)`,
      },
      {
        title: "Truthiness",
        note:
          "Only false and nil are falsy. Zero and the empty string are truthy, which is deliberate: emptiness is not falseness.",
        source: `fn describe(value) {
  if value {
    return "truthy"
  }
  return "falsy"
}

print("0      ->", describe(0))
print("\\"\\"     ->", describe(""))
print("[]     ->", describe([]))
print("false  ->", describe(false))
print("nil    ->", describe(nil))`,
      },
      {
        title: "nil",
        note:
          "nil is the absence of a value. A missing key reads as nil, so compare against it rather than testing truthiness when zero is a legitimate value.",
        source: `let scores = {}
scores["ada"] = 0

print("missing key:", scores["nobody"])
print("type:", type(nil))

// truthiness cannot tell 0 apart from absent
print("truthy test says:", !(scores["ada"]))
// comparing against nil can
print("nil test says:", scores["ada"] != nil)`,
      },
    ],
  },

  {
    id: "control",
    title: "Control flow",
    blurb:
      "Conditions need no parentheses, though you may use them. Bodies always need braces.",
    snippets: [
      {
        title: "if and else",
        note: "An else if chain is just a nested if, so it reads the same way.",
        source: `fn sign(n) {
  if n > 0 {
    return "positive"
  } else if n < 0 {
    return "negative"
  } else {
    return "zero"
  }
}

for n in [3, -2, 0] {
  print(n, "is", sign(n))
}`,
      },
      {
        title: "Loops",
        note:
          "for iterates arrays, strings and object keys. while takes any condition. break and continue work in both.",
        source: `for item in ["a", "b", "c"] {
  print("item:", item)
}

for letter in "hi" {
  print("letter:", letter)
}

for key in {x: 1, y: 2} {
  print("key:", key)
}

let n = 0
while n < 5 {
  n += 1
  if n == 2 {
    continue
  }
  if n == 4 {
    break
  }
  print("n =", n)
}`,
      },
      {
        title: "Everything is an expression's home",
        note:
          "A function body yields its last statement, so an if can be the whole body. No return needed.",
        source: `fn label(n) {
  if n % 2 == 0 {
    "even"
  } else {
    "odd"
  }
}

for n in [1, 2, 3] {
  print(n, "is", label(n))
}`,
      },
      {
        title: "if as an expression",
        note:
          "An if in expression position produces a value, so it can be assigned or passed straight to a function. It needs an else, because a false condition would otherwise have nothing to evaluate to.",
        source: `fn sign(n) {
  let label = if n > 0 {
    "positive"
  } else if n < 0 {
    "negative"
  } else {
    "zero"
  }

  label
}

for n in [7, -7, 0] {
  print(n, "is", sign(n))
}

// it composes like any other expression
let n = 3
print("n is " + if n % 2 == 0 { "even" } else { "odd" })

// a branch yields its own last statement, so it can do work first
let verdict = if n > 2 {
  let doubled = n * 2
  "doubled to " + str(doubled)
} else {
  "left alone"
}
print(verdict)`,
      },
      {
        title: "Guarded return",
        note:
          "A trailing if on a return makes an early exit read in one line. When the guard is false the return does not fire and the body carries on.",
        source: `fn classify(n) {
  return "negative" if n < 0
  return "zero" if n == 0
  "positive"
}

for n in [-3, 0, 3] {
  print(n, "is", classify(n))
}

// a bare return may be guarded too, to leave early
fn describe(items) {
  return if len(items) == 0
  print("first item:", items[0])
}

describe([])
describe(["only"])`,
      },
    ],
  },

  {
    id: "functions",
    title: "Functions",
    blurb:
      "Functions are values. They close over the scope they were defined in.",
    snippets: [
      {
        title: "Declaring and calling",
        note:
          "fn declares a named function. Declarations are hoisted, so two functions can call each other regardless of order.",
        source: `fn is_even(n) {
  if n == 0 {
    return true
  }
  return is_odd(n - 1)
}

fn is_odd(n) {
  if n == 0 {
    return false
  }
  return is_even(n - 1)
}

print("4 even?", is_even(4))
print("7 odd? ", is_odd(7))`,
      },
      {
        title: "Implicit return",
        note:
          "A body that falls off the end yields its last statement's value. An explicit return still wins, and a body ending in a let or a loop yields nil.",
        source: `fn double(x) {
  x * 2
}

fn early(x) {
  if x < 0 {
    return "negative"
  }
  "not negative"
}

fn nothing() {
  let unused = 1
}

print(double(21))
print(early(-1), "/", early(1))
print("ends in let:", nothing())`,
      },
      {
        title: "Lambdas",
        note:
          "An arrow makes an anonymous function. With an expression body the result is returned; with braces it behaves like any other body.",
        source: `let square = (a) -> a * a
let greet = () -> "hello"
let hypot2 = (a, b) -> a*a + b*b

print(square(5))
print(greet())
print(hypot2(3, 4))

// a brace body can hold several statements
let describe = (x, y) -> {
  print("comparing", x, "and", y)
  x + y
}
print(describe(1, 2))

// to return an object literal, wrap it in parentheses
let point = (x) -> ({x: x, y: 0})
print(point(3))`,
      },
      {
        title: "Closures",
        note:
          "A function captures the scope it was defined in, which is what makes counters and adders work.",
        source: `fn adder(n) {
  return (x) -> x + n
}

let add5 = adder(5)
let add10 = adder(10)
print(add5(1), add10(1))

fn counter() {
  let count = 0
  return () -> {
    count += 1
    count
  }
}

let next = counter()
print(next(), next(), next())`,
      },
      {
        title: "Higher order functions",
        note:
          "map, filter and reduce come from the prelude and pair naturally with lambdas.",
        source: `let numbers = range(1, 11)

let evens = filter(numbers, (n) -> n % 2 == 0)
let squares = map(evens, (n) -> n * n)
let total = reduce(squares, (a, b) -> a + b, 0)

print("evens:  ", evens)
print("squares:", squares)
print("total:  ", total)`,
      },
    ],
  },

  {
    id: "data",
    title: "Data",
    blurb: "Arrays are ordered, objects are open records keyed by string.",
    snippets: [
      {
        title: "Arrays",
        note:
          "Index from zero, or from the end with a negative index. push returns a new array rather than mutating.",
        source: `let xs = [3, 1, 2]

print("first:", xs[0])
print("last: ", xs[-1])
print("size: ", len(xs))

// push returns a new array
let more = push(xs, 4)
print("original:", xs)
print("extended:", more)

print("reversed:", reverse(xs))
print("joined:  ", join(xs, " < "))
print("contains 2?", contains(xs, 2))`,
      },
      {
        title: "Objects",
        note:
          "Objects are open: assigning a property that does not exist adds it. The checker tracks the shape, so a mistyped field name is caught.",
        source: `let person = {name: "ada", born: 1815}

print(person.name)
print(person["born"])

// assigning a new key grows the object
person.field = "mathematics"
print(keys(person))
print(values(person))

// print(person.nmae)   // uncomment: the checker knows the shape,
                        // so a typo is an error rather than nil`,
      },

      {
        title: "Objects as lookup tables",
        note:
          "A computed key is not part of the known shape, so it reads as nil when absent. Compare against nil rather than testing truthiness, or a stored 0 looks missing.",
        source: `let stock = {}
stock["apples"] = 3
stock["pears"] = 0

for item in ["apples", "pears", "plums"] {
  let count = stock[item]

  if count == nil {
    print(item, "- not stocked")
  } else {
    print(item, "-", count, "in stock")
  }
}

// the difference matters: pears are stocked, just empty
print("truthiness would hide pears:", !(stock["pears"]))`,
      },
      {
        title: "Destructuring",
        note:
          "Pull fields out of an object by name, or elements out of an array by position. A rest binding captures what is left.",
        source: `let config = {host: "localhost", port: 8080}
let {host, port} = config
print(host, port)

let [first, second, ...rest] = [1, 2, 3, 4, 5]
print("first:", first)
print("second:", second)
print("rest:  ", rest)`,
      },
      {
        title: "Equality is structural",
        note:
          "Arrays and objects compare by content, not identity, so two separately built values can be equal.",
        source: `print([1, 2] == [1, 2])
print({a: 1} == {a: 1})
print([1, 2] == [2, 1])

// which makes contains work on nested values
let pairs = [[1, 2], [3, 4]]
print(contains(pairs, [3, 4]))`,
      },
    ],
  },

  {
    id: "match",
    title: "Pattern matching",
    blurb:
      "match tests a value against patterns in order and destructures as it goes.",
    snippets: [
      {
        title: "Matching shapes",
        note:
          "Patterns can be literals, arrays, objects or a bare name that binds. The first matching arm wins, and _ catches everything.",
        source: `fn describe(value) {
  return match value {
    []        -> "empty"
    [x]       -> "one item: " + str(x)
    [a, b]    -> "a pair summing to " + str(a + b)
    [h, ...t] -> "head " + str(h) + " and " + str(len(t)) + " more"
    _         -> "not a list"
  }
}

print(describe([]))
print(describe([42]))
print(describe([3, 4]))
print(describe([1, 2, 3]))
print(describe("hello"))`,
      },
      {
        title: "Guards",
        note:
          "An if guard runs after the pattern binds, so it can use the bound names. A failing guard falls through to the next arm.",
        source: `fn compare(point) {
  return match point {
    {x, y} if x > y -> "x leads"
    {x, y} if y > x -> "y leads"
    _               -> "level"
  }
}

print(compare({x: 5, y: 2}))
print(compare({x: 1, y: 9}))
print(compare({x: 3, y: 3}))`,
      },
      {
        title: "Match is an expression",
        note:
          "It evaluates to the arm that ran, so it can be assigned, returned or passed straight to a function.",
        source: `let code = 404

let message = match code {
  200 -> "ok"
  404 -> "not found"
  500 -> "server error"
  _   -> "unknown"
}

print(code, message)

// a block bodied arm yields its last statement too
let verdict = match 7 {
  n if n > 5 -> {
    print("checking", n)
    "big"
  }
  _ -> "small"
}
print(verdict)`,
      },
    ],
  },

  {
    id: "types",
    title: "Types",
    blurb:
      "Typing is gradual: annotations are optional, and adding one buys you checking. Open the Types tab to see the results.",
    snippets: [
      {
        title: "Annotations are optional",
        note:
          "An unannotated binding still takes its initialiser's type, so reassigning it to another type is caught.",
        source: `// inferred as number, then checked
let count = 10
// count = "ten"        // uncomment: cannot assign string to number

// explicit annotations read the same way
let label: string = "ready"
let ratios: number[] = [0.5, 1.5]
let maybe: number | nil = nil

print(count, label, ratios, maybe)`,
      },
      {
        title: "Functions and any",
        note:
          "An unannotated parameter is any, so untyped code is never rejected. Annotate and the call site starts being checked.",
        source: `// x is any, so anything goes
fn loose(x) {
  return str(x)
}
print(loose(1), loose("two"), loose(true))

// annotated, so arguments are checked
fn strict(n: number): number {
  return n * 2
}
print(strict(21))
// strict("nope")       // uncomment: cannot pass string as argument 1`,
      },
      {
        title: "Interfaces are structural",
        note:
          "Any object with the right shape satisfies an interface. Extra fields are fine; missing required ones are not.",
        source: `interface Point {
  x: number
  y: number
  label?: string
}

fn magnitude(p: Point): number {
  return sqrt(p.x * p.x + p.y * p.y)
}

print(magnitude({x: 3, y: 4}))
print(magnitude({x: 6, y: 8, label: "far", extra: true}))
// print(magnitude({x: 1}))   // uncomment: missing 'y' required by Point`,
      },
    ],
  },

  {
    id: "modules",
    title: "Modules",
    blurb:
      "The prelude is always in scope. Anything else is imported by name.",
    snippets: [
      {
        title: "The prelude",
        note:
          "print, len, type, the array helpers and the maths functions need no import. Writing the import out is legal and does nothing.",
        source: `from prelude import map, reduce, type

print(type(1), type("s"), type(true), type([]), type({}), type(nil))
print(len("hello"), len([1, 2]), len({a: 1}))
print(upper("shout"), lower("WHISPER"), trim("  tidy  "))
print(split("a,b,c", ","))
print(abs(-3), floor(2.7), ceil(2.1), sqrt(16), max(1, 5, 3))`,
      },
      {
        title: "The math module",
        note: "Other modules need a real import, and the names come into scope.",
        source: `from math import pi, sin, cos, pow

print("pi:", floor(pi * 1000) / 1000)
print("2^10:", pow(2, 10))

fn hypotenuse(a, b) {
  return sqrt(pow(a, 2) + pow(b, 2))
}
print("3,4 triangle:", hypotenuse(3, 4))`,
      },
      {
        title: "Collections",
        note:
          "The collections module is written in gpp itself. Each constructor returns an object whose fields are closures, so the calls read like methods.",
        source: `from collections import stack, queue, set, map, linked_list

let s = stack()
s.push(1)
s.push(2)
print("stack:", s.pop(), s.peek())

let q = queue()
q.push("first")
q.push("second")
print("queue:", q.pop(), q.peek())

let seen = set([1, 2, 2, 3])
print("set size:", seen.size(), "has 2:", seen.contains(2))

let ages = map([])
ages.set("ada", 36)
ages.set(1815, "a numeric key")
print("map:", ages.get("ada"), "/", ages.get(1815))

let list = linked_list()
for v in [1, 2, 3] {
  list.push(v)
}
list.reverse()
print("list:", list.to_array())`,
      },
      {
        title: "Exporting",
        note:
          "export names values from the current program. The playground has nothing to import them, but the syntax is here for completeness.",
        source: `fn area(w, h) {
  w * h
}

let unit = "cm2"

print(area(3, 4), unit)

export area, unit`,
      },
    ],
  },

  {
    id: "putting-together",
    title: "Putting it together",
    blurb: "Larger programs, using several features at once.",
    snippets: [
      {
        title: "Word frequency",
        note:
          "Objects as counters, split for tokenising, and a sort built from what the language gives you.",
        source: `let text = "the quick brown fox jumps over the lazy dog the fox"

let counts = {}
for word in split(text, " ") {
  if counts[word] == nil {
    counts[word] = 0
  }
  counts[word] += 1
}

// keys come back in insertion order
for word in keys(counts) {
  if counts[word] > 1 {
    print(word, "appears", counts[word], "times")
  }
}`,
      },
      {
        title: "Memoised fibonacci",
        note:
          "An object declared outside a function keeps its contents between calls, which is all a cache needs.",
        source: `let memo = {}

fn fib(n) {
  if n < 2 {
    return n
  }

  let key = str(n)
  if memo[key] != nil {
    return memo[key]
  }

  let value = fib(n - 1) + fib(n - 2)
  memo[key] = value
  value
}

print(fib(10))
print(fib(40))
print("cached", len(keys(memo)), "values")`,
      },
      {
        title: "A tiny pipeline",
        note:
          "Lambdas, higher order functions and destructuring composed into something you might actually write.",
        source: `let people = [
  {name: "ada", age: 36, city: "london"},
  {name: "grace", age: 45, city: "new york"},
  {name: "alan", age: 41, city: "london"}
]

let londoners = filter(people, (p) -> p.city == "london")
let names = map(londoners, (p) -> upper(p.name))
let ages = map(londoners, (p) -> p.age)
let mean = reduce(ages, (a, b) -> a + b, 0) / len(ages)

print("londoners:", join(names, ", "))
print("mean age: ", mean)

for person in people {
  let {name, age} = person
  let stage = match age {
    n if n < 40 -> "thirties"
    _           -> "forties"
  }
  print(name, "is in their", stage)
}`,
      },
    ],
  },
];

/** every snippet, flattened — used by the tests that run them. */
export const ALL_SNIPPETS: { id: string; snippet: GuideSnippet }[] =
  GUIDE.flatMap((section) =>
    section.snippets.map((snippet) => ({
      id: `${section.id}/${snippet.title}`,
      snippet,
    })),
  );
