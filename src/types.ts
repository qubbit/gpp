// the type checker's view of types.
//
// these are distinct from the TypeNode syntax in ast.ts: a TypeNode is what the
// parser read out of an annotation, a Type is what the checker reasons about.
// resolving one into the other is what resolveType in checker.ts does.

export type Type =
  | AnyType
  | NeverType
  | TypeParam
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

/**
 * a generic's parameter, standing for a type not yet known. it is resolved by
 * substitution at each use site; one that survives into a check behaves like
 * `any`, so an uninstantiated generic never produces spurious errors.
 */
export interface TypeParam {
  kind: "param";
  name: string;
}

export interface PrimitiveType {
  kind: "primitive";
  name: "number" | "string" | "bool" | "nil" | "void";
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
  // the variant this value was built by, when it came from a type declaration.
  // two variants of the same type are distinct even with identical fields.
  variant?: string;
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
export const NIL: PrimitiveType = { kind: "primitive", name: "nil" };
export const VOID: PrimitiveType = { kind: "primitive", name: "void" };

export function paramOf(name: string): TypeParam {
  return { kind: "param", name };
}

/** replaces every type parameter in `type` using `bindings`. */
export function substitute(type: Type, bindings: Map<string, Type>): Type {
  if (bindings.size === 0) return type;

  switch (type.kind) {
    case "param":
      return bindings.get(type.name) ?? type;
    case "array":
      return arrayOf(substitute(type.element, bindings));
    case "function":
      return functionOf(
        type.params.map((param) => substitute(param, bindings)),
        substitute(type.returns, bindings),
      );
    case "union":
      return unionOf(type.options.map((o) => substitute(o, bindings)));
    case "object": {
      const fields = new Map<string, FieldInfo>();
      for (const [name, field] of type.fields) {
        fields.set(name, {
          type: substitute(field.type, bindings),
          optional: field.optional,
        });
      }
      const options: { name?: string; exact?: boolean; variant?: string } = {};
      if (type.name !== undefined) options.name = type.name;
      if (type.exact !== undefined) options.exact = type.exact;
      if (type.variant !== undefined) options.variant = type.variant;
      return objectOf(fields, options);
    }
    default:
      return type;
  }
}

/**
 * matches an argument's type against a parameter's, recording what each type
 * parameter must be. this is the inference that lets `id(1)` work without
 * writing `id<number>(1)`.
 */
export function inferParams(
  parameter: Type,
  argument: Type,
  bindings: Map<string, Type>,
): void {
  switch (parameter.kind) {
    case "param": {
      // an `any` argument says nothing about the parameter. letting it widen
      // would erase a binding a real argument already pinned down, which is
      // what an unannotated lambda would otherwise do to filter's element.
      if (isAny(argument)) return;

      const existing = bindings.get(parameter.name);
      // a parameter appearing twice widens to cover both uses
      bindings.set(
        parameter.name,
        existing ? unionOf([existing, argument]) : argument,
      );
      return;
    }
    case "array":
      if (argument.kind === "array") {
        inferParams(parameter.element, argument.element, bindings);
      }
      return;
    case "function":
      if (argument.kind === "function") {
        parameter.params.forEach((p, i) => {
          const a = argument.params[i];
          if (a) inferParams(p, a, bindings);
        });
        inferParams(parameter.returns, argument.returns, bindings);
      }
      return;
    case "object":
      if (argument.kind === "object") {
        for (const [name, field] of parameter.fields) {
          const match = argument.fields.get(name);
          if (match) inferParams(field.type, match.type, bindings);
        }
      }
      return;
    default:
      return;
  }
}

/** merges objects into one shape, which is what `A & B` denotes. */
export function intersectionOf(operands: Type[]): Type {
  if (operands.some(isAny)) return ANY;

  const objects = operands.filter(
    (operand): operand is ObjectTypeInfo => operand.kind === "object",
  );
  // only object intersections are meaningful; anything else has no values
  if (objects.length !== operands.length) return NEVER;

  const fields = new Map<string, FieldInfo>();
  for (const operand of objects) {
    for (const [name, field] of operand.fields) fields.set(name, field);
  }
  return objectOf(fields);
}

export function arrayOf(element: Type): ArrayTypeInfo {
  return { kind: "array", element };
}

export function functionOf(params: Type[], returns: Type): FunctionTypeInfo {
  return { kind: "function", params, returns };
}

export function objectOf(
  fields: Map<string, FieldInfo>,
  options: { name?: string; exact?: boolean; variant?: string } = {},
): ObjectTypeInfo {
  const type: ObjectTypeInfo = { kind: "object", fields };
  if (options.name !== undefined) type.name = options.name;
  if (options.exact !== undefined) type.exact = options.exact;
  if (options.variant !== undefined) type.variant = options.variant;
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

    case "param":
      return a.name === (b as TypeParam).name;

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
      if (a.variant !== other.variant) return false;
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
  // an uninstantiated parameter behaves like any, so a generic body checks
  // without knowing what it will be called with
  if (source.kind === "param" || target.kind === "param") return true;
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
  // a tagged variant is nominal among variants: Ok never satisfies Err, even
  // when their fields happen to line up
  if (target.variant !== undefined && source.variant !== target.variant) {
    return false;
  }
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

// --- narrowing ------------------------------------------------------------

/**
 * removes `unwanted` from `type`, which is what an `x != nil` test proves about
 * the true branch. a non union is left alone unless it is exactly the excluded
 * type, and `any` stays `any`: narrowing must never make gradual code stricter
 * than the author asked for.
 */
export function exclude(type: Type, unwanted: Type): Type {
  if (isAny(type)) return type;

  if (type.kind === "union") {
    const kept = type.options.filter((option) => !typesEqual(option, unwanted));
    // every option removed means the branch is unreachable
    return kept.length === type.options.length ? type : unionOf(kept);
  }

  return typesEqual(type, unwanted) ? NEVER : type;
}

/**
 * keeps only the members of `type` that the `type_of()` builtin would report as
 * `name`, which is what a `type_of(x) == "number"` test proves.
 */
export function narrowToTypeName(type: Type, name: string): Type {
  // an `any` value could be anything, so a positive test does tell us its type
  if (isAny(type)) return fromTypeName(name) ?? type;

  const matches = (option: Type) => runtimeTypeName(option) === name;

  if (type.kind === "union") {
    const kept = type.options.filter(matches);
    return kept.length ? unionOf(kept) : NEVER;
  }

  return matches(type) ? type : NEVER;
}

/** the string `type_of()` reports for a value of this type, where one is known. */
function runtimeTypeName(type: Type): string | null {
  switch (type.kind) {
    case "primitive":
      // the checker calls it void; no runtime value has that type
      return type.name === "void" ? null : type.name;
    case "array":
      return "array";
    case "object":
      return "object";
    case "function":
      return "function";
    default:
      return null;
  }
}

/** the type a `type_of()` string denotes, for narrowing an `any`. */
function fromTypeName(name: string): Type | null {
  switch (name) {
    case "number":
      return NUMBER;
    case "string":
      return STRING;
    case "bool":
      return BOOL;
    case "nil":
      return NIL;
    default:
      // array, object and function have no element or shape here, so an `any`
      // stays `any` rather than being narrowed to something wrong
      return null;
  }
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
    case "param":
      return type.name;
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
      if (type.variant) return type.variant;
      if (type.name) return type.name;
      const fields = [...type.fields.entries()].map(
        ([name, field]) =>
          `${name}${field.optional ? "?" : ""}: ${displayType(field.type)}`,
      );
      return `{${fields.join(", ")}}`;
    }
  }
}
