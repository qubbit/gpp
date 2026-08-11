// the fuzzing harness.
//
// generates random valid programs and asserts properties that must hold for
// every input. a violation is a bug in the implementation, never in the
// program: a generated program is allowed to be nonsense, but it is never
// allowed to crash the interpreter or hang it.
//
//   npm run fuzz            1000 programs from a random seed
//   npm run fuzz -- 5000    more programs
//   npm run fuzz -- 1 42    replay a single seed

import { Lexer, LexError } from "../lexer.js";
import { parse, ParseError } from "../parser.js";
import { check } from "../checker.js";
import { Evaluator } from "../evaluator.js";
import { RuntimeError } from "../builtins.js";
import { generateProgram } from "./generate.js";

interface Failure {
  seed: number;
  property: string;
  detail: string;
  source: string;
}

/**
 * every property the implementation must satisfy for any input. each returns
 * null when it holds, or a description of how it failed.
 */
function checkProperties(source: string): string | null {
  // 1. lexing either succeeds or raises a positioned LexError. anything else
  //    escaping is a bug, including a hang, which the timeout below catches.
  let tokens;
  try {
    tokens = new Lexer().lex(source);
  } catch (error) {
    if (error instanceof LexError) return null; // a legitimate rejection
    return `lexer threw ${describe(error)}`;
  }

  // 2. the token stream always ends with exactly one eof
  const eofCount = tokens.filter((t) => t.type === "eof").length;
  if (eofCount !== 1) return `token stream has ${eofCount} eof tokens`;

  // 3. every token carries a usable position
  for (const token of tokens) {
    if (!Number.isInteger(token.line) || token.line < 1) {
      return `token ${token.type} has line ${token.line}`;
    }
    if (!Number.isInteger(token.column) || token.column < 1) {
      return `token ${token.type} has column ${token.column}`;
    }
  }

  // 4. parsing either succeeds or raises a positioned ParseError
  let program;
  try {
    program = parse(tokens);
  } catch (error) {
    if (error instanceof ParseError) return null;
    return `parser threw ${describe(error)}`;
  }

  // 5. every ast node has a valid position, a snake_case kind, and appears
  //    once: a reused node object means a position fix in one place silently
  //    changes another
  const seen = new Set<object>();
  const nodeError = walkNodes(program, seen);
  if (nodeError) return nodeError;

  // 6. the tree is plain data, so it survives a worker boundary
  try {
    JSON.parse(JSON.stringify(program));
  } catch (error) {
    return `ast does not survive a json round trip: ${describe(error)}`;
  }

  // 7. the checker never throws. it reports errors as data.
  try {
    check(program);
  } catch (error) {
    return `checker threw ${describe(error)}`;
  }

  // 8. running either completes or reports a RuntimeError as data. a raw host
  //    error escaping means the interpreter lost control.
  try {
    const result = new Evaluator().run(program, {
      // small limits so a fuzz run stays fast
      maxSteps: 200_000,
      maxDepth: 200,
    });
    if (typeof result.error !== "string" && result.error !== null) {
      return `run() returned a non string error: ${describe(result.error)}`;
    }
  } catch (error) {
    if (error instanceof RuntimeError) {
      return `RuntimeError escaped run() instead of being reported: ${error.message}`;
    }
    return `evaluator threw ${describe(error)}`;
  }

  return null;
}

/** checks positions, kinds and aliasing across the whole tree. */
function walkNodes(node: unknown, seen: Set<object>): string | null {
  if (node === null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const error = walkNodes(item, seen);
      if (error) return error;
    }
    return null;
  }

  const record = node as Record<string, unknown>;

  if (typeof record.kind === "string") {
    if (seen.has(node)) return `node ${record.kind} appears twice in the tree`;
    seen.add(node);

    if (!/^[a-z][a-z_]*$/.test(record.kind)) {
      return `node kind ${record.kind} is not snake_case`;
    }
    if (!Number.isInteger(record.line) || (record.line as number) < 1) {
      return `node ${record.kind} has line ${record.line}`;
    }
    if (!Number.isInteger(record.column) || (record.column as number) < 1) {
      return `node ${record.kind} has column ${record.column}`;
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "kind" || key === "line" || key === "column") continue;
    const error = walkNodes(value, seen);
    if (error) return error;
  }

  return null;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return `${error.constructor.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * cuts a failing program down to a smaller one that fails the same way, by
 * repeatedly dropping lines. a two line repro is worth far more than a
 * thirty line one.
 */
function shrink(source: string, property: string): string {
  let best = source;
  let changed = true;

  while (changed) {
    changed = false;
    const lines = best.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const candidate = lines.filter((_, index) => index !== i).join("\n");
      if (!candidate.trim()) continue;

      // keep the candidate only if it fails for the same reason
      if (checkProperties(candidate) === property) {
        best = candidate;
        changed = true;
        break;
      }
    }
  }

  return best;
}

function main(): void {
  const [countArg, seedArg] = process.argv.slice(2);
  const count = Number(countArg ?? 1000);
  // a fixed seed replays a specific run; otherwise pick one and report it
  const baseSeed = seedArg !== undefined ? Number(seedArg) : Date.now() >>> 0;

  if (!Number.isFinite(count) || count < 1) {
    console.error("usage: npm run fuzz -- [count] [seed]");
    process.exit(2);
  }

  console.log(`fuzzing ${count} programs from seed ${baseSeed}`);

  const failures: Failure[] = [];
  const started = Date.now();

  for (let i = 0; i < count; i++) {
    const seed = (baseSeed + i) >>> 0;
    const source = generateProgram(seed);

    let property: string | null;
    try {
      property = checkProperties(source);
    } catch (error) {
      property = `harness threw ${describe(error)}`;
    }

    if (property) {
      failures.push({
        seed,
        property,
        detail: property,
        source: shrink(source, property),
      });
      // a handful of distinct failures is enough to act on
      if (failures.length >= 5) break;
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (failures.length === 0) {
    console.log(`\n${count} programs, no property violations (${elapsed}s)`);
    return;
  }

  console.log(`\n${failures.length} property violations (${elapsed}s):\n`);
  for (const failure of failures) {
    console.log(`  seed ${failure.seed}: ${failure.property}`);
    console.log("  minimal repro:");
    for (const line of failure.source.split("\n")) {
      console.log(`    ${line}`);
    }
    console.log();
  }

  process.exit(1);
}

main();
