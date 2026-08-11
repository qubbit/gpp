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
 * the order `sort` uses when given no comparator: numbers numerically, strings
 * lexicographically, booleans false-first. values of different types are
 * grouped by type name so a mixed array still sorts deterministically rather
 * than arbitrarily.
 */
function defaultCompare(a: Value, b: Value): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }

  const left = typeName(a);
  const right = typeName(b);
  if (left !== right) return left < right ? -1 : 1;
  // same type, not comparable: leave the order alone
  return 0;
}

/**
 * builds the prelude. `out` receives what the program prints and `apply`
 * lets the higher order builtins call back into gpp functions.
 */
/** where a program's output goes. `write` does not end the line; `writeLine` does. */
export interface Output {
  write(text: string): void;
  writeLine(text: string): void;
}

export function createPrelude(
  out: Output,
  apply: Applier,
): Record<string, Value> {
  const prelude: Record<string, Value> = {
    // --- output ---
    // println ends the line; print leaves it open so successive calls build
    // one line, which is what makes progress output and tables possible
    println: native("println", null, (args) => {
      out.writeLine(args.map((arg) => stringify(arg)).join(" "));
      return null;
    }),

    print: native("print", null, (args) => {
      out.write(args.map((arg) => stringify(arg)).join(" "));
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
    replace: native("replace", 3, ([value, from, to]) =>
      // every occurrence, which is what a reader expects without a flag
      expectString(value as Value, "replace", "first").replaceAll(
        expectString(from as Value, "replace", "second"),
        expectString(to as Value, "replace", "third"),
      ),
    ),

    substring: native("substring", 3, ([value, from, to]) => {
      const text = expectString(value as Value, "substring", "first");
      const start = expectNumber(from as Value, "substring", "second");
      const end = expectNumber(to as Value, "substring", "third");
      // negative indices count from the end, matching array indexing
      const at = (index: number) => (index < 0 ? text.length + index : index);
      return text.slice(at(start), at(end));
    }),

    starts_with: native("starts_with", 2, ([value, prefix]) =>
      expectString(value as Value, "starts_with", "first").startsWith(
        expectString(prefix as Value, "starts_with", "second"),
      ),
    ),

    ends_with: native("ends_with", 2, ([value, suffix]) =>
      expectString(value as Value, "ends_with", "first").endsWith(
        expectString(suffix as Value, "ends_with", "second"),
      ),
    ),

    repeat: native("repeat", 2, ([value, count]) => {
      const times = expectNumber(count as Value, "repeat", "second");
      if (times < 0) throw new RuntimeError("repeat expects a count of zero or more");
      return expectString(value as Value, "repeat", "first").repeat(times);
    }),

    pad_start: native("pad_start", 3, ([value, width, fill]) =>
      expectString(value as Value, "pad_start", "first").padStart(
        expectNumber(width as Value, "pad_start", "second"),
        expectString(fill as Value, "pad_start", "third"),
      ),
    ),

    pad_end: native("pad_end", 3, ([value, width, fill]) =>
      expectString(value as Value, "pad_end", "first").padEnd(
        expectNumber(width as Value, "pad_end", "second"),
        expectString(fill as Value, "pad_end", "third"),
      ),
    ),

    chars: native("chars", 1, ([value]) => [
      ...expectString(value as Value, "chars", "first"),
    ]),

    ord: native("ord", 1, ([value]) => {
      const text = expectString(value as Value, "ord", "first");
      if (text.length === 0) throw new RuntimeError("ord expects a non empty string");
      return text.codePointAt(0)!;
    }),

    chr: native("chr", 1, ([code]) => {
      const point = expectNumber(code as Value, "chr", "first");
      // fromCodePoint throws a host RangeError outside this range, which would
      // escape the interpreter instead of surfacing as a gpp error
      if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) {
        throw new RuntimeError(
          `chr expects a code point between 0 and 1114111, received ${point}`,
        );
      }
      return String.fromCodePoint(point);
    }),

    str: native("str", 1, ([value]) => stringify(value as Value)),
    num: native("num", 1, ([value]) => {
      const parsed = Number(expectString(value as Value, "num", "first"));
      if (Number.isNaN(parsed)) throw new RuntimeError("num received a non numeric string");
      return parsed;
    }),

    // --- sorting ---
    // sort(xs) uses the default order; sort(xs, fn) uses a comparator that
    // returns a negative number, zero, or a positive number
    sort: native("sort", null, (args) => {
      if (args.length === 0 || args.length > 2) {
        throw new RuntimeError("sort expects an array and an optional comparator");
      }
      const items = [...expectArray(args[0] as Value, "sort", "first")];
      const comparator = args[1];

      if (comparator === undefined) return items.sort(defaultCompare);

      if (!isCallable(comparator)) {
        throw new RuntimeError("sort expects a function as its second argument");
      }
      return items.sort((a, b) => {
        const result = apply(comparator, [a, b]);
        if (typeof result !== "number") {
          throw new RuntimeError(
            "a sort comparator must return a number, negative to order a before b",
          );
        }
        return result;
      });
    }),

    // sort by a derived key, which reads better than a comparator for the
    // common case of ordering records by one field
    sort_by: native("sort_by", 2, ([array, key]) => {
      const items = [...expectArray(array as Value, "sort_by", "first")];
      if (!isCallable(key as Value)) {
        throw new RuntimeError("sort_by expects a function as its second argument");
      }
      return items.sort((a, b) =>
        defaultCompare(apply(key as Value, [a]), apply(key as Value, [b])),
      );
    }),

    // --- searching and aggregating ---
    index_of: native("index_of", 2, ([haystack, needle]) => {
      if (typeof haystack === "string") {
        return haystack.indexOf(expectString(needle as Value, "index_of", "second"));
      }
      const items = expectArray(haystack as Value, "index_of", "first");
      // -1 rather than nil, so the result is always a number
      return items.findIndex((item) => valuesEqual(item, needle as Value));
    }),

    find: native("find", 2, ([array, fn]) => {
      const items = expectArray(array as Value, "find", "first");
      if (!isCallable(fn as Value)) {
        throw new RuntimeError("find expects a function as its second argument");
      }
      // nil when nothing matches
      return items.find((item) => apply(fn as Value, [item]) !== false) ?? null;
    }),

    any: native("any", 2, ([array, fn]) => {
      const items = expectArray(array as Value, "any", "first");
      if (!isCallable(fn as Value)) {
        throw new RuntimeError("any expects a function as its second argument");
      }
      return items.some((item) => apply(fn as Value, [item]) !== false);
    }),

    all: native("all", 2, ([array, fn]) => {
      const items = expectArray(array as Value, "all", "first");
      if (!isCallable(fn as Value)) {
        throw new RuntimeError("all expects a function as its second argument");
      }
      return items.every((item) => apply(fn as Value, [item]) !== false);
    }),

    sum: native("sum", 1, ([array]) =>
      expectArray(array as Value, "sum", "first").reduce<number>(
        (total, item) => total + expectNumber(item, "sum", "each element"),
        0,
      ),
    ),

    unique: native("unique", 1, ([array]) => {
      const items = expectArray(array as Value, "unique", "first");
      const seen: Value[] = [];
      for (const item of items) {
        if (!seen.some((existing) => valuesEqual(existing, item))) seen.push(item);
      }
      return seen;
    }),

    flatten: native("flatten", 1, ([array]) => {
      // one level only, which is what "flatten" means without a depth argument
      const items = expectArray(array as Value, "flatten", "first");
      const out: Value[] = [];
      for (const item of items) {
        if (Array.isArray(item)) out.push(...item);
        else out.push(item);
      }
      return out;
    }),

    zip: native("zip", 2, ([a, b]) => {
      const left = expectArray(a as Value, "zip", "first");
      const right = expectArray(b as Value, "zip", "second");
      // stops at the shorter of the two
      const out: Value[] = [];
      for (let i = 0; i < Math.min(left.length, right.length); i++) {
        out.push([left[i]!, right[i]!]);
      }
      return out;
    }),

    // --- objects ---
    remove: native("remove", 2, ([object, key]) => {
      if (!isObject(object as Value)) {
        throw new RuntimeError("remove expects an object as its first argument");
      }
      const name = expectString(key as Value, "remove", "second");
      // returns a new object, matching push rather than mutating in place
      const out: ObjectValue = {};
      for (const [existing, value] of Object.entries(object as ObjectValue)) {
        if (existing !== name) out[existing] = value;
      }
      return out;
    }),

    has: native("has", 2, ([object, key]) => {
      if (!isObject(object as Value)) {
        throw new RuntimeError("has expects an object as its first argument");
      }
      return expectString(key as Value, "has", "second") in (object as ObjectValue);
    }),

    merge: native("merge", 2, ([a, b]) => {
      if (!isObject(a as Value) || !isObject(b as Value)) {
        throw new RuntimeError("merge expects two objects");
      }
      // the second wins on a clash
      return { ...(a as ObjectValue), ...(b as ObjectValue) };
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
