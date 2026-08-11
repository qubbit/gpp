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
    [x]           -> "one item: {x}"
    [a, b]        -> "a pair adding to {a + b}"
    [h, ...t]     -> "head {h} and {len(t)} more"
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
  return "{upper(name)} is {age}"
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
    id: "types",
    name: "Types",
    description: "Gradual checking — open the Types tab",
    source: `// gpp is gradually typed. code without annotations is never
// rejected, and adding them buys you checking.

// inferred from the initialiser, then checked on reassignment
let count = 10
// count = "ten"     // uncomment: cannot assign string to number

// an unannotated parameter is any, so this stays flexible
fn describe(value) {
  return str(value)
}
print(describe(1), describe("two"), describe(true))

// annotate, and the call site is checked
fn twice(n: number): number {
  return n * 2
}
print(twice(21))
// twice("nope")     // uncomment: cannot pass string as argument 1

// interfaces are structural: any object with the right shape fits,
// and extra fields are fine
interface Point {
  x: number
  y: number
  label?: string
}

fn magnitude(p: Point): number {
  return sqrt(p.x * p.x + p.y * p.y)
}

print(magnitude({x: 3, y: 4}))
print(magnitude({x: 6, y: 8, label: "far", extra: true}))
// magnitude({x: 1})  // uncomment: missing 'y' required by Point

// objects are open records, so building one up is fine
let totals = {}
totals.count = count
totals.mean = count / 2
print(totals)
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

  {
    id: "collections",
    name: "Collections",
    description: "Stack, queue, set, map and linked list",
    source: `// the collections module is written in gpp itself. each constructor
// returns an object whose fields are closures over private state, so
// the calls read like methods.

from collections import stack, queue, set, map, linked_list

// last in, first out
let s = stack()
s.push("a")
s.push("b")
print("stack pop:", s.pop(), "peek:", s.peek(), "size:", s.size())

// first in, first out
let q = queue()
for job in ["one", "two", "three"] {
  q.push(job)
}
print("queue pop:", q.pop(), "next:", q.peek(), "size:", q.size())

// unique values, of any type
let seen = set([1, 2, 2, 3, 3, 3])
print("set size:", seen.size(), "has 2:", seen.contains(2))
seen.remove(2)
print("after remove:", seen.to_array())

// keys of any type, not just strings
let ages = map([])
ages.set("ada", 36)
ages.set("grace", 45)
ages.set(1815, "ada's birth year")
print("ada is", ages.get("ada"))
print("numeric key:", ages.get(1815))
print("keys:", ages.keys())

// a real linked list, with nodes and a next pointer
let list = linked_list()
for value in [2, 3, 4] {
  list.push(value)
}
list.prepend(1)
print("list:", list.to_array(), "first:", list.first(), "last:", list.last())

list.reverse()
print("reversed:", list.to_array())

list.remove(3)
print("after remove:", list.to_array(), "size:", list.size())
`,
  },

  {
    id: "dijkstra",
    name: "Dijkstra",
    description: "Shortest paths, using the collections module",
    source: `// dijkstra's shortest path, built from the collections module.
//
// the priority queue always hands back the closest unvisited node, which
// is what makes the algorithm greedy and still correct.

from collections import map, set, priority_queue

// a weighted directed graph: each node lists its outgoing edges
let graph = {
  a: [{to: "b", weight: 4}, {to: "c", weight: 2}],
  b: [{to: "c", weight: 5}, {to: "d", weight: 10}],
  c: [{to: "e", weight: 3}],
  d: [{to: "f", weight: 11}],
  e: [{to: "d", weight: 4}],
  f: []
}

fn dijkstra(graph, source) {
  let dist = map([])      // node -> best known cost
  let prev = map([])      // node -> the node we arrived from
  let visited = set([])   // nodes whose cost is final
  let frontier = priority_queue()

  dist.set(source, 0)
  frontier.push(source, 0)

  while !frontier.is_empty() {
    let node = frontier.pop()

    // the same node can be queued more than once at different costs;
    // the first time it comes out is the cheapest, so skip the rest
    if visited.contains(node) {
      continue
    }
    visited.add(node)

    let cost_here = dist.get(node)

    for edge in graph[node] {
      let candidate = cost_here + edge.weight
      let best = dist.get(edge.to)

      // nil means we have not reached this node yet
      if best == nil || candidate < best {
        dist.set(edge.to, candidate)
        prev.set(edge.to, node)
        frontier.push(edge.to, candidate)
      }
    }
  }

  return {dist: dist, prev: prev}
}

// walk the prev chain backwards from the target
fn path_to(prev, target) {
  let out = [target]
  let at = target
  while prev.get(at) != nil {
    at = prev.get(at)
    out = push(out, at)
  }
  return reverse(out)
}

let result = dijkstra(graph, "a")

print("shortest paths from a:")
for node in ["b", "c", "d", "e", "f"] {
  let cost = result.dist.get(node)
  let route = join(path_to(result.prev, node), " -> ")
  print("  {node}: cost {cost} via {route}")
}

// note d: the direct route a -> b -> d costs 14, but going
// a -> c -> e -> d costs 9, and that is what the algorithm finds.
`,
  },

  {
    id: "memo",
    name: "Memoisation",
    description: "Caching results in an object across calls",
    source: `// an object declared outside a function keeps its contents between
// calls, which is all a memo table needs.

let memo = {}

fn fib(n) {
  if n < 2 {
    return n
  }

  let key = str(n)
  // a missing key reads as null. comparing against it rather than testing
  // truthiness keeps a cached 0 or false from being recomputed.
  if memo[key] != nil {
    return memo[key]
  }

  // the recursive call is what fills the table. without it every lookup
  // misses, and null + null is an error rather than a number.
  let v = fib(n - 1) + fib(n - 2)
  memo[key] = v
  return v
}

print(fib(10))
print(fib(30))
print("memoised", len(keys(memo)), "values")

// the same shape works for any pure function. count the calls to see
// how much work the cache saves.
let squares = {}
let computed = 0

fn slow_square(n) {
  let key = str(n)
  if squares[key] != nil {
    return squares[key]
  }
  computed += 1
  squares[key] = n * n
  return squares[key]
}

for n in [4, 4, 7, 4, 7, 9] {
  print(n, "squared is", slow_square(n))
}
print("computed", computed, "of 6 lookups")
`,
  },
];

export const DEFAULT_SAMPLE = SAMPLES[0]!;
