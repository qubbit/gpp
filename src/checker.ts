// static type checker for gpp.
//
// gradual by design: an unannotated binding takes the type of its initialiser,
// an unannotated parameter is `any`, and `any` is assignable both ways. adding
// an annotation only ever buys more checking, it never turns working code into
// a wall of errors.
//
// interfaces are structural. an object satisfies one when it carries every
// required field at an assignable type; extra fields are allowed.

import type {
  BlockStatement,
  Expression,
  MatchArm,
  Parameter,
  Pattern,
  Program,
  Statement,
  TypeNode,
} from "./ast.js";
import {
  ANY,
  BOOL,
  NEVER,
  NIL,
  NUMBER,
  STRING,
  VOID,
  arrayOf,
  displayType,
  functionOf,
  isAny,
  isAssignable,
  exclude,
  missingFields,
  narrowToTypeName,
  objectOf,
  typesEqual,
  unionOf,
  type FieldInfo,
  type FunctionTypeInfo,
  type ObjectTypeInfo,
  type Type,
} from "./types.js";

/**
 * whether a block always leaves, so the statements after it are only reached
 * when the branch was not taken. only the direct forms count: a return, break
 * or continue at the top level of the block, or an if whose branches all leave.
 */
function alwaysLeaves(block: BlockStatement): boolean {
  return block.body.some((statement) => {
    if (
      statement.kind === "return_statement" ||
      statement.kind === "break_statement" ||
      statement.kind === "continue_statement"
    ) {
      // a guarded return may not fire, so it does not count
      return statement.kind !== "return_statement" || !statement.guard;
    }
    if (statement.kind === "if_statement" && statement.alternate) {
      const alternate =
        statement.alternate.kind === "block_statement"
          ? alwaysLeaves(statement.alternate)
          : alwaysLeaves({
              kind: "block_statement",
              body: [statement.alternate],
              line: statement.line,
              column: statement.column,
            });
      return alwaysLeaves(statement.consequent) && alternate;
    }
    return false;
  });
}

/** renders a literal pattern's value the way a user would write it. */
function stringifyLiteral(value: number | string | boolean | null): string {
  if (value === null) return "nil";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export interface TypeError {
  message: string;
  line: number;
  column: number;
}

export interface CheckResult {
  errors: TypeError[];
}

// the prelude's signatures. `any` appears where a builtin is genuinely
// polymorphic and gpp has no generics to express it.
const PRELUDE_TYPES: Record<string, Type> = {
  // output
  println: functionOf([], VOID),
  print: functionOf([], VOID),

  // reflection
  type_of: functionOf([ANY], STRING),
  len: functionOf([ANY], NUMBER),

  // arrays
  push: functionOf([arrayOf(ANY), ANY], arrayOf(ANY)),
  pop: functionOf([arrayOf(ANY)], ANY),
  slice: functionOf([arrayOf(ANY), NUMBER, NUMBER], arrayOf(ANY)),
  concat: functionOf([arrayOf(ANY), arrayOf(ANY)], arrayOf(ANY)),
  reverse: functionOf([arrayOf(ANY)], arrayOf(ANY)),
  contains: functionOf([ANY, ANY], BOOL),
  range: functionOf([NUMBER, NUMBER], arrayOf(NUMBER)),

  // higher order
  map: functionOf([arrayOf(ANY), functionOf([ANY], ANY)], arrayOf(ANY)),
  filter: functionOf([arrayOf(ANY), functionOf([ANY], ANY)], arrayOf(ANY)),
  reduce: functionOf(
    [arrayOf(ANY), functionOf([ANY, ANY], ANY), ANY],
    ANY,
  ),

  // sorting. sort takes an optional comparator, so its arity is not checked
  sort: functionOf([arrayOf(ANY)], arrayOf(ANY)),
  sort_by: functionOf([arrayOf(ANY), functionOf([ANY], ANY)], arrayOf(ANY)),

  // searching and aggregating
  index_of: functionOf([ANY, ANY], NUMBER),
  find: functionOf([arrayOf(ANY), functionOf([ANY], ANY)], ANY),
  any: functionOf([arrayOf(ANY), functionOf([ANY], ANY)], BOOL),
  all: functionOf([arrayOf(ANY), functionOf([ANY], ANY)], BOOL),
  sum: functionOf([arrayOf(ANY)], NUMBER),
  unique: functionOf([arrayOf(ANY)], arrayOf(ANY)),
  flatten: functionOf([arrayOf(ANY)], arrayOf(ANY)),
  zip: functionOf([arrayOf(ANY), arrayOf(ANY)], arrayOf(ANY)),

  // objects
  keys: functionOf([ANY], arrayOf(STRING)),
  values: functionOf([ANY], arrayOf(ANY)),
  remove: functionOf([ANY, STRING], ANY),
  has: functionOf([ANY, STRING], BOOL),
  merge: functionOf([ANY, ANY], ANY),

  // strings
  upper: functionOf([STRING], STRING),
  lower: functionOf([STRING], STRING),
  trim: functionOf([STRING], STRING),
  split: functionOf([STRING, STRING], arrayOf(STRING)),
  join: functionOf([arrayOf(ANY), STRING], STRING),
  replace: functionOf([STRING, STRING, STRING], STRING),
  substring: functionOf([STRING, NUMBER, NUMBER], STRING),
  starts_with: functionOf([STRING, STRING], BOOL),
  ends_with: functionOf([STRING, STRING], BOOL),
  repeat: functionOf([STRING, NUMBER], STRING),
  pad_start: functionOf([STRING, NUMBER, STRING], STRING),
  pad_end: functionOf([STRING, NUMBER, STRING], STRING),
  chars: functionOf([STRING], arrayOf(STRING)),
  ord: functionOf([STRING], NUMBER),
  chr: functionOf([NUMBER], STRING),
  str: functionOf([ANY], STRING),
  num: functionOf([STRING], NUMBER),

  // math
  abs: functionOf([NUMBER], NUMBER),
  min: functionOf([], NUMBER),
  max: functionOf([], NUMBER),
  floor: functionOf([NUMBER], NUMBER),
  ceil: functionOf([NUMBER], NUMBER),
  round: functionOf([NUMBER], NUMBER),
  sqrt: functionOf([NUMBER], NUMBER),
};

// builtins that take any number of arguments, so arity is not checked
const VARIADIC = new Set(["print", "println", "min", "max", "sort"]);

// the collections are written in gpp and return closures over private state.
// without generics their contents cannot be described, so a constructor is
// typed as returning any: enough to check the import, not the method calls.
const COLLECTION_CONSTRUCTORS: Record<string, Type> = {
  stack: functionOf([], ANY),
  queue: functionOf([], ANY),
  priority_queue: functionOf([], ANY),
  linked_list: functionOf([], ANY),
  set: functionOf([arrayOf(ANY)], ANY),
  map: functionOf([arrayOf(ANY)], ANY),
};

const MODULE_TYPES: Record<string, Record<string, Type>> = {
  collections: COLLECTION_CONSTRUCTORS,
  math: {
    sin: functionOf([NUMBER], NUMBER),
    cos: functionOf([NUMBER], NUMBER),
    tan: functionOf([NUMBER], NUMBER),
    log: functionOf([NUMBER], NUMBER),
    pow: functionOf([NUMBER, NUMBER], NUMBER),
    pi: NUMBER,
    e: NUMBER,
    abs: functionOf([NUMBER], NUMBER),
    floor: functionOf([NUMBER], NUMBER),
    ceil: functionOf([NUMBER], NUMBER),
    round: functionOf([NUMBER], NUMBER),
    sqrt: functionOf([NUMBER], NUMBER),
  },
};

/** a lexical scope of variable types. */
class Scope {
  private types = new Map<string, Type>();

  constructor(private parent: Scope | null = null) {}

  define(name: string, type: Type): void {
    this.types.set(name, type);
  }

  lookup(name: string): Type | undefined {
    return this.types.get(name) ?? this.parent?.lookup(name);
  }

  has(name: string): boolean {
    return this.types.has(name) || (this.parent?.has(name) ?? false);
  }
}

export class Checker {
  private errors: TypeError[] = [];
  private interfaces = new Map<string, ObjectTypeInfo>();
  // tagged unions by name, and every variant by its own name
  private types = new Map<string, Type>();
  private variants = new Map<string, ObjectTypeInfo>();
  // the return type of the function being checked, null at the top level
  private expectedReturn: Type | null = null;
  private loopDepth = 0;

  check(program: Program): CheckResult {
    this.errors = [];
    this.interfaces.clear();
    this.types.clear();
    this.variants.clear();
    this.expectedReturn = null;
    this.loopDepth = 0;

    const scope = new Scope();
    for (const [name, type] of Object.entries(PRELUDE_TYPES)) {
      scope.define(name, type);
    }

    // interfaces and types first, so a declaration may reference one declared
    // later, and so constructors exist before any code calls them
    for (const statement of program.body) {
      if (statement.kind === "interface_declaration") {
        this.declareInterface(statement);
      }
    }
    for (const statement of program.body) {
      if (statement.kind === "type_declaration") {
        this.declareType(statement, scope);
      }
    }

    // then function signatures, so functions can call each other in any order
    for (const statement of program.body) {
      if (statement.kind === "function_declaration") {
        scope.define(statement.name, this.signatureOf(statement));
      }
    }

    for (const statement of program.body) {
      this.checkStatement(statement, scope);
    }

    return { errors: this.errors };
  }

  // --- narrowing ------------------------------------------------------------

  /**
   * what a condition proves about the names it tests, as a pair of refinements:
   * one to apply when the condition holds and one when it does not.
   *
   * only the shapes people actually write are recognised. anything else yields
   * no refinement, which is always safe: narrowing may only ever make a type
   * more precise, never wrong.
   */
  private narrowingsFor(
    condition: Expression,
    scope: Scope,
  ): { whenTrue: Map<string, Type>; whenFalse: Map<string, Type> } {
    const whenTrue = new Map<string, Type>();
    const whenFalse = new Map<string, Type>();

    // `!c` swaps what each branch learns
    if (condition.kind === "unary_expression" && condition.operator === "!") {
      const inner = this.narrowingsFor(condition.operand, scope);
      return { whenTrue: inner.whenFalse, whenFalse: inner.whenTrue };
    }

    // `a && b` proves both in the true branch; the false branch could be
    // either, so it learns nothing
    if (condition.kind === "logical_expression" && condition.operator === "&&") {
      const left = this.narrowingsFor(condition.left, scope);
      const right = this.narrowingsFor(condition.right, scope);
      return {
        whenTrue: new Map([...left.whenTrue, ...right.whenTrue]),
        whenFalse: new Map(),
      };
    }

    // `a || b`: the false branch proves both failed
    if (condition.kind === "logical_expression" && condition.operator === "||") {
      const left = this.narrowingsFor(condition.left, scope);
      const right = this.narrowingsFor(condition.right, scope);
      return {
        whenTrue: new Map(),
        whenFalse: new Map([...left.whenFalse, ...right.whenFalse]),
      };
    }

    if (condition.kind === "binary_expression") {
      const { operator, left, right } = condition;
      if (operator !== "==" && operator !== "!=") {
        return { whenTrue, whenFalse };
      }

      // `x == nil` and `x != nil`, either way round
      const nilTest = this.asNilTest(left, right);
      if (nilTest) {
        const current = scope.lookup(nilTest);
        if (current) {
          const withoutNil = exclude(current, NIL);
          // `== nil` proves nil in the true branch, everything else in the false
          if (operator === "==") {
            whenTrue.set(nilTest, NIL);
            whenFalse.set(nilTest, withoutNil);
          } else {
            whenTrue.set(nilTest, withoutNil);
            whenFalse.set(nilTest, NIL);
          }
        }
        return { whenTrue, whenFalse };
      }

      // `type_of(x) == "number"` and its negation
      const typeTest = this.asTypeTest(left, right);
      if (typeTest) {
        const current = scope.lookup(typeTest.name);
        if (current) {
          const matching = narrowToTypeName(current, typeTest.expected);
          const rest = this.excludeTypeName(current, typeTest.expected);
          if (operator === "==") {
            whenTrue.set(typeTest.name, matching);
            whenFalse.set(typeTest.name, rest);
          } else {
            whenTrue.set(typeTest.name, rest);
            whenFalse.set(typeTest.name, matching);
          }
        }
      }
      return { whenTrue, whenFalse };
    }

    // a bare `if x` on a nilable value proves it is not nil
    if (condition.kind === "identifier") {
      const current = scope.lookup(condition.name);
      if (current) whenTrue.set(condition.name, exclude(current, NIL));
    }

    return { whenTrue, whenFalse };
  }

  /** the name in `x == nil` or `nil == x`, if the comparison is that shape. */
  private asNilTest(left: Expression, right: Expression): string | null {
    if (left.kind === "identifier" && right.kind === "nil_literal") {
      return left.name;
    }
    if (right.kind === "identifier" && left.kind === "nil_literal") {
      return right.name;
    }
    return null;
  }

  /** the name and expected type in `type_of(x) == "number"`, either way round. */
  private asTypeTest(
    left: Expression,
    right: Expression,
  ): { name: string; expected: string } | null {
    const read = (call: Expression, literal: Expression) => {
      if (
        call.kind === "call_expression" &&
        call.callee.kind === "identifier" &&
        call.callee.name === "type_of" &&
        call.args.length === 1 &&
        call.args[0]!.kind === "identifier" &&
        literal.kind === "string_literal"
      ) {
        return { name: call.args[0]!.name, expected: literal.value };
      }
      return null;
    };
    return read(left, right) ?? read(right, left);
  }

  /** the members of a type that `type_of()` would not report as `name`. */
  private excludeTypeName(type: Type, name: string): Type {
    if (isAny(type)) return type;
    const matching = narrowToTypeName(type, name);
    if (type.kind === "union") {
      return unionOf(
        type.options.filter((option) => !isAssignable(option, matching)),
      );
    }
    return typesEqual(type, matching) ? NEVER : type;
  }

  /** a child scope with the given names refined. */
  private scopeWith(parent: Scope, refinements: Map<string, Type>): Scope {
    const scope = new Scope(parent);
    for (const [name, type] of refinements) scope.define(name, type);
    return scope;
  }

  /**
   * an assignment failure, with a hint when the target wants a variant and the
   * value is a bare object. a variant carries its constructor's name, so a
   * literal of the right shape is still not one, and the plain "cannot assign"
   * message does not say how to fix that.
   */
  private reportAssignment(
    actual: Type,
    target: Type,
    node: { line: number; column: number },
  ): void {
    const base = `Cannot assign ${displayType(actual)} to ${displayType(target)}`;
    const hint = this.variantHint(actual, target);
    this.report(hint ? `${base}. ${hint}` : base, node);
  }

  /** how to build the variant the target wanted, when that is the mismatch. */
  private variantHint(actual: Type, target: Type): string | null {
    // only fires when a bare object was given where a variant was wanted
    if (actual.kind !== "object" || actual.variant !== undefined) return null;

    const wanted = (target.kind === "union" ? target.options : [target]).filter(
      (option) => option.kind === "object" && option.variant !== undefined,
    ) as ObjectTypeInfo[];

    if (wanted.length === 0) return null;

    const calls = wanted.map((option) => {
      const fields = [...option.fields.keys()].join(", ");
      return `${option.variant}(${fields})`;
    });

    return `A variant is built by its constructor, so write ${calls.join(" or ")} rather than an object literal.`;
  }

  private report(message: string, node: { line: number; column: number }): void {
    this.errors.push({ message, line: node.line, column: node.column });
  }

  private declareInterface(
    statement: Extract<Statement, { kind: "interface_declaration" }>,
  ): void {
    if (this.interfaces.has(statement.name)) {
      this.report(`Interface '${statement.name}' is already declared`, statement);
      return;
    }

    const fields = new Map<string, FieldInfo>();
    for (const field of statement.fields) {
      fields.set(field.name, {
        type: this.resolveType(field.type),
        optional: field.optional,
      });
    }

    this.interfaces.set(
      statement.name,
      objectOf(fields, { name: statement.name }),
    );
  }

  /**
   * registers a tagged union: the type itself as the union of its variants,
   * and one constructor function per variant taking its fields positionally.
   */
  private declareType(
    statement: Extract<Statement, { kind: "type_declaration" }>,
    scope: Scope,
  ): void {
    if (this.types.has(statement.name)) {
      this.report(`Type '${statement.name}' is already declared`, statement);
      return;
    }

    const seen = new Set<string>();
    const variantTypes: Type[] = [];

    for (const variant of statement.variants) {
      if (seen.has(variant.name)) {
        this.report(
          `Variant '${variant.name}' is declared twice in ${statement.name}`,
          variant,
        );
        continue;
      }
      seen.add(variant.name);

      const fields = new Map<string, FieldInfo>();
      for (const field of variant.fields) {
        fields.set(field.name, {
          type: this.resolveType(field.type),
          optional: field.optional,
        });
      }

      const type = objectOf(fields, { variant: variant.name });
      variantTypes.push(type);
      this.variants.set(variant.name, type);

      // the constructor takes the fields in declaration order
      scope.define(
        variant.name,
        functionOf(
          variant.fields.map((field) => this.resolveType(field.type)),
          type,
        ),
      );
    }

    this.types.set(statement.name, unionOf(variantTypes));
  }

  private signatureOf(fn: {
    params: Parameter[];
    returnType: TypeNode | null;
  }): FunctionTypeInfo {
    return functionOf(
      // an unannotated parameter is `any`, which keeps existing code checking
      fn.params.map((param) => (param.type ? this.resolveType(param.type) : ANY)),
      fn.returnType ? this.resolveType(fn.returnType) : ANY,
    );
  }

  // --- type resolution ------------------------------------------------------

  /** turns an annotation from the parser into a checker type. */
  private resolveType(node: TypeNode): Type {
    switch (node.kind) {
      case "named_type": {
        switch (node.name) {
          case "number":
            return NUMBER;
          case "string":
            return STRING;
          case "bool":
            return BOOL;
          case "any":
            return ANY;
          case "void":
            return VOID;
          case "nil":
            return NIL;
          case "never":
            return NEVER;
        }

        const declared = this.interfaces.get(node.name);
        if (declared) return declared;

        const union = this.types.get(node.name);
        if (union) return union;

        // a single variant is a type too, so `fn f(v: Ok)` narrows to one case
        const variant = this.variants.get(node.name);
        if (variant) return variant;

        this.report(`Unknown type '${node.name}'`, node);
        // recover as any so one bad annotation does not cascade
        return ANY;
      }

      case "array_type":
        return arrayOf(this.resolveType(node.element));

      case "object_type": {
        const fields = new Map<string, FieldInfo>();
        for (const field of node.fields) {
          fields.set(field.name, {
            type: this.resolveType(field.type),
            optional: field.optional,
          });
        }
        return objectOf(fields);
      }

      case "function_type":
        return functionOf(
          node.params.map((param) => this.resolveType(param)),
          this.resolveType(node.returns),
        );

      case "union_type":
        return unionOf(node.options.map((option) => this.resolveType(option)));
    }
  }

  // --- statements -----------------------------------------------------------

  private checkStatement(statement: Statement, scope: Scope): void {
    switch (statement.kind) {
      case "let_statement": {
        const annotated = statement.typeAnnotation
          ? this.resolveType(statement.typeAnnotation)
          : null;

        if (!statement.value) {
          // a declaration with no initialiser holds null until assigned
          this.bindPattern(
            statement.target,
            annotated ?? ANY,
            scope,
          );
          return;
        }

        const actual = this.checkExpression(statement.value, scope, annotated);

        if (annotated && !isAssignable(actual, annotated)) {
          this.reportAssignment(actual, annotated, statement.value);
        }

        // the annotation wins when present, so later use checks against what
        // the author declared rather than what they happened to pass
        this.bindPattern(statement.target, annotated ?? actual, scope);
        return;
      }

      case "expression_statement":
        this.checkExpression(statement.expression, scope, null);
        return;

      case "assignment_statement": {
        // assigning a property that does not exist yet grows the object rather
        // than being an error: gpp objects are open records, and `let o = {}`
        // followed by `o.count = 1` is ordinary code.
        if (
          statement.operator === "=" &&
          statement.target.kind === "member_expression"
        ) {
          const object = this.checkExpression(
            statement.target.object,
            scope,
            null,
          );

          if (!isAny(object) && object.kind === "object") {
            const property = statement.target.property;
            const value = this.checkExpression(
              statement.value,
              scope,
              object.fields.get(property)?.type ?? null,
            );
            const existing = object.fields.get(property);

            if (!existing) {
              object.fields.set(property, { type: value, optional: false });
              return;
            }

            if (!isAssignable(value, existing.type)) {
              this.report(
                `Cannot assign ${displayType(value)} to ${displayType(existing.type)}`,
                statement.value,
              );
            }
            return;
          }
        }

        // the same for `o["count"] = 1`, where the key is a literal
        if (
          statement.operator === "=" &&
          statement.target.kind === "index_expression" &&
          statement.target.index.kind === "string_literal"
        ) {
          const object = this.checkExpression(
            statement.target.object,
            scope,
            null,
          );

          if (!isAny(object) && object.kind === "object") {
            const key = statement.target.index.value;
            const value = this.checkExpression(
              statement.value,
              scope,
              object.fields.get(key)?.type ?? null,
            );
            const existing = object.fields.get(key);

            if (!existing) {
              object.fields.set(key, { type: value, optional: false });
              return;
            }

            if (!isAssignable(value, existing.type)) {
              this.report(
                `Cannot assign ${displayType(value)} to ${displayType(existing.type)}`,
                statement.value,
              );
            }
            return;
          }
        }

        const target = this.checkExpression(statement.target, scope, null);
        const value = this.checkExpression(statement.value, scope, target);

        if (statement.operator === "=") {
          if (!isAssignable(value, target)) {
            this.reportAssignment(value, target, statement.value);
          }
          return;
        }

        // a compound assignment behaves like the binary operator it names
        const operator = statement.operator.slice(0, -1);
        const result = this.binaryResult(
          operator,
          target,
          value,
          statement,
        );
        if (!isAssignable(result, target)) {
          this.report(
            `Cannot assign ${displayType(result)} to ${displayType(target)}`,
            statement.value,
          );
        }
        return;
      }

      case "block_statement":
        this.checkBlock(statement, new Scope(scope));
        return;

      case "if_statement": {
        this.checkExpression(statement.condition, scope, null);
        // each branch sees what the condition proved about the names it tested
        const { whenTrue, whenFalse } = this.narrowingsFor(
          statement.condition,
          scope,
        );

        this.checkBlock(statement.consequent, this.scopeWith(scope, whenTrue));

        if (statement.alternate) {
          const elseScope = this.scopeWith(scope, whenFalse);
          if (statement.alternate.kind === "block_statement") {
            this.checkBlock(statement.alternate, elseScope);
          } else {
            this.checkStatement(statement.alternate, elseScope);
          }
        }
        return;
      }

      case "while_statement": {
        this.checkExpression(statement.condition, scope, null);
        this.loopDepth++;
        this.checkBlock(statement.body, new Scope(scope));
        this.loopDepth--;
        return;
      }

      case "for_statement": {
        const iterable = this.checkExpression(statement.iterable, scope, null);
        const element = this.elementTypeOf(iterable, statement);

        const loopScope = new Scope(scope);
        if (statement.valueBinding) {
          // the first name is the index for an array or string, the key for an
          // object; the second is the element. for an object the element is
          // its field types rather than its keys, which is what the one
          // binding form yields.
          loopScope.define(statement.binding, this.keyTypeOf(iterable));
          loopScope.define(
            statement.valueBinding,
            this.valueTypeOf(iterable, element),
          );
        } else {
          loopScope.define(statement.binding, element);
        }

        this.loopDepth++;
        this.checkBlock(statement.body, loopScope);
        this.loopDepth--;
        return;
      }

      case "function_declaration": {
        const signature = this.signatureOf(statement);
        // redefine in case this is a nested declaration the hoist pass missed
        scope.define(statement.name, signature);
        this.checkFunctionBody(
          statement.params,
          signature,
          statement.body,
          scope,
        );
        return;
      }

      case "return_statement": {
        if (statement.guard) {
          this.checkExpression(statement.guard, scope, null);
        }
        if (this.expectedReturn === null) {
          // the evaluator rejects this too, so flag it before it runs
          this.report("Cannot return from outside a function", statement);
          return;
        }

        const actual = statement.value
          ? this.checkExpression(statement.value, scope, this.expectedReturn)
          : VOID;

        if (!isAssignable(actual, this.expectedReturn)) {
          this.report(
            `Cannot return ${displayType(actual)} from a function declared to return ${displayType(this.expectedReturn)}`,
            statement.value ?? statement,
          );
        }
        return;
      }

      case "break_statement":
      case "continue_statement":
        if (this.loopDepth === 0) {
          this.report(
            `'${statement.kind === "break_statement" ? "break" : "continue"}' is only allowed inside a loop`,
            statement,
          );
        }
        return;

      case "interface_declaration":
      case "type_declaration":
        // both are handled in the hoist pass
        return;

      case "import_statement": {
        // the prelude is always in scope, so importing from it changes nothing
        if (statement.source === "prelude") {
          for (const specifier of statement.names) {
            if (!(specifier.name in PRELUDE_TYPES)) {
              this.report(
                `The prelude has no export named '${specifier.name}'`,
                specifier,
              );
            }
          }
          return;
        }

        const module = MODULE_TYPES[statement.source];
        if (!module) {
          this.report(`Unknown module '${statement.source}'`, statement);
          // bind the names as any so later use does not cascade errors
          for (const specifier of statement.names) {
            scope.define(specifier.name, ANY);
          }
          return;
        }

        for (const specifier of statement.names) {
          const type = module[specifier.name];
          if (!type) {
            this.report(
              `Module '${statement.source}' has no export named '${specifier.name}'`,
              specifier,
            );
            scope.define(specifier.name, ANY);
            continue;
          }
          scope.define(specifier.name, type);
        }
        return;
      }

      case "export_statement":
        for (const name of statement.names) {
          if (!scope.has(name)) {
            this.report(`Cannot export undefined name '${name}'`, statement);
          }
        }
        return;
    }
  }

  /**
   * the type a block evaluates to: its last statement's, mirroring how the
   * evaluator computes an implicit return. only a trailing expression carries
   * a value; anything else yields nil.
   */
  private checkBlockValue(
    block: BlockStatement,
    scope: Scope,
    expected: Type | null,
  ): Type {
    for (const statement of block.body) {
      if (statement.kind === "function_declaration") {
        scope.define(statement.name, this.signatureOf(statement));
      }
    }

    let value: Type = NIL;
    for (const statement of block.body) {
      value =
        statement.kind === "expression_statement"
          ? this.checkExpression(statement.expression, scope, expected)
          : (this.checkStatement(statement, scope), NIL);
    }
    return value;
  }

  private checkBlock(block: BlockStatement, scope: Scope): void {
    // hoist nested function declarations so they can be mutually recursive
    for (const statement of block.body) {
      if (statement.kind === "function_declaration") {
        scope.define(statement.name, this.signatureOf(statement));
      }
    }

    // a guarded return refines the statements after it: `return 0 if x == nil`
    // means x is not nil from that point on, which is the early exit idiom
    let current = scope;
    for (const statement of block.body) {
      this.checkStatement(statement, current);
      current = this.afterStatement(statement, current);
    }
  }

  /**
   * the scope the statements following this one should see.
   *
   * two shapes refine what comes after. a guarded return means reaching the
   * next line proves the guard was false. an `if` whose body always leaves —
   * the early exit idiom — means reaching the next line proves the condition
   * was false.
   */
  private afterStatement(statement: Statement, scope: Scope): Scope {
    if (statement.kind === "return_statement" && statement.guard) {
      const { whenFalse } = this.narrowingsFor(statement.guard, scope);
      return whenFalse.size ? this.scopeWith(scope, whenFalse) : scope;
    }

    if (
      statement.kind === "if_statement" &&
      !statement.alternate &&
      alwaysLeaves(statement.consequent)
    ) {
      const { whenFalse } = this.narrowingsFor(statement.condition, scope);
      return whenFalse.size ? this.scopeWith(scope, whenFalse) : scope;
    }

    return scope;
  }

  private checkFunctionBody(
    params: Parameter[],
    signature: FunctionTypeInfo,
    body: BlockStatement,
    scope: Scope,
  ): void {
    const bodyScope = new Scope(scope);
    params.forEach((param, index) => {
      bodyScope.define(param.name, signature.params[index] ?? ANY);
    });

    const previousReturn = this.expectedReturn;
    const previousLoopDepth = this.loopDepth;
    // a loop outside the function does not enclose its body
    this.expectedReturn = signature.returns;
    this.loopDepth = 0;

    this.checkBlock(body, bodyScope);

    this.expectedReturn = previousReturn;
    this.loopDepth = previousLoopDepth;
  }

  /**
   * the type of the second binding in `for k, v in ...`. an object yields its
   * field types here, where the single binding form yields its keys.
   */
  private valueTypeOf(iterable: Type, element: Type): Type {
    if (!isAny(iterable) && iterable.kind === "object") {
      const fields = [...iterable.fields.values()].map((field) => field.type);
      // an object with no known fields tells us nothing about its values
      return fields.length ? unionOf(fields) : ANY;
    }
    return element;
  }

  /** the type of the first binding in `for k, v in ...`. */
  private keyTypeOf(iterable: Type): Type {
    if (isAny(iterable)) return ANY;
    // an array or string is walked by numeric index, an object by string key
    if (iterable.kind === "array") return NUMBER;
    if (iterable.kind === "primitive" && iterable.name === "string") {
      return NUMBER;
    }
    if (iterable.kind === "object") return STRING;
    return ANY;
  }

  /** the type of one element when iterating a value. */
  private elementTypeOf(
    iterable: Type,
    node: { line: number; column: number },
  ): Type {
    if (isAny(iterable)) return ANY;
    if (iterable.kind === "array") return iterable.element;
    // iterating a string yields characters, an object yields its keys
    if (iterable.kind === "primitive" && iterable.name === "string") return STRING;
    if (iterable.kind === "object") return STRING;

    this.report(`Cannot iterate over ${displayType(iterable)}`, node);
    return ANY;
  }

  // --- patterns -------------------------------------------------------------

  /** declares the names a pattern binds, given the type it destructures. */
  private bindPattern(pattern: Pattern, type: Type, scope: Scope): void {
    switch (pattern.kind) {
      case "wildcard_pattern":
      case "literal_pattern":
        return;

      case "binding_pattern":
        scope.define(pattern.name, type);
        return;

      case "array_pattern": {
        const element = isAny(type)
          ? ANY
          : type.kind === "array"
            ? type.element
            : ANY;

        if (!isAny(type) && type.kind !== "array") {
          this.report(
            `Cannot destructure ${displayType(type)} as an array`,
            pattern,
          );
        }

        for (const item of pattern.elements) {
          this.bindPattern(item, element, scope);
        }
        if (pattern.rest) scope.define(pattern.rest, arrayOf(element));
        return;
      }

      case "variant_pattern": {
        const declared = this.variants.get(pattern.name);
        if (!declared) {
          this.report(`Unknown variant '${pattern.name}'`, pattern);
        }
        for (const field of pattern.fields) {
          const fieldType = declared?.fields.get(field.key)?.type ?? ANY;
          if (declared && !declared.fields.has(field.key)) {
            this.report(
              `Variant '${pattern.name}' has no field '${field.key}'`,
              field,
            );
          }
          this.bindPattern(field.value, fieldType, scope);
        }
        return;
      }

      case "object_pattern": {
        if (!isAny(type) && type.kind !== "object") {
          this.report(
            `Cannot destructure ${displayType(type)} as an object`,
            pattern,
          );
        }

        for (const field of pattern.fields) {
          let fieldType: Type = ANY;

          if (!isAny(type) && type.kind === "object") {
            const declared = type.fields.get(field.key);
            if (!declared) {
              this.report(
                `Property '${field.key}' does not exist on ${displayType(type)}`,
                field,
              );
            } else {
              fieldType = declared.type;
            }
          }

          this.bindPattern(field.value, fieldType, scope);
        }

        if (pattern.rest) scope.define(pattern.rest, ANY);
        return;
      }
    }
  }

  /** binds a match arm's pattern against the subject's type. */
  private bindMatchPattern(pattern: Pattern, subject: Type, scope: Scope): void {
    // a match narrows by shape, so a mismatch is not an error the way a `let`
    // destructure is: an arm that cannot match simply never runs.
    switch (pattern.kind) {
      case "wildcard_pattern":
      case "literal_pattern":
        return;

      case "binding_pattern":
        scope.define(pattern.name, subject);
        return;

      case "array_pattern": {
        const element =
          !isAny(subject) && subject.kind === "array" ? subject.element : ANY;
        for (const item of pattern.elements) {
          this.bindMatchPattern(item, element, scope);
        }
        if (pattern.rest) scope.define(pattern.rest, arrayOf(element));
        return;
      }

      case "variant_pattern": {
        const declared = this.variants.get(pattern.name);
        if (!declared) {
          this.report(`Unknown variant '${pattern.name}'`, pattern);
        }
        // matching a variant is what tells the arm which one it has, so the
        // fields come from the declaration rather than the subject
        for (const field of pattern.fields) {
          if (declared && !declared.fields.has(field.key)) {
            this.report(
              `Variant '${pattern.name}' has no field '${field.key}'`,
              field,
            );
          }
          const fieldType = declared?.fields.get(field.key)?.type ?? ANY;
          this.bindMatchPattern(field.value, fieldType, scope);
        }
        return;
      }

      case "object_pattern": {
        for (const field of pattern.fields) {
          const fieldType =
            !isAny(subject) && subject.kind === "object"
              ? (subject.fields.get(field.key)?.type ?? ANY)
              : ANY;
          this.bindMatchPattern(field.value, fieldType, scope);
        }
        if (pattern.rest) scope.define(pattern.rest, ANY);
        return;
      }
    }
  }

  // --- expressions ----------------------------------------------------------

  /**
   * infers the type of an expression. `expected` is the type the context wants,
   * used to shape an empty array literal and to check a lambda's parameters.
   */
  private checkExpression(
    expression: Expression,
    scope: Scope,
    expected: Type | null,
  ): Type {
    switch (expression.kind) {
      case "number_literal":
        return NUMBER;
      case "string_literal":
        return STRING;
      case "boolean_literal":
        return BOOL;

      case "nil_literal":
        return NIL;

      case "interpolated_string":
        // every hole is stringified, so any type is acceptable; check them so
        // an error inside a hole is still reported
        for (const hole of expression.expressions) {
          this.checkExpression(hole, scope, null);
        }
        return STRING;

      case "identifier": {
        const type = scope.lookup(expression.name);
        if (!type) {
          this.report(`Undefined variable '${expression.name}'`, expression);
          return ANY;
        }
        return type;
      }

      case "array_literal": {
        if (expression.elements.length === 0) {
          // an empty literal takes its element type from the context
          return expected && !isAny(expected) && expected.kind === "array"
            ? expected
            : arrayOf(ANY);
        }

        const elementHint =
          expected && !isAny(expected) && expected.kind === "array"
            ? expected.element
            : null;

        const types = expression.elements.map((element) =>
          this.checkExpression(element, scope, elementHint),
        );
        return arrayOf(unionOf(types));
      }

      case "object_literal": {
        const fields = new Map<string, FieldInfo>();
        const expectedObject =
          expected && !isAny(expected) && expected.kind === "object"
            ? expected
            : null;

        for (const property of expression.properties) {
          const hint = expectedObject?.fields.get(property.key)?.type ?? null;
          fields.set(property.key, {
            type: this.checkExpression(property.value, scope, hint),
            optional: false,
          });
        }

        // a literal's field set is exactly what is written
        return objectOf(fields, { exact: true });
      }

      case "unary_expression": {
        const operand = this.checkExpression(expression.operand, scope, null);

        if (expression.operator === "!") return BOOL;

        if (!isAny(operand) && !isAssignable(operand, NUMBER)) {
          this.report(`Cannot negate ${displayType(operand)}`, expression);
        }
        return NUMBER;
      }

      case "binary_expression": {
        const left = this.checkExpression(expression.left, scope, null);
        const right = this.checkExpression(expression.right, scope, null);
        return this.binaryResult(expression.operator, left, right, expression);
      }

      case "logical_expression": {
        const left = this.checkExpression(expression.left, scope, null);
        const right = this.checkExpression(expression.right, scope, null);
        // `&&` yields the left operand when falsy, `||` when truthy, so the
        // result is either side
        return unionOf([left, right]);
      }

      case "call_expression":
        return this.checkCall(expression, scope);

      case "member_expression": {
        const object = this.checkExpression(expression.object, scope, null);
        return this.propertyType(object, expression.property, expression);
      }

      case "index_expression": {
        const object = this.checkExpression(expression.object, scope, null);
        const index = this.checkExpression(expression.index, scope, null);
        return this.indexType(object, index, expression);
      }

      case "function_expression": {
        const signature = this.signatureOf(expression);
        this.checkFunctionBody(
          expression.params,
          signature,
          expression.body,
          scope,
        );
        return signature;
      }

      case "if_expression": {
        this.checkExpression(expression.condition, scope, null);
        const { whenTrue, whenFalse } = this.narrowingsFor(
          expression.condition,
          scope,
        );

        // the value is whichever branch ran, so the type is either
        const consequent = this.checkBlockValue(
          expression.consequent,
          this.scopeWith(scope, whenTrue),
          expected,
        );
        const elseScope = this.scopeWith(scope, whenFalse);
        const alternate =
          expression.alternate.kind === "block_statement"
            ? this.checkBlockValue(expression.alternate, elseScope, expected)
            : this.checkExpression(expression.alternate, elseScope, expected);

        return unionOf([consequent, alternate]);
      }

      case "match_expression":
        return this.checkMatch(expression, scope, expected);
    }
  }

  private checkCall(
    expression: Extract<Expression, { kind: "call_expression" }>,
    scope: Scope,
  ): Type {
    const callee = this.checkExpression(expression.callee, scope, null);

    // a variadic builtin still needs its arguments checked
    const variadic =
      expression.callee.kind === "identifier" &&
      VARIADIC.has(expression.callee.name) &&
      // only when it really is the prelude's, not a shadowing local
      scope.lookup(expression.callee.name) === PRELUDE_TYPES[expression.callee.name];

    if (isAny(callee)) {
      for (const arg of expression.args) this.checkExpression(arg, scope, null);
      return ANY;
    }

    if (callee.kind !== "function") {
      this.report(`Cannot call ${displayType(callee)}`, expression);
      for (const arg of expression.args) this.checkExpression(arg, scope, null);
      return ANY;
    }

    if (!variadic && expression.args.length !== callee.params.length) {
      this.report(
        `Expected ${callee.params.length} argument(s) but received ${expression.args.length}`,
        expression,
      );
    }

    expression.args.forEach((arg, index) => {
      const parameter = callee.params[index] ?? null;
      const actual = this.checkExpression(arg, scope, parameter);

      if (!parameter) return;
      if (isAssignable(actual, parameter)) return;

      this.report(this.mismatchMessage(actual, parameter, index), arg);
    });

    return callee.returns;
  }

  /** a call site mismatch, naming the missing fields when both are objects. */
  private mismatchMessage(actual: Type, expected: Type, index: number): string {
    const position = `argument ${index + 1}`;

    if (
      actual.kind === "object" &&
      expected.kind === "object"
    ) {
      const missing = missingFields(actual, expected);
      if (missing.length > 0) {
        return `Argument ${index + 1} is missing ${missing
          .map((name) => `'${name}'`)
          .join(", ")} required by ${displayType(expected)}`;
      }
    }

    const base = `Cannot pass ${displayType(actual)} as ${position} of type ${displayType(expected)}`;
    const hint = this.variantHint(actual, expected);
    return hint ? `${base}. ${hint}` : base;
  }

  private propertyType(
    object: Type,
    property: string,
    node: { line: number; column: number },
  ): Type {
    if (isAny(object)) return ANY;

    // length reads as a member on both arrays and strings
    if (property === "length") {
      if (object.kind === "array") return NUMBER;
      if (object.kind === "primitive" && object.name === "string") return NUMBER;
    }

    if (object.kind === "object") {
      const field = object.fields.get(property);
      if (!field) {
        this.report(
          `Property '${property}' does not exist on ${displayType(object)}`,
          node,
        );
        return ANY;
      }
      // an optional field may be absent at runtime
      return field.optional ? unionOf([field.type, NIL]) : field.type;
    }

    this.report(
      `Cannot read property '${property}' of ${displayType(object)}`,
      node,
    );
    return ANY;
  }

  private indexType(
    object: Type,
    index: Type,
    node: { line: number; column: number },
  ): Type {
    if (isAny(object)) return ANY;

    if (object.kind === "array") {
      if (!isAny(index) && !isAssignable(index, NUMBER)) {
        this.report(
          `An array index must be a number, received ${displayType(index)}`,
          node,
        );
      }
      return object.element;
    }

    if (object.kind === "primitive" && object.name === "string") {
      if (!isAny(index) && !isAssignable(index, NUMBER)) {
        this.report(
          `A string index must be a number, received ${displayType(index)}`,
          node,
        );
      }
      return STRING;
    }

    if (object.kind === "object") {
      // a computed key cannot be resolved to a declared field
      return ANY;
    }

    this.report(`Cannot index into ${displayType(object)}`, node);
    return ANY;
  }

  private checkMatch(
    expression: Extract<Expression, { kind: "match_expression" }>,
    scope: Scope,
    expected: Type | null,
  ): Type {
    const subject = this.checkExpression(expression.subject, scope, null);

    const armTypes = expression.arms.map((arm) =>
      this.checkArm(arm, subject, scope, expected),
    );

    this.checkExhaustive(expression, subject);

    // the match evaluates to whichever arm ran
    return unionOf(armTypes);
  }

  /**
   * reports a match that cannot handle every value its subject may take.
   *
   * only fires when the subject's type is finite and known: a bool, or a union
   * of things patterns can name. an `any` subject is left alone, because a
   * warning there would break the promise that unannotated code is never
   * rejected.
   */
  private checkExhaustive(
    expression: Extract<Expression, { kind: "match_expression" }>,
    subject: Type,
  ): void {
    if (isAny(subject)) return;

    // an arm with a guard may not run even when its pattern matches, so it
    // cannot be counted towards coverage
    const unguarded = expression.arms.filter((arm) => arm.guard === null);

    // a wildcard or a bare binding catches everything
    const hasCatchAll = unguarded.some(
      (arm) =>
        arm.pattern.kind === "wildcard_pattern" ||
        arm.pattern.kind === "binding_pattern",
    );
    if (hasCatchAll) return;

    const missing = this.uncoveredCases(subject, unguarded);
    if (missing.length === 0) return;

    this.report(
      `This match does not cover ${missing.join(", ")}. Add ${
        missing.length === 1 ? "that case" : "those cases"
      } or a _ arm.`,
      expression,
    );
  }

  /** the values of a finite subject type that no pattern matches. */
  private uncoveredCases(subject: Type, arms: MatchArm[]): string[] {
    const literals = new Set<string>();
    const matchedVariants = new Set<string>();
    for (const arm of arms) {
      if (arm.pattern.kind === "literal_pattern") {
        literals.add(stringifyLiteral(arm.pattern.value));
      }
      if (arm.pattern.kind === "variant_pattern") {
        matchedVariants.add(arm.pattern.name);
      }
    }

    // a tagged union is covered when every one of its variants is matched
    const variantsOf = (type: Type): string[] | null => {
      const options = type.kind === "union" ? type.options : [type];
      const names = options.map((option) =>
        option.kind === "object" ? option.variant : undefined,
      );
      // every member must be a variant for this to be a tagged union
      return names.every((name) => name !== undefined)
        ? (names as string[])
        : null;
    };

    const variantNames = variantsOf(subject);
    if (variantNames) {
      return variantNames.filter((name) => !matchedVariants.has(name));
    }

    // the cases a type can take, where that set is finite and nameable
    const casesOf = (type: Type): string[] | null => {
      if (type.kind === "primitive") {
        if (type.name === "bool") return ["true", "false"];
        if (type.name === "nil") return ["nil"];
      }
      // number, string and everything else have too many values to enumerate,
      // so a match over them is only exhaustive with a catch-all, which was
      // handled above. naming the type is the most useful thing to say.
      return null;
    };

    if (subject.kind === "union") {
      // every member must be covered, and a member is covered either by its
      // own literals or by an arm whose pattern accepts that whole member
      const missing: string[] = [];
      for (const option of subject.options) {
        const cases = casesOf(option);
        if (cases === null) {
          // an unenumerable member needs a catch-all, which is absent here
          missing.push(displayType(option));
          continue;
        }
        for (const value of cases) {
          if (!literals.has(value)) missing.push(value);
        }
      }
      return missing;
    }

    const cases = casesOf(subject);
    // no catch-all and no way to enumerate: some value will reach no arm
    if (cases === null) {
      return literals.size > 0 ? [`every other ${displayType(subject)}`] : [];
    }
    return cases.filter((value) => !literals.has(value));
  }

  private checkArm(
    arm: MatchArm,
    subject: Type,
    scope: Scope,
    expected: Type | null,
  ): Type {
    const armScope = new Scope(scope);
    this.bindMatchPattern(arm.pattern, subject, armScope);

    if (arm.guard) this.checkExpression(arm.guard, armScope, null);

    if (arm.body.kind === "block_statement") {
      this.checkBlock(arm.body, new Scope(armScope));
      // a block bodied arm yields null unless it returns
      return NIL;
    }

    return this.checkExpression(arm.body, armScope, expected);
  }

  /** the result type of a binary operator, reporting a mismatch. */
  private binaryResult(
    operator: string,
    left: Type,
    right: Type,
    node: { line: number; column: number },
  ): Type {
    switch (operator) {
      case "==":
      case "!=":
        return BOOL;

      case "<":
      case ">":
      case "<=":
      case ">=":
        this.expectNumeric(operator, left, right, node);
        return BOOL;

      case "+": {
        if (isAny(left) || isAny(right)) return ANY;

        // `+` concatenates when either side is a string
        if (
          isAssignable(left, STRING) ||
          isAssignable(right, STRING)
        ) {
          return STRING;
        }

        if (left.kind === "array" && right.kind === "array") {
          return arrayOf(unionOf([left.element, right.element]));
        }

        this.expectNumeric(operator, left, right, node);
        return NUMBER;
      }

      case "-":
      case "*":
      case "/":
      case "%":
        this.expectNumeric(operator, left, right, node);
        return NUMBER;

      default:
        return ANY;
    }
  }

  private expectNumeric(
    operator: string,
    left: Type,
    right: Type,
    node: { line: number; column: number },
  ): void {
    const leftOk = isAny(left) || isAssignable(left, NUMBER);
    const rightOk = isAny(right) || isAssignable(right, NUMBER);

    if (leftOk && rightOk) return;

    this.report(
      `Cannot apply '${operator}' to ${displayType(left)} and ${displayType(right)}`,
      node,
    );
  }
}

/** checks a program, returning every error found. */
export function check(program: Program): CheckResult {
  return new Checker().check(program);
}
