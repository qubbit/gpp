// the prelude and the built-in modules.
//
// prelude names are always in scope; a program never has to import them.
// `from prelude import map, reduce` is still legal and simply re-binds names
// that are already there.

import {
  Environment,
  isCallable,
  isObject,
  stringify,
  typeName,
  valuesEqual,
  type NativeFunction,
  type ObjectValue,
  type Value,
} from "./values.js";

export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly line = 0,
    public readonly column = 0,
  ) {
    super(line ? `${message} (line ${line}, column ${column})` : message);
    this.name = "RuntimeError";
  }
}

/** how the interpreter calls back into user functions from a builtin. */
export type Applier = (callee: Value, args: Value[]) => Value;

function native(
  name: string,
  arity: number | null,
  call: (args: Value[]) => Value,
): NativeFunction {
  return { kind: "native", name, arity, call };
}

function expectNumber(value: Value, fn: string, position: string): number {
  if (typeof value !== "number") {
    throw new RuntimeError(`${fn} expects a number as its ${position} argument`);
  }
  return value;
}

function expectString(value: Value, fn: string, position: string): string {
  if (typeof value !== "string") {
    throw new RuntimeError(`${fn} expects a string as its ${position} argument`);
  }
  return value;
}

function expectArray(value: Value, fn: string, position: string): Value[] {
  if (!Array.isArray(value)) {
    throw new RuntimeError(`${fn} expects an array as its ${position} argument`);
  }
  return value;
}

/**
 * builds the prelude. `write` receives each line `print` produces and `apply`
 * lets the higher order builtins call back into gpp functions.
 */
export function createPrelude(
  write: (line: string) => void,
  apply: Applier,
): Record<string, Value> {
  const prelude: Record<string, Value> = {
    // --- output ---
    print: native("print", null, (args) => {
      write(args.map((arg) => stringify(arg)).join(" "));
      return null;
    }),

    // --- reflection ---
    type: native("type", 1, ([value]) => typeName(value as Value)),

    len: native("len", 1, ([value]) => {
      if (typeof value === "string") return value.length;
      if (Array.isArray(value)) return value.length;
      if (isObject(value as Value)) return Object.keys(value as ObjectValue).length;
      throw new RuntimeError("len expects a string, array or object");
    }),

    // --- arrays ---
    push: native("push", 2, ([array, value]) => {
      const items = expectArray(array as Value, "push", "first");
      // returns a new array so values behave predictably when shared
      return [...items, value as Value];
    }),

    pop: native("pop", 1, ([array]) => {
      const items = expectArray(array as Value, "pop", "first");
      return items.length ? items[items.length - 1]! : null;
    }),

    slice: native("slice", 3, ([array, from, to]) => {
      const items = expectArray(array as Value, "slice", "first");
      return items.slice(
        expectNumber(from as Value, "slice", "second"),
        expectNumber(to as Value, "slice", "third"),
      );
    }),

    concat: native("concat", 2, ([a, b]) => [
      ...expectArray(a as Value, "concat", "first"),
      ...expectArray(b as Value, "concat", "second"),
    ]),

    reverse: native("reverse", 1, ([array]) =>
      [...expectArray(array as Value, "reverse", "first")].reverse(),
    ),

    contains: native("contains", 2, ([haystack, needle]) => {
      if (typeof haystack === "string") {
        return haystack.includes(expectString(needle as Value, "contains", "second"));
      }
      return expectArray(haystack as Value, "contains", "first").some((item) =>
        valuesEqual(item, needle as Value),
      );
    }),

    range: native("range", 2, ([from, to]) => {
      const start = expectNumber(from as Value, "range", "first");
      const end = expectNumber(to as Value, "range", "second");
      const out: Value[] = [];
      for (let i = start; i < end; i++) out.push(i);
      return out;
    }),

    // --- higher order ---
    map: native("map", 2, ([array, fn]) => {
      const items = expectArray(array as Value, "map", "first");
      if (!isCallable(fn as Value)) {
        throw new RuntimeError("map expects a function as its second argument");
      }
      return items.map((item) => apply(fn as Value, [item]));
    }),

    filter: native("filter", 2, ([array, fn]) => {
      const items = expectArray(array as Value, "filter", "first");
      if (!isCallable(fn as Value)) {
        throw new RuntimeError("filter expects a function as its second argument");
      }
      return items.filter((item) => apply(fn as Value, [item]) !== false);
    }),

    reduce: native("reduce", 3, ([array, fn, initial]) => {
      const items = expectArray(array as Value, "reduce", "first");
      if (!isCallable(fn as Value)) {
        throw new RuntimeError("reduce expects a function as its second argument");
      }
      return items.reduce(
        (acc, item) => apply(fn as Value, [acc, item]),
        initial as Value,
      );
    }),

    // --- objects ---
    keys: native("keys", 1, ([object]) => {
      if (!isObject(object as Value)) {
        throw new RuntimeError("keys expects an object");
      }
      return Object.keys(object as ObjectValue);
    }),

    values: native("values", 1, ([object]) => {
      if (!isObject(object as Value)) {
        throw new RuntimeError("values expects an object");
      }
      return Object.values(object as ObjectValue);
    }),

    // --- strings ---
    upper: native("upper", 1, ([value]) =>
      expectString(value as Value, "upper", "first").toUpperCase(),
    ),
    lower: native("lower", 1, ([value]) =>
      expectString(value as Value, "lower", "first").toLowerCase(),
    ),
    trim: native("trim", 1, ([value]) =>
      expectString(value as Value, "trim", "first").trim(),
    ),
    split: native("split", 2, ([value, separator]) =>
      expectString(value as Value, "split", "first").split(
        expectString(separator as Value, "split", "second"),
      ),
    ),
    join: native("join", 2, ([array, separator]) =>
      expectArray(array as Value, "join", "first")
        .map((item) => stringify(item))
        .join(expectString(separator as Value, "join", "second")),
    ),
    str: native("str", 1, ([value]) => stringify(value as Value)),
    num: native("num", 1, ([value]) => {
      const parsed = Number(expectString(value as Value, "num", "first"));
      if (Number.isNaN(parsed)) throw new RuntimeError("num received a non numeric string");
      return parsed;
    }),

    // --- math that belongs in every program ---
    abs: native("abs", 1, ([v]) => Math.abs(expectNumber(v as Value, "abs", "first"))),
    min: native("min", null, (args) =>
      Math.min(...args.map((a) => expectNumber(a, "min", "each"))),
    ),
    max: native("max", null, (args) =>
      Math.max(...args.map((a) => expectNumber(a, "max", "each"))),
    ),
    floor: native("floor", 1, ([v]) => Math.floor(expectNumber(v as Value, "floor", "first"))),
    ceil: native("ceil", 1, ([v]) => Math.ceil(expectNumber(v as Value, "ceil", "first"))),
    round: native("round", 1, ([v]) => Math.round(expectNumber(v as Value, "round", "first"))),
    sqrt: native("sqrt", 1, ([v]) => Math.sqrt(expectNumber(v as Value, "sqrt", "first"))),
  };

  return prelude;
}

/** the modules `from <name> import ...` can resolve. */
export function createModules(): Record<string, Record<string, Value>> {
  const math: Record<string, Value> = {
    sin: native("sin", 1, ([v]) => Math.sin(expectNumber(v as Value, "sin", "first"))),
    cos: native("cos", 1, ([v]) => Math.cos(expectNumber(v as Value, "cos", "first"))),
    tan: native("tan", 1, ([v]) => Math.tan(expectNumber(v as Value, "tan", "first"))),
    log: native("log", 1, ([v]) => Math.log(expectNumber(v as Value, "log", "first"))),
    pow: native("pow", 2, ([a, b]) =>
      Math.pow(
        expectNumber(a as Value, "pow", "first"),
        expectNumber(b as Value, "pow", "second"),
      ),
    ),
    pi: Math.PI,
    e: Math.E,
    // these also live in the prelude; math re-exports them so `from math
    // import sqrt` resolves the way a reader expects
    abs: native("abs", 1, ([v]) => Math.abs(expectNumber(v as Value, "abs", "first"))),
    floor: native("floor", 1, ([v]) => Math.floor(expectNumber(v as Value, "floor", "first"))),
    ceil: native("ceil", 1, ([v]) => Math.ceil(expectNumber(v as Value, "ceil", "first"))),
    round: native("round", 1, ([v]) => Math.round(expectNumber(v as Value, "round", "first"))),
    sqrt: native("sqrt", 1, ([v]) => Math.sqrt(expectNumber(v as Value, "sqrt", "first"))),
  };

  return { math };
}

/** seeds an environment with every prelude name. */
export function installPrelude(
  environment: Environment,
  prelude: Record<string, Value>,
): void {
  for (const [name, value] of Object.entries(prelude)) {
    environment.define(name, value);
  }
}
