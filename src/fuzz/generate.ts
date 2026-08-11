// a generator of random but valid gpp programs.
//
// random text mostly finds "this does not parse", which is already handled.
// generating programs that are syntactically valid pushes the fuzzer past the
// lexer and into the parser, evaluator and checker, where the interesting bugs
// are.

/** a small deterministic prng, so a failing run can be replayed from its seed. */
export class Random {
  private state: number;

  constructor(seed: number) {
    // avoid a zero state, which would stick
    this.state = seed >>> 0 || 0x2545f491;
  }

  /** xorshift32: short, fast, and good enough for generating test data. */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

// names the generator may bind and reference. kept short so a failing program
// stays readable when it is reported.
const NAMES = ["a", "b", "c", "d", "x", "y", "z", "n", "s", "xs"];

// prelude functions that are safe to call with generated arguments: total on
// their domain, or already reporting a gpp error rather than a host one
const SAFE_CALLS: { name: string; arity: number }[] = [
  { name: "len", arity: 1 },
  { name: "type", arity: 1 },
  { name: "str", arity: 1 },
  { name: "abs", arity: 1 },
  { name: "floor", arity: 1 },
  { name: "sqrt", arity: 1 },
  { name: "upper", arity: 1 },
  { name: "lower", arity: 1 },
  { name: "trim", arity: 1 },
  { name: "reverse", arity: 1 },
  { name: "unique", arity: 1 },
  { name: "flatten", arity: 1 },
  { name: "sum", arity: 1 },
  { name: "sort", arity: 1 },
  { name: "keys", arity: 1 },
  { name: "values", arity: 1 },
];

const BINARY = ["+", "-", "*", "/", "%", "<", ">", "<=", ">=", "==", "!="];
const LOGICAL = ["&&", "||"];

interface Context {
  random: Random;
  // names currently in scope, so a generated reference is never undefined
  scope: string[];
  // how much nesting is left, which is what stops generation recursing forever
  fuel: number;
  inLoop: boolean;
  inFunction: boolean;
}

/** generates one random program. */
export function generateProgram(seed: number, statements = 6): string {
  const context: Context = {
    random: new Random(seed),
    scope: [],
    fuel: 6,
    inLoop: false,
    inFunction: false,
  };

  const lines: string[] = [];
  for (let i = 0; i < statements; i++) {
    lines.push(generateStatement(context, 0));
  }

  return lines.join("\n");
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function generateStatement(context: Context, depth: number): string {
  const { random } = context;

  // stop nesting when fuel runs out, so generation always terminates
  const simple = context.fuel <= 0 || depth > 2;

  const choices = simple
    ? (["let", "expression", "println"] as const)
    : ([
        "let",
        "expression",
        "println",
        "if",
        "while",
        "for",
        "function",
        "match",
      ] as const);

  switch (random.pick(choices)) {
    case "let": {
      const name = random.pick(NAMES);
      const value = generateExpression(context, 0);
      // bound after generating the value, so `let a = a` cannot appear
      context.scope.push(name);
      return `${indent(depth)}let ${name} = ${value}`;
    }

    case "println":
      return `${indent(depth)}println(${generateExpression(context, 0)})`;

    case "if": {
      context.fuel--;
      const condition = generateExpression(context, 0);
      const body = generateBlock(context, depth + 1);
      if (random.chance(0.5)) {
        const alternate = generateBlock(context, depth + 1);
        return `${indent(depth)}if ${condition} {\n${body}\n${indent(depth)}} else {\n${alternate}\n${indent(depth)}}`;
      }
      return `${indent(depth)}if ${condition} {\n${body}\n${indent(depth)}}`;
    }

    case "while": {
      context.fuel--;
      // a literal false keeps the loop from spinning; the step limit would
      // catch it anyway, but that makes every run slow
      const wasInLoop = context.inLoop;
      context.inLoop = true;
      const body = generateBlock(context, depth + 1);
      context.inLoop = wasInLoop;
      return `${indent(depth)}while false {\n${body}\n${indent(depth)}}`;
    }

    case "for": {
      context.fuel--;
      const name = random.pick(NAMES);
      const iterable = generateArrayLiteral(context);
      const wasInLoop = context.inLoop;
      const saved = [...context.scope];
      context.inLoop = true;
      context.scope.push(name);

      const pair = random.chance(0.3);
      const second = pair ? random.pick(NAMES) : null;
      if (second) context.scope.push(second);

      const body = generateBlock(context, depth + 1);
      context.inLoop = wasInLoop;
      context.scope = saved;

      const bindings = second ? `${name}, ${second}` : name;
      return `${indent(depth)}for ${bindings} in ${iterable} {\n${body}\n${indent(depth)}}`;
    }

    case "function": {
      context.fuel--;
      const name = random.pick(NAMES);
      const parameter = random.pick(NAMES);
      const saved = [...context.scope];
      const wasInFunction = context.inFunction;

      context.scope.push(parameter);
      context.inFunction = true;
      const body = generateBlock(context, depth + 1);
      context.inFunction = wasInFunction;
      context.scope = saved;
      context.scope.push(name);

      return `${indent(depth)}fn ${name}(${parameter}) {\n${body}\n${indent(depth)}}`;
    }

    case "match": {
      context.fuel--;
      const subject = generateExpression(context, 0);
      const arms = [
        `${indent(depth + 1)}${generateLiteral(context)} -> ${generateExpression(context, 0)}`,
        `${indent(depth + 1)}_ -> ${generateExpression(context, 0)}`,
      ];
      return `${indent(depth)}println(match ${subject} {\n${arms.join("\n")}\n${indent(depth)}})`;
    }

    case "expression":
    default:
      return `${indent(depth)}println(${generateExpression(context, 0)})`;
  }
}

function generateBlock(context: Context, depth: number): string {
  const count = 1 + context.random.int(2);
  const saved = [...context.scope];
  const lines: string[] = [];

  for (let i = 0; i < count; i++) {
    lines.push(generateStatement(context, depth));
  }

  // a block introduces a scope, so its bindings do not escape
  context.scope = saved;
  return lines.join("\n");
}

function generateExpression(context: Context, depth: number): string {
  const { random } = context;

  if (depth > 2 || context.fuel <= 0) return generateAtom(context);

  const choices = [
    "atom",
    "atom",
    "binary",
    "logical",
    "unary",
    "call",
    "array",
    "object",
    "index",
    "interpolation",
    "lambda",
    "if",
  ] as const;

  switch (random.pick(choices)) {
    case "binary":
      return `(${generateExpression(context, depth + 1)} ${random.pick(BINARY)} ${generateExpression(context, depth + 1)})`;

    case "logical":
      return `(${generateExpression(context, depth + 1)} ${random.pick(LOGICAL)} ${generateExpression(context, depth + 1)})`;

    case "unary":
      return `${random.pick(["-", "!"])}${generateAtom(context)}`;

    case "call": {
      const fn = random.pick(SAFE_CALLS);
      const args = Array.from({ length: fn.arity }, () =>
        generateExpression(context, depth + 1),
      );
      return `${fn.name}(${args.join(", ")})`;
    }

    case "array":
      return generateArrayLiteral(context);

    case "object": {
      const count = random.int(3);
      const fields = Array.from(
        { length: count },
        (_, i) => `k${i}: ${generateExpression(context, depth + 1)}`,
      );
      return `{${fields.join(", ")}}`;
    }

    case "index":
      return `${generateArrayLiteral(context)}[0]`;

    case "interpolation":
      return `"v={${generateExpression(context, depth + 1)}}"`;

    case "lambda": {
      const parameter = random.pick(NAMES);
      const saved = [...context.scope];
      context.scope.push(parameter);
      const body = generateExpression(context, depth + 1);
      context.scope = saved;
      return `((${parameter}) -> ${body})`;
    }

    case "if":
      return `(if ${generateExpression(context, depth + 1)} { ${generateExpression(context, depth + 1)} } else { ${generateExpression(context, depth + 1)} })`;

    case "atom":
    default:
      return generateAtom(context);
  }
}

function generateArrayLiteral(context: Context): string {
  const count = context.random.int(4);
  const items = Array.from({ length: count }, () => generateAtom(context));
  return `[${items.join(", ")}]`;
}

function generateAtom(context: Context): string {
  const { random, scope } = context;

  // prefer an in-scope name when one exists, so programs actually compute
  if (scope.length > 0 && random.chance(0.4)) return random.pick(scope);

  return generateLiteral(context);
}

function generateLiteral(context: Context): string {
  const { random } = context;
  switch (random.int(5)) {
    case 0:
      return String(random.int(100));
    case 1:
      return String(random.int(1000) / 10);
    case 2:
      return `"${random.pick(["a", "bc", "", "hello"])}"`;
    case 3:
      return random.pick(["true", "false"]);
    default:
      return "nil";
  }
}
