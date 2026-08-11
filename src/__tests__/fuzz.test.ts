import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Lexer, LexError } from "../lexer.js";
import { parse, ParseError } from "../parser.js";
import { check } from "../checker.js";
import { Evaluator } from "../evaluator.js";
import { generateProgram, Random } from "../fuzz/generate.js";

// a small deterministic batch, so the properties are exercised on every run.
// `npm run fuzz` runs far more, from a random seed.
const BATCH = 400;
const SEED = 987654321;

describe("generator", () => {
  test("the prng is deterministic for a seed", () => {
    const first = new Random(42);
    const second = new Random(42);
    const a = Array.from({ length: 10 }, () => first.next());
    const b = Array.from({ length: 10 }, () => second.next());
    assert.deepEqual(a, b);
  });

  test("different seeds produce different programs", () => {
    assert.notEqual(generateProgram(1), generateProgram(2));
  });

  test("the same seed reproduces a program", () => {
    assert.equal(generateProgram(7), generateProgram(7));
  });

  test("generation always terminates", () => {
    // the fuel counter is what guarantees this; a regression would hang here
    for (let seed = 0; seed < 50; seed++) {
      assert.ok(generateProgram(seed).length > 0);
    }
  });
});

describe("properties hold across random programs", () => {
  // one test rather than 400, so a failure names the seed rather than drowning
  // the output in near-identical cases
  test(`${BATCH} generated programs satisfy every property`, () => {
    for (let i = 0; i < BATCH; i++) {
      const seed = SEED + i;
      const source = generateProgram(seed);
      const failure = checkProperties(source);
      assert.equal(failure, null, `seed ${seed}: ${failure}\n${source}`);
    }
  });
});

/** mirrors the harness in src/fuzz/run.ts, kept small enough to read here. */
function checkProperties(source: string): string | null {
  let tokens;
  try {
    tokens = new Lexer().lex(source);
  } catch (error) {
    return error instanceof LexError ? null : `lexer threw ${describeError(error)}`;
  }

  let program;
  try {
    program = parse(tokens);
  } catch (error) {
    return error instanceof ParseError ? null : `parser threw ${describeError(error)}`;
  }

  // every node has a position, a snake_case kind, and is not aliased
  const seen = new Set<object>();
  const walk = (node: unknown): string | null => {
    if (node === null || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const error = walk(item);
        if (error) return error;
      }
      return null;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.kind === "string") {
      if (seen.has(node)) return `node ${record.kind} appears twice`;
      seen.add(node);
      if (!/^[a-z][a-z_]*$/.test(record.kind)) {
        return `kind ${record.kind} is not snake_case`;
      }
      if (!Number.isInteger(record.line) || (record.line as number) < 1) {
        return `node ${record.kind} has line ${record.line}`;
      }
    }
    for (const [key, value] of Object.entries(record)) {
      if (key === "kind" || key === "line" || key === "column") continue;
      const error = walk(value);
      if (error) return error;
    }
    return null;
  };

  const nodeError = walk(program);
  if (nodeError) return nodeError;

  try {
    JSON.parse(JSON.stringify(program));
  } catch (error) {
    return `ast does not survive a json round trip: ${describeError(error)}`;
  }

  try {
    check(program);
  } catch (error) {
    return `checker threw ${describeError(error)}`;
  }

  try {
    new Evaluator().run(program, { maxSteps: 100_000, maxDepth: 200 });
  } catch (error) {
    return `evaluator threw ${describeError(error)}`;
  }

  return null;
}

function describeError(error: unknown): string {
  return error instanceof Error
    ? `${error.constructor.name}: ${error.message}`
    : String(error);
}
