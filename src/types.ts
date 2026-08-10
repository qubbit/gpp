// the type checker's view of types.
//
// these are distinct from the TypeNode syntax in ast.ts: a TypeNode is what the
// parser read out of an annotation, a Type is what the checker reasons about.
// resolving one into the other is what resolveType in checker.ts does.

export type Type =
  | AnyType
  | NeverType
  | PrimitiveType
  | ArrayTypeInfo
  | ObjectTypeInfo
  | FunctionTypeInfo
  | UnionTypeInfo;

// the gradual escape hatch: assignable in both directions, so unannotated code
// never fails a check.
export interface AnyType {
  kind: "any";
}

// no value has this type. produced by an empty union and by a branch that
// cannot be reached; assignable to everything, nothing is assignable to it.
export interface NeverType {
  kind: "never";
}

export interface PrimitiveType {
  kind: "primitive";
  name: "number" | "string" | "bool" | "null" | "void";
}

export interface ArrayTypeInfo {
  kind: "array";
  element: Type;
}

export interface ObjectTypeInfo {
  kind: "object";
  fields: Map<string, FieldInfo>;
  // the interface this shape came from, kept only so errors can name it
  name?: string;
  // true for a plain object literal, whose field set is exactly known. an
  // interface may be satisfied by a value carrying extra fields.
  exact?: boolean;
}

export interface FieldInfo {
  type: Type;
  optional: boolean;
}

export interface FunctionTypeInfo {
  kind: "function";
  params: Type[];
  returns: Type;
}

export interface UnionTypeInfo {
  kind: "union";
  options: Type[];
}

// --- constructors -------------------------------------------------------

export const ANY: AnyType = { kind: "any" };
export const NEVER: NeverType = { kind: "never" };
export const NUMBER: PrimitiveType = { kind: "primitive", name: "number" };
export const STRING: PrimitiveType = { kind: "primitive", name: "string" };
export const BOOL: PrimitiveType = { kind: "primitive", name: "bool" };
export const NULL: PrimitiveType = { kind: "primitive", name: "null" };
export const VOID: PrimitiveType = { kind: "primitive", name: "void" };

export function arrayOf(element: Type): ArrayTypeInfo {
  return { kind: "array", element };
}

export function functionOf(params: Type[], returns: Type): FunctionTypeInfo {
  return { kind: "function", params, returns };
}

export function objectOf(
  fields: Map<string, FieldInfo>,
  options: { name?: string; exact?: boolean } = {},
): ObjectTypeInfo {
  const type: ObjectTypeInfo = { kind: "object", fields };
  if (options.name !== undefined) type.name = options.name;
  if (options.exact !== undefined) type.exact = options.exact;
  return type;
}

/**
 * builds a union, flattening nested unions and dropping duplicates. a single
 * remaining option collapses to that option, and `any` absorbs everything.
 */
export function unionOf(options: Type[]): Type {
  const flat: Type[] = [];

  const add = (type: Type) => {
    if (type.kind === "union") {
      type.options.forEach(add);
      return;
    }
    // never contributes nothing to a union
    if (type.kind === "never") return;
    if (!flat.some((existing) => typesEqual(existing, type))) flat.push(type);
  };

  options.forEach(add);

  if (flat.some((type) => type.kind === "any")) return ANY;
  if (flat.length === 0) return NEVER;
  if (flat.length === 1) return flat[0]!;
  return { kind: "union", options: flat };
}

// --- relations ----------------------------------------------------------

export function isAny(type: Type): boolean {
  return type.kind === "any";
}

/** structural identity, used for deduplicating unions and comparing fields. */
export function typesEqual(a: Type, b: Type): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case "any":
    case "never":
      return true;

    case "primitive":
      return a.name === (b as PrimitiveType).name;

    case "array":
      return typesEqual(a.element, (b as ArrayTypeInfo).element);

    case "function": {
      const other = b as FunctionTypeInfo;
      return (
        a.params.length === other.params.length &&
        a.params.every((param, i) => typesEqual(param, other.params[i]!)) &&
        typesEqual(a.returns, other.returns)
      );
    }

    case "object": {
      const other = b as ObjectTypeInfo;
      if (a.fields.size !== other.fields.size) return false;
      for (const [name, field] of a.fields) {
        const match = other.fields.get(name);
        if (!match) return false;
        if (field.optional !== match.optional) return false;
        if (!typesEqual(field.type, match.type)) return false;
      }
      return true;
    }

    case "union": {
      const other = b as UnionTypeInfo;
      return (
        a.options.length === other.options.length &&
        a.options.every((option) =>
          other.options.some((candidate) => typesEqual(option, candidate)),
        )
      );
    }
  }
}

/**
 * whether a value of type `source` can be used where `target` is expected.
 *
 * `any` is assignable in both directions, which is what makes the checker
 * gradual: unannotated code is typed `any` and never fails.
 */
export function isAssignable(source: Type, target: Type): boolean {
  if (isAny(source) || isAny(target)) return true;
  if (source.kind === "never") return true;
  if (typesEqual(source, target)) return true;

  // every option of a source union has to fit
  if (source.kind === "union") {
    return source.options.every((option) => isAssignable(option, target));
  }

  // a source fits a target union if it fits any option
  if (target.kind === "union") {
    return target.options.some((option) => isAssignable(source, option));
  }

  if (source.kind === "array" && target.kind === "array") {
    return isAssignable(source.element, target.element);
  }

  if (source.kind === "object" && target.kind === "object") {
    return isObjectAssignable(source, target);
  }

  if (source.kind === "function" && target.kind === "function") {
    // arity must match; gpp has no optional parameters
    if (source.params.length !== target.params.length) return false;
    // parameters are contravariant, the return type covariant
    return (
      target.params.every((param, i) => isAssignable(param, source.params[i]!)) &&
      isAssignable(source.returns, target.returns)
    );
  }

  return false;
}

/**
 * structural subtyping for objects: the source must carry every required field
 * of the target, at an assignable type. extra fields are allowed, so a richer
 * record can be passed where a narrower interface is expected.
 */
function isObjectAssignable(
  source: ObjectTypeInfo,
  target: ObjectTypeInfo,
): boolean {
  for (const [name, field] of target.fields) {
    const match = source.fields.get(name);

    if (!match) {
      // an absent field is fine only when the target marks it optional
      if (field.optional) continue;
      return false;
    }

    if (!isAssignable(match.type, field.type)) return false;
  }

  return true;
}

/** the fields a source object has that the target does not declare. */
export function extraFields(
  source: ObjectTypeInfo,
  target: ObjectTypeInfo,
): string[] {
  return [...source.fields.keys()].filter((name) => !target.fields.has(name));
}

/** the required fields of `target` that `source` is missing. */
export function missingFields(
  source: ObjectTypeInfo,
  target: ObjectTypeInfo,
): string[] {
  const missing: string[] = [];
  for (const [name, field] of target.fields) {
    if (field.optional) continue;
    if (!source.fields.has(name)) missing.push(name);
  }
  return missing;
}

// --- display ------------------------------------------------------------

/** renders a type the way a user would write it in an annotation. */
export function displayType(type: Type): string {
  switch (type.kind) {
    case "any":
      return "any";
    case "never":
      return "never";
    case "primitive":
      return type.name;
    case "array": {
      // a union element needs parentheses to read correctly
      const element = displayType(type.element);
      return type.element.kind === "union" ? `(${element})[]` : `${element}[]`;
    }
    case "function":
      return `fn(${type.params.map(displayType).join(", ")}): ${displayType(
        type.returns,
      )}`;
    case "union":
      return type.options.map(displayType).join(" | ");
    case "object": {
      if (type.name) return type.name;
      const fields = [...type.fields.entries()].map(
        ([name, field]) =>
          `${name}${field.optional ? "?" : ""}: ${displayType(field.type)}`,
      );
      return `{${fields.join(", ")}}`;
    }
  }
}
