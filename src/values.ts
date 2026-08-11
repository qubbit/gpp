// runtime values and scope handling for the tree-walk interpreter.

import type { BlockStatement, Parameter } from "./ast.js";

// the field a variant carries its name in; kept here so stringify and typeName
// can recognise one without importing the evaluator
export const VARIANT_TAG = "variant tag";

export type Value =
  | number
  | string
  | boolean
  | null
  | Value[]
  | ObjectValue
  | FunctionValue
  | NativeFunction;

// plain records, used for object literals and interface-shaped data
export type ObjectValue = { [key: string]: Value };

export interface FunctionValue {
  kind: "function";
  name: string | null;
  params: Parameter[];
  body: BlockStatement;
  // the scope the function was defined in, which is what makes closures work
  closure: Environment;
}

export interface NativeFunction {
  kind: "native";
  name: string;
  arity: number | null; // null accepts any number of arguments
  call(args: Value[]): Value;
}

export function isCallable(value: Value): value is FunctionValue | NativeFunction {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    ((value as any).kind === "function" || (value as any).kind === "native")
  );
}

export function isObject(value: Value): value is ObjectValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as any).kind !== "function" &&
    (value as any).kind !== "native"
  );
}

/** the name gpp's `type` builtin reports for a value. */
export function typeName(value: Value): string {
  // the language calls it nil; the host representation is javascript null
  if (value === null) return "nil";
  if (isObject(value)) {
    const tag = value[VARIANT_TAG];
    // a variant reports its own name, which is more useful than "object"
    if (typeof tag === "string") return tag;
  }
  if (Array.isArray(value)) return "array";
  if (isCallable(value)) return "function";
  switch (typeof value) {
    case "number":
      return "number";
    case "string":
      return "string";
    case "boolean":
      return "bool";
    default:
      return "object";
  }
}

/**
 * renders a value the way the playground prints it. arrays and objects are
 * shown structurally so `print` on a collection is useful.
 */
export function stringify(value: Value, seen = new Set<object>()): string {
  if (value === null) return "nil";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (isCallable(value)) {
    return `<fn ${value.name ?? "anonymous"}>`;
  }

  // guard against a value that contains itself
  if (seen.has(value as object)) return "<circular>";
  seen.add(value as object);

  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => quoted(item, seen)).join(", ")}]`;
    }
    // a variant prints as its constructor call, not as the object underneath
    const tag = (value as ObjectValue)[VARIANT_TAG];
    if (typeof tag === "string") {
      const fields = Object.entries(value)
        .filter(([key]) => key !== VARIANT_TAG)
        .map(([, item]) => quoted(item, seen));
      return fields.length ? `${tag}(${fields.join(", ")})` : `${tag}()`;
    }

    const entries = Object.entries(value).map(
      ([key, item]) => `${key}: ${quoted(item, seen)}`,
    );
    return `{${entries.join(", ")}}`;
  } finally {
    seen.delete(value as object);
  }
}

// strings nest with quotes so `["a"]` is distinguishable from `[a]`
function quoted(value: Value, seen: Set<object>): string {
  return typeof value === "string"
    ? JSON.stringify(value)
    : stringify(value, seen);
}

/** only false and null are falsy; 0 and "" are truthy. */
export function isTruthy(value: Value): boolean {
  return value !== false && value !== null;
}

/** structural equality, so arrays and objects compare by content. */
export function valuesEqual(a: Value, b: Value): boolean {
  if (a === b) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => valuesEqual(item, b[i]!));
  }

  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => key in b && valuesEqual(a[key]!, b[key]!))
    );
  }

  return false;
}

/** a lexical scope; `parent` is null only for the global environment. */
export class Environment {
  private values = new Map<string, Value>();

  constructor(private parent: Environment | null = null) {}

  define(name: string, value: Value): void {
    this.values.set(name, value);
  }

  has(name: string): boolean {
    if (this.values.has(name)) return true;
    return this.parent?.has(name) ?? false;
  }

  get(name: string): Value | undefined {
    if (this.values.has(name)) return this.values.get(name);
    return this.parent?.get(name);
  }

  /** assigns to an existing binding, reporting whether one was found. */
  assign(name: string, value: Value): boolean {
    if (this.values.has(name)) {
      this.values.set(name, value);
      return true;
    }
    if (this.parent) return this.parent.assign(name, value);
    return false;
  }
}
