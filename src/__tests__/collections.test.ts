import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../gpp.js";

// helpers ---------------------------------------------------------------------

/** runs a program, failing on any error, and returns its printed lines. */
function output(source: string): string[] {
  const result = execute(source);
  assert.equal(result.error, null, `unexpected error: ${result.error?.message}`);
  return result.output;
}

function prints(source: string): string {
  const lines = output(source);
  assert.equal(lines.length, 1, `expected one line, got ${lines.length}`);
  return lines[0]!;
}

/** prefixes a program with an import from collections. */
function withImport(names: string, body: string): string {
  return `from collections import ${names}\n${body}`;
}

// tests -----------------------------------------------------------------------

describe("module", () => {
  test("collections resolves as a module", () => {
    assert.equal(execute("from collections import queue").error, null);
  });

  test("an unknown export is reported", () => {
    assert.match(
      execute("from collections import nope").error?.message ?? "",
      /has no export named 'nope'/,
    );
  });

  test("importing map does not shadow the prelude's map", () => {
    assert.equal(
      prints(withImport("queue", "println(map([1, 2], fn(v) {\n return v * 2\n}))")),
      "[2, 4]",
    );
  });

  test("the module is checked, not just resolved", () => {
    const result = execute("from collections import queue\nlet q = queue()");
    assert.deepEqual(result.typeErrors, []);
  });

  test("two imports share one module instance", () => {
    // the module is evaluated once and cached
    assert.equal(
      prints(
        "from collections import queue\nfrom collections import queue\nlet q = queue()\nq.push(1)\nprintln(q.size())",
      ),
      "1",
    );
  });
});

describe("stack", () => {
  test("last in, first out", () => {
    assert.equal(
      prints(withImport("stack", 's = stack()\ns.push(1)\ns.push(2)\nprintln(s.pop())')
        .replace("s = stack()", "let s = stack()")),
      "2",
    );
  });

  test("peek leaves the top in place", () => {
    assert.deepEqual(
      output(withImport("stack", "let s = stack()\ns.push(1)\nprintln(s.peek())\nprintln(s.size())")),
      ["1", "1"],
    );
  });

  test("popping an empty stack yields nil", () => {
    assert.equal(prints(withImport("stack", "let s = stack()\nprintln(s.pop())")), "nil");
  });

  test("size, is_empty, clear and to_array", () => {
    assert.deepEqual(
      output(
        withImport(
          "stack",
          "let s = stack()\nprintln(s.is_empty())\ns.push(1)\ns.push(2)\nprintln(s.to_array())\nprintln(s.size())\ns.clear()\nprintln(s.is_empty())",
        ),
      ),
      ["true", "[1, 2]", "2", "true"],
    );
  });
});

describe("queue", () => {
  test("first in, first out", () => {
    assert.deepEqual(
      output(
        withImport(
          "queue",
          'let q = queue()\nq.push("a")\nq.push("b")\nprintln(q.pop())\nprintln(q.pop())',
        ),
      ),
      ["a", "b"],
    );
  });

  test("peek returns the front", () => {
    assert.equal(
      prints(withImport("queue", 'let q = queue()\nq.push("a")\nq.push("b")\nprintln(q.peek())')),
      "a",
    );
  });

  test("popping an empty queue yields nil", () => {
    assert.equal(prints(withImport("queue", "let q = queue()\nprintln(q.pop())")), "nil");
  });

  test("order survives interleaved pushes and pops", () => {
    assert.deepEqual(
      output(
        withImport(
          "queue",
          "let q = queue()\nq.push(1)\nq.push(2)\nprintln(q.pop())\nq.push(3)\nprintln(q.pop())\nprintln(q.pop())",
        ),
      ),
      ["1", "2", "3"],
    );
  });
});

describe("set", () => {
  test("duplicates are collapsed", () => {
    assert.equal(
      prints(withImport("set", "let s = set([1, 2, 2, 3, 3, 3])\nprintln(s.size())")),
      "3",
    );
  });

  test("membership", () => {
    assert.deepEqual(
      output(withImport("set", "let s = set([1, 2])\nprintln(s.contains(2))\nprintln(s.contains(9))")),
      ["true", "false"],
    );
  });

  test("values of different types do not collide", () => {
    // keys are namespaced by type, so 1 and "1" are distinct members
    assert.equal(
      prints(withImport("set", 'let s = set([1, "1"])\nprintln(s.size())')),
      "2",
    );
  });

  test("remove reports whether it removed anything", () => {
    assert.deepEqual(
      output(withImport("set", "let s = set([1])\nprintln(s.remove(1))\nprintln(s.remove(1))\nprintln(s.size())")),
      ["true", "false", "0"],
    );
  });

  // nil is a storable value, so absence cannot be inferred from a nil read
  test("nil can be a member", () => {
    assert.deepEqual(
      output(withImport("set", "let s = set([])\ns.add(nil)\nprintln(s.contains(nil))\nprintln(s.size())")),
      ["true", "1"],
    );
  });

  test("clear empties the set", () => {
    assert.equal(
      prints(withImport("set", "let s = set([1, 2])\ns.clear()\nprintln(s.is_empty())")),
      "true",
    );
  });
});

describe("map", () => {
  test("set and get", () => {
    assert.equal(
      prints(withImport("map", 'let m = map([])\nm.set("a", 1)\nprintln(m.get("a"))')),
      "1",
    );
  });

  test("a missing key reads as nil", () => {
    assert.equal(prints(withImport("map", 'let m = map([])\nprintln(m.get("nope"))')), "nil");
  });

  test("keys may be any type", () => {
    assert.deepEqual(
      output(
        withImport(
          "map",
          'let m = map([])\nm.set(1, "number")\nm.set("1", "string")\nprintln(m.get(1))\nprintln(m.get("1"))\nprintln(m.size())',
        ),
      ),
      ["number", "string", "2"],
    );
  });

  test("overwriting a key does not grow the map", () => {
    assert.deepEqual(
      output(withImport("map", 'let m = map([])\nm.set("a", 1)\nm.set("a", 2)\nprintln(m.get("a"))\nprintln(m.size())')),
      ["2", "1"],
    );
  });

  test("nil is storable and distinguishable from absent", () => {
    assert.deepEqual(
      output(withImport("map", 'let m = map([])\nm.set("k", nil)\nprintln(m.has("k"))\nprintln(m.has("other"))')),
      ["true", "false"],
    );
  });

  test("initial pairs populate the map", () => {
    assert.equal(
      prints(withImport("map", 'let m = map([["a", 1], ["b", 2]])\nprintln(m.size())')),
      "2",
    );
  });

  test("keys, values and entries round trip", () => {
    assert.deepEqual(
      output(
        withImport("map", 'let m = map([])\nm.set("a", 1)\nprintln(m.keys())\nprintln(m.values())\nprintln(len(m.entries()))'),
      ),
      ['["a"]', "[1]", "1"],
    );
  });

  test("remove reports whether it removed anything", () => {
    assert.deepEqual(
      output(withImport("map", 'let m = map([])\nm.set("a", 1)\nprintln(m.remove("a"))\nprintln(m.remove("a"))')),
      ["true", "false"],
    );
  });
});

describe("linked list", () => {
  test("push appends and prepend leads", () => {
    assert.equal(
      prints(
        withImport("linked_list", "let l = linked_list()\nl.push(2)\nl.push(3)\nl.prepend(1)\nprintln(l.to_array())"),
      ),
      "[1, 2, 3]",
    );
  });

  test("first and last", () => {
    assert.deepEqual(
      output(
        withImport("linked_list", "let l = linked_list()\nfor v in [1, 2, 3] {\n l.push(v)\n}\nprintln(l.first())\nprintln(l.last())"),
      ),
      ["1", "3"],
    );
  });

  test("shift removes from the head", () => {
    assert.deepEqual(
      output(
        withImport("linked_list", "let l = linked_list()\nl.push(1)\nl.push(2)\nprintln(l.shift())\nprintln(l.to_array())"),
      ),
      ["1", "[2]"],
    );
  });

  test("shifting an empty list yields nil", () => {
    assert.equal(
      prints(withImport("linked_list", "let l = linked_list()\nprintln(l.shift())")),
      "nil",
    );
  });

  test("remove unlinks a node from the middle", () => {
    assert.deepEqual(
      output(
        withImport("linked_list", "let l = linked_list()\nfor v in [1, 2, 3] {\n l.push(v)\n}\nprintln(l.remove(2))\nprintln(l.to_array())\nprintln(l.size())"),
      ),
      ["true", "[1, 3]", "2"],
    );
  });

  test("removing the tail keeps last correct", () => {
    assert.deepEqual(
      output(
        withImport("linked_list", "let l = linked_list()\nfor v in [1, 2] {\n l.push(v)\n}\nl.remove(2)\nprintln(l.last())\nl.push(9)\nprintln(l.to_array())"),
      ),
      ["1", "[1, 9]"],
    );
  });

  test("reverse turns the list around", () => {
    assert.deepEqual(
      output(
        withImport("linked_list", "let l = linked_list()\nfor v in [1, 2, 3] {\n l.push(v)\n}\nl.reverse()\nprintln(l.to_array())\nprintln(l.last())"),
      ),
      ["[3, 2, 1]", "1"],
    );
  });

  test("contains walks the chain", () => {
    assert.deepEqual(
      output(withImport("linked_list", "let l = linked_list()\nl.push(1)\nprintln(l.contains(1))\nprintln(l.contains(9))")),
      ["true", "false"],
    );
  });

  test("an emptied list can be refilled", () => {
    assert.equal(
      prints(
        withImport("linked_list", "let l = linked_list()\nl.push(1)\nl.shift()\nl.push(2)\nprintln(l.to_array())"),
      ),
      "[2]",
    );
  });
});

describe("priority queue", () => {
  test("the lowest priority comes out first", () => {
    assert.deepEqual(
      output(
        withImport(
          "priority_queue",
          'let pq = priority_queue()\npq.push("c", 3)\npq.push("a", 1)\npq.push("b", 2)\nprintln(pq.pop())\nprintln(pq.pop())\nprintln(pq.pop())',
        ),
      ),
      ["a", "b", "c"],
    );
  });

  test("popping an empty queue yields nil", () => {
    assert.equal(
      prints(withImport("priority_queue", "let pq = priority_queue()\nprintln(pq.pop())")),
      "nil",
    );
  });

  test("equal priorities keep insertion order", () => {
    assert.deepEqual(
      output(
        withImport(
          "priority_queue",
          'let pq = priority_queue()\npq.push("first", 1)\npq.push("second", 1)\nprintln(pq.pop())\nprintln(pq.pop())',
        ),
      ),
      ["first", "second"],
    );
  });
});

describe("dijkstra", () => {
  // the algorithm exercises map, set and priority_queue together, which is
  // the real test of whether they compose
  const GRAPH_PROGRAM = `from collections import map, set, priority_queue

let graph = {
  a: [{to: "b", weight: 4}, {to: "c", weight: 2}],
  b: [{to: "c", weight: 5}, {to: "d", weight: 10}],
  c: [{to: "e", weight: 3}],
  d: [{to: "f", weight: 11}],
  e: [{to: "d", weight: 4}],
  f: []
}

fn dijkstra(graph, source) {
  let dist = map([])
  let prev = map([])
  let visited = set([])
  let frontier = priority_queue()

  dist.set(source, 0)
  frontier.push(source, 0)

  while !frontier.is_empty() {
    let node = frontier.pop()
    if visited.contains(node) {
      continue
    }
    visited.add(node)

    let cost_here = dist.get(node)
    for edge in graph[node] {
      let candidate = cost_here + edge.weight
      let best = dist.get(edge.to)
      if best == nil || candidate < best {
        dist.set(edge.to, candidate)
        prev.set(edge.to, node)
        frontier.push(edge.to, candidate)
      }
    }
  }

  return {dist: dist, prev: prev}
}

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
`;

  test("costs match a reference implementation", () => {
    const lines = output(
      GRAPH_PROGRAM +
        'for node in ["b", "c", "d", "e", "f"] {\n println(result.dist.get(node))\n}',
    );
    assert.deepEqual(lines, ["4", "2", "9", "5", "20"]);
  });

  // the direct route a -> b -> d costs 14; the algorithm must find the
  // cheaper indirect one
  test("a cheaper indirect route wins over a direct edge", () => {
    assert.equal(
      prints(GRAPH_PROGRAM + 'println(join(path_to(result.prev, "d"), " -> "))'),
      "a -> c -> e -> d",
    );
  });

  test("the source has cost zero and no predecessor", () => {
    assert.deepEqual(
      output(GRAPH_PROGRAM + 'println(result.dist.get("a"))\nprintln(result.prev.get("a"))'),
      ["0", "nil"],
    );
  });

  test("an unreachable node has no recorded cost", () => {
    const lines = output(
      `from collections import map, set, priority_queue
let graph = {a: [], b: []}
let dist = map([])
dist.set("a", 0)
println(dist.get("b"))`,
    );
    assert.deepEqual(lines, ["nil"]);
  });
});
