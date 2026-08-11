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
        note:
          "println writes a line; print leaves it open so successive calls build one. Both take any number of arguments and separate them with spaces.",
        source: `let name = "gpp"
let version = 0.1
let ready = true

println("hello from", name)
println("version", version, "ready:", ready)

// print does not end the line, so these build one line together
print("building ")
print("one ")
println("line")

// numbers are all floats under the hood
println(7 / 2)
println(7 % 2)`,
      },
      {
        title: "Bindings are all let",
        note:
          "There is no const, var or global. A binding can be reassigned, and an inner scope can shadow an outer one.",
        source: `let count = 1
count = count + 1
count += 1
println("count:", count)

let shadowed = "outer"
{
  // a block introduces a scope
  let shadowed = "inner"
  println(shadowed)
}
println(shadowed)`,
      },
      {
        title: "String interpolation",
        note:
          "A brace inside a string holds an expression, not just a name. Values are rendered the way print renders them, so str() is rarely needed.",
        source: `let name = "gpp"
let items = ["a", "b", "c"]

println("hello, {name}")

// any expression fits, not only a name
println("{len(items)} items: {join(items, ", ")}")
println("2 + 3 = {2 + 3}")
println("first is {items[0]}, last is {items[-1]}")

// compare with building the string by hand
let n = 3
println("the long way: " + str(n) + " of " + str(len(items)))
println("the short way: {n} of {len(items)}")

// a hole can hold a string of its own, quotes and all
let person = {name: "ada", born: 1815}
println("{person["name"]} was born in {person.born}")

// double a brace to write one literally
println("{{not a hole}}")`,
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

println("0      ->", describe(0))
println("\\"\\"     ->", describe(""))
println("[]     ->", describe([]))
println("false  ->", describe(false))
println("nil    ->", describe(nil))`,
      },
      {
        title: "nil",
        note:
          "nil is the absence of a value. A missing key reads as nil, so compare against it rather than testing truthiness when zero is a legitimate value.",
        source: `let scores = {}
scores["ada"] = 0

println("missing key:", scores["nobody"])
println("type:", type_of(nil))

// truthiness cannot tell 0 apart from absent
println("truthy test says:", !(scores["ada"]))
// comparing against nil can
println("nil test says:", scores["ada"] != nil)`,
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
  println(n, "is", sign(n))
}`,
      },
      {
        title: "Loops",
        note:
          "for iterates arrays, strings and object keys. while takes any condition. break and continue work in both.",
        source: `for item in ["a", "b", "c"] {
  println("item:", item)
}

for letter in "hi" {
  println("letter:", letter)
}

for key in {x: 1, y: 2} {
  println("key:", key)
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
  println("n =", n)
}`,
      },
      {
        title: "Looping with an index or key",
        note:
          "A second loop variable binds the position alongside the value: the index for an array or string, the key for an object.",
        source: `// arrays give you the index
for i, name in ["ada", "grace", "alan"] {
  println("{i}: {name}")
}

// objects give you the key, the way python does
let config = {host: "localhost", port: 8080, debug: true}

for key, value in config {
  println("{key} = {value}")
}

// strings walk their characters
for i, letter in "gpp" {
  println("{i} -> {letter}")
}

// one binding still means the value for an array, the key for an object
for name in ["ada", "grace"] {
  println(name)
}
for key in config {
  println(key)
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
  println(n, "is", label(n))
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
  println(n, "is", sign(n))
}

// it composes like any other expression
let n = 3
println("n is " + if n % 2 == 0 { "even" } else { "odd" })

// a branch yields its own last statement, so it can do work first
let verdict = if n > 2 {
  let doubled = n * 2
  "doubled to {doubled}"
} else {
  "left alone"
}
println(verdict)`,
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
  println(n, "is", classify(n))
}

// a bare return may be guarded too, to leave early
fn describe(items) {
  return if len(items) == 0
  println("first item:", items[0])
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

println("4 even?", is_even(4))
println("7 odd? ", is_odd(7))`,
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

println(double(21))
println(early(-1), "/", early(1))
println("ends in let:", nothing())`,
      },
      {
        title: "Lambdas",
        note:
          "An arrow makes an anonymous function. With an expression body the result is returned; with braces it behaves like any other body.",
        source: `let square = (a) -> a * a
let greet = () -> "hello"
let hypot2 = (a, b) -> a*a + b*b

println(square(5))
println(greet())
println(hypot2(3, 4))

// a brace body can hold several statements
let describe = (x, y) -> {
  println("comparing", x, "and", y)
  x + y
}
println(describe(1, 2))

// to return an object literal, wrap it in parentheses
let point = (x) -> ({x: x, y: 0})
println(point(3))`,
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
println(add5(1), add10(1))

fn counter() {
  let count = 0
  return () -> {
    count += 1
    count
  }
}

let next = counter()
println(next(), next(), next())`,
      },
      {
        title: "Higher order functions",
        note:
          "map, filter and reduce come from the prelude and pair naturally with lambdas.",
        source: `let numbers = range(1, 11)

let evens = filter(numbers, (n) -> n % 2 == 0)
let squares = map(evens, (n) -> n * n)
let total = reduce(squares, (a, b) -> a + b, 0)

println("evens:  ", evens)
println("squares:", squares)
println("total:  ", total)`,
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

println("first:", xs[0])
println("last: ", xs[-1])
println("size: ", len(xs))

// push returns a new array
let more = push(xs, 4)
println("original:", xs)
println("extended:", more)

println("reversed:", reverse(xs))
println("joined:  ", join(xs, " < "))
println("contains 2?", contains(xs, 2))`,
      },
      {
        title: "Objects",
        note:
          "Objects are open: assigning a property that does not exist adds it. The checker tracks the shape, so a mistyped field name is caught.",
        source: `let person = {name: "ada", born: 1815}

println(person.name)
println(person["born"])

// assigning a new key grows the object
person.field = "mathematics"
println(keys(person))
println(values(person))

// println(person.nmae)   // uncomment: the checker knows the shape,
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
    println(item, "- not stocked")
  } else {
    println(item, "-", count, "in stock")
  }
}

// the difference matters: pears are stocked, just empty
println("truthiness would hide pears:", !(stock["pears"]))`,
      },
      {
        title: "Destructuring",
        note:
          "Pull fields out of an object by name, or elements out of an array by position. A rest binding captures what is left.",
        source: `let config = {host: "localhost", port: 8080}
let {host, port} = config
println(host, port)

let [first, second, ...rest] = [1, 2, 3, 4, 5]
println("first:", first)
println("second:", second)
println("rest:  ", rest)`,
      },
      {
        title: "Equality is structural",
        note:
          "Arrays and objects compare by content, not identity, so two separately built values can be equal.",
        source: `println([1, 2] == [1, 2])
println({a: 1} == {a: 1})
println([1, 2] == [2, 1])

// which makes contains work on nested values
let pairs = [[1, 2], [3, 4]]
println(contains(pairs, [3, 4]))`,
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
    [x]       -> "one item: {x}"
    [a, b]    -> "a pair summing to {a + b}"
    [h, ...t] -> "head {h} and {len(t)} more"
    _         -> "not a list"
  }
}

println(describe([]))
println(describe([42]))
println(describe([3, 4]))
println(describe([1, 2, 3]))
println(describe("hello"))`,
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

println(compare({x: 5, y: 2}))
println(compare({x: 1, y: 9}))
println(compare({x: 3, y: 3}))`,
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

println(code, message)

// a block bodied arm yields its last statement too
let verdict = match 7 {
  n if n > 5 -> {
    println("checking", n)
    "big"
  }
  _ -> "small"
}
println(verdict)`,
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

println(count, label, ratios, maybe)`,
      },
      {
        title: "Functions and any",
        note:
          "An unannotated parameter is any, so untyped code is never rejected. Annotate and the call site starts being checked.",
        source: `// x is any, so anything goes
fn loose(x) {
  return str(x)
}
println(loose(1), loose("two"), loose(true))

// annotated, so arguments are checked
fn strict(n: number): number {
  return n * 2
}
println(strict(21))
// strict("nope")       // uncomment: cannot pass string as argument 1`,
      },
      {
        title: "Tagged variants",
        note:
          "A type declaration defines a set of variants. Each becomes a constructor taking its fields in order, and matching one narrows its fields inside that arm.",
        source: `type Result =
  | Ok {value: any}
  | Err {message: string}

fn divide(a, b): Result {
  if b == 0 {
    return Err("cannot divide by zero")
  }
  Ok(a / b)
}

fn render(r: Result): string {
  return match r {
    Ok {value}    -> "got {value}"
    // message is known to be a string here, so upper() is fine
    Err {message} -> "failed: {upper(message)}"
  }
}

println(render(divide(10, 2)))
println(render(divide(1, 0)))

// a variant prints as the call that built it
println(Ok(5), Err("nope"))
println(type_of(Ok(5)))

// variants can carry several fields, or none at all
type Shape =
  | Circle {radius: number}
  | Rect {w: number, h: number}
  | Empty

fn area(s: Shape): number {
  return match s {
    Circle {radius} -> 3.14159 * radius * radius
    Rect {w, h}     -> w * h
    Empty {}        -> 0
  }
}

println(area(Circle(2)))
println(area(Rect(3, 4)))
println(area(Empty()))

// a variant carries its name, so a bare object is not one even when the
// fields line up. that is what lets match tell the cases apart.
// let bad: Result = {value: 5}   // uncomment: use Ok(5) instead

// dropping an arm is reported: open the Types tab after uncommenting
// fn partial(s: Shape) {
//   match s {
//     Circle {radius} -> radius
//   }
// }`,
      },
      {
        title: "Narrowing",
        note:
          "Testing a value refines its type inside the branch, so a union becomes usable without a cast. The refinement belongs to that branch only.",
        source: `fn describe(value: number | nil): string {
  // outside the test, value could be either
  if value == nil {
    return "nothing"
  }

  // in here the checker knows it is a number
  return "the number {value * 2}"
}

println(describe(21))
println(describe(nil))

// a guarded return refines everything after it
fn double_or_zero(x: number | nil): number {
  return 0 if x == nil
  // x is a number from here on
  x * 2
}

println(double_or_zero(5), double_or_zero(nil))

// testing with type_of() works the same way
fn render(v: number | string): string {
  if type_of(v) == "number" {
    return "number: {v + 0}"
  }
  return "string: {upper(v)}"
}

println(render(7))
println(render("hi"))`,
      },
      {
        title: "Exhaustive matching",
        note:
          "When the checker knows every value a subject can take, it reports a match that misses one. Add the missing case or a _ arm. An unannotated value is left alone.",
        source: `interface Point {
  x: number
  y: number
}

// bool has two values, so both must be handled
fn describe(flag: bool): string {
  return match flag {
    true -> "on"
    false -> "off"
  }
}

println(describe(true), describe(false))

// uncomment the last arm below and the warning goes away.
// open the Types tab to see it.
fn label(v: bool | nil): string {
  return match v {
    true -> "yes"
    false -> "no"
    _ -> "unset"
  }
}

println(label(true), label(nil))

// a guard may not run, so an arm that has one does not count as coverage
fn sign(n: number): string {
  return match n {
    v if v > 0 -> "positive"
    v if v < 0 -> "negative"
    _ -> "zero"
  }
}

println(sign(3), sign(-3), sign(0))`,
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

println(magnitude({x: 3, y: 4}))
println(magnitude({x: 6, y: 8, label: "far", extra: true}))
// println(magnitude({x: 1}))   // uncomment: missing 'y' required by Point`,
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
          "println, len, type, the array helpers and the maths functions need no import. Writing the import out is legal and does nothing.",
        source: `from prelude import map, reduce, type_of

println(type_of(1), type_of("s"), type_of(true), type_of([]), type_of({}), type_of(nil))
println(len("hello"), len([1, 2]), len({a: 1}))
println(upper("shout"), lower("WHISPER"), trim("  tidy  "))
println(split("a,b,c", ","))
println(abs(-3), floor(2.7), ceil(2.1), sqrt(16), max(1, 5, 3))`,
      },
      {
        title: "Sorting",
        note:
          "sort uses a natural order: numbers numerically, strings lexicographically. Pass a comparator to override it, or use sort_by to order by a derived key.",
        source: `let numbers = [5, 3, 9, 1]
let words = ["pear", "apple", "fig"]

println(sort(numbers))
println(sort(words))

// a comparator returns a negative number to put a before b
println(sort(numbers, (a, b) -> b - a))

// sort_by reads better when ordering records by a field
let people = [
  {name: "carol", age: 41},
  {name: "alice", age: 36},
  {name: "bob", age: 45}
]

for person in sort_by(people, (p) -> p.age) {
  println("{person.name} is {person.age}")
}

// sorting returns a new array, so the original is untouched
println("original still:", numbers)`,
      },
      {
        title: "Searching and aggregating",
        note:
          "find returns the first match or nil, index_of returns a position or -1, and any/all answer questions about the whole array.",
        source: `let numbers = [4, 8, 15, 16, 23, 42]

println("first over 10:", find(numbers, (n) -> n > 10))
println("nothing matches:", find(numbers, (n) -> n > 99))

println("position of 15:", index_of(numbers, 15))
println("not present:", index_of(numbers, 7))

println("any odd?", any(numbers, (n) -> n % 2 == 1))
println("all positive?", all(numbers, (n) -> n > 0))

println("sum:", sum(numbers))
println("unique:", unique([1, 2, 2, 3, 1]))
println("flatten:", flatten([[1, 2], [3], 4]))
println("zip:", zip(["a", "b"], [1, 2]))`,
      },
      {
        title: "Working with text",
        note:
          "The string helpers cover the everyday cases. substring accepts negative indices, counting from the end the way array indexing does.",
        source: `let title = "  the gpp language  "
let clean = trim(title)

println("[{clean}]")
println(upper(clean))
println(replace(clean, " ", "-"))
println("starts with 'the'?", starts_with(clean, "the"))
println("substring:", substring(clean, 4, 7))
println("last four:", substring(clean, -4, len(clean)))

// building a table with pad
let rows = [["name", "qty"], ["apples", "12"], ["pears", "3"]]
for row in rows {
  println(pad_end(row[0], 10, ".") + row[1])
}

// characters and codes
println(chars("hi"))
println(ord("a"), chr(98))`,
      },
      {
        title: "The math module",
        note: "Other modules need a real import, and the names come into scope.",
        source: `from math import pi, sin, cos, pow

println("pi:", floor(pi * 1000) / 1000)
println("2^10:", pow(2, 10))

fn hypotenuse(a, b) {
  return sqrt(pow(a, 2) + pow(b, 2))
}
println("3,4 triangle:", hypotenuse(3, 4))`,
      },
      {
        title: "Collections",
        note:
          "The collections module is written in gpp itself. Each constructor returns an object whose fields are closures, so the calls read like methods.",
        source: `from collections import stack, queue, set, map, linked_list

let s = stack()
s.push(1)
s.push(2)
println("stack:", s.pop(), s.peek())

let q = queue()
q.push("first")
q.push("second")
println("queue:", q.pop(), q.peek())

let seen = set([1, 2, 2, 3])
println("set size:", seen.size(), "has 2:", seen.contains(2))

let ages = map([])
ages.set("ada", 36)
ages.set(1815, "a numeric key")
println("map:", ages.get("ada"), "/", ages.get(1815))

let list = linked_list()
for v in [1, 2, 3] {
  list.push(v)
}
list.reverse()
println("list:", list.to_array())`,
      },
      {
        title: "Exporting",
        note:
          "export names values from the current program. The playground has nothing to import them, but the syntax is here for completeness.",
        source: `fn area(w, h) {
  w * h
}

let unit = "cm2"

println(area(3, 4), unit)

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

// two bindings walk key and value together, in insertion order
for word, count in counts {
  if count > 1 {
    println("{word} appears {count} times")
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

println(fib(10))
println(fib(40))
println("cached", len(keys(memo)), "values")`,
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

println("londoners:", join(names, ", "))
println("mean age: ", mean)

for person in people {
  let {name, age} = person
  let stage = match age {
    n if n < 40 -> "thirties"
    _           -> "forties"
  }
  println(name, "is in their", stage)
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
