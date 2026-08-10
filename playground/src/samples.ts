// programs the playground offers. every one is covered by a test that runs it
// through the real evaluator, so a sample can never ship broken.

export interface Sample {
  id: string;
  name: string;
  description: string;
  source: string;
}

export const SAMPLES: Sample[] = [
  {
    id: "welcome",
    name: "Welcome",
    description: "A tour of the language in one screen",
    source: `// welcome to gpp
// press Run, or edit anything and run again

let name = "world"
print("hello, " + name)

// every binding uses let, and types are optional
let count: number = 3
let items = ["alpha", "beta", "gamma"]

// functions are declared with fn
fn shout(text) {
  return upper(text) + "!"
}

for item in items {
  print(shout(item))
}

// the prelude is always in scope, no import needed
print("count:", count, "of", len(items))
`,
  },

  {
    id: "fizzbuzz",
    name: "FizzBuzz",
    description: "Loops, conditionals and early return",
    source: `// the classic, written with early returns

fn fizzbuzz(n) {
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

for i in range(1, 21) {
  print(fizzbuzz(i))
}
`,
  },

  {
    id: "match",
    name: "Pattern matching",
    description: "Array, object and guard patterns",
    source: `// match destructures as it matches

fn describe(value) {
  return match value {
    []            -> "an empty list"
    [x]           -> "one item: " + str(x)
    [a, b]        -> "a pair adding to " + str(a + b)
    [h, ...t]     -> "head " + str(h) + " and " + str(len(t)) + " more"
    _             -> "something else"
  }
}

print(describe([]))
print(describe([42]))
print(describe([3, 4]))
print(describe([1, 2, 3, 4]))
print(describe("hello"))

// guards run once the pattern has bound its names
fn compare(point) {
  return match point {
    {x, y} if x > y -> "x leads"
    {x, y} if y > x -> "y leads"
    _               -> "level"
  }
}

print(compare({x: 5, y: 2}))
print(compare({x: 1, y: 9}))
print(compare({x: 3, y: 3}))
`,
  },

  {
    id: "closures",
    name: "Closures",
    description: "Functions as values, captured scope",
    source: `// functions are values and capture the scope they were defined in

fn adder(n) {
  return fn(x) {
    return x + n
  }
}

let add5 = adder(5)
let add10 = adder(10)

print(add5(1))
print(add10(1))

// a counter keeps its own private state
fn counter() {
  let count = 0
  return fn() {
    count += 1
    return count
  }
}

let next = counter()
print(next())
print(next())
print(next())

// higher order helpers come from the prelude
let numbers = range(1, 11)
let evens = filter(numbers, fn(n) { return n % 2 == 0 })
let doubled = map(evens, fn(n) { return n * 2 })
let total = reduce(doubled, fn(a, b) { return a + b }, 0)

print("evens:", evens)
print("doubled:", doubled)
print("total:", total)
`,
  },

  {
    id: "data",
    name: "Working with data",
    description: "Objects, arrays and destructuring",
    source: `// interfaces describe shapes, and are erased at runtime for now
interface Person {
  name: string
  age: number
}

let people = [
  {name: "ada", age: 36},
  {name: "grace", age: 45},
  {name: "alan", age: 41}
]

// destructuring pulls fields out by name
fn greet(person) {
  let {name, age} = person
  return upper(name) + " is " + str(age)
}

for person in people {
  print(greet(person))
}

let ages = map(people, fn(p) { return p.age })
print("youngest:", min(ages[0], ages[1], ages[2]))
print("oldest:", max(ages[0], ages[1], ages[2]))

// objects are mutable through both dot and index access
let totals = {}
totals.count = len(people)
totals["sum"] = reduce(ages, fn(a, b) { return a + b }, 0)
print(totals)
`,
  },

  {
    id: "modules",
    name: "Imports",
    description: "The math module and the auto-imported prelude",
    source: `// the prelude is always imported, so print and friends just work.
// spelling it out is still allowed and does nothing.
from prelude import map, reduce, type

// other modules need a real import
from math import pi, sqrt, pow

print("pi is roughly", floor(pi * 1000) / 1000)
print("sqrt(144) =", sqrt(144))
print("2^10 =", pow(2, 10))

fn hypotenuse(a, b) {
  return sqrt(pow(a, 2) + pow(b, 2))
}

print("3,4 triangle:", hypotenuse(3, 4))

// type reports the runtime type of any value
let samples = [1, "two", true, [4], {five: 5}]
for value in samples {
  print(type(value), "->", value)
}
`,
  },

  {
    id: "algorithms",
    name: "Algorithms",
    description: "Recursion and while loops",
    source: `// recursion
fn fib(n) {
  if n < 2 {
    return n
  }
  return fib(n - 1) + fib(n - 2)
}

let series = []
for i in range(0, 12) {
  series = push(series, fib(i))
}
print("fibonacci:", series)

// iteration with a while loop
fn gcd(a, b) {
  while b != 0 {
    let temp = b
    b = a % b
    a = temp
  }
  return a
}

print("gcd(48, 18) =", gcd(48, 18))
print("gcd(270, 192) =", gcd(270, 192))

// build a string as you go
fn triangle(rows) {
  let out = []
  let i = 1
  while i <= rows {
    let line = ""
    let j = 0
    while j < i {
      line += "*"
      j += 1
    }
    out = push(out, line)
    i += 1
  }
  return out
}

for line in triangle(5) {
  print(line)
}
`,
  },
];

export const DEFAULT_SAMPLE = SAMPLES[0]!;
