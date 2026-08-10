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
  NULL,
  NUMBER,
  STRING,
  VOID,
  arrayOf,
  displayType,
  functionOf,
  isAny,
  isAssignable,
  missingFields,
  objectOf,
  unionOf,
  type FieldInfo,
  type FunctionTypeInfo,
  type ObjectTypeInfo,
  type Type,
} from "./types.js";

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
  print: functionOf([], VOID),

  // reflection
  type: functionOf([ANY], STRING),
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

  // objects
  keys: functionOf([ANY], arrayOf(STRING)),
  values: functionOf([ANY], arrayOf(ANY)),

  // strings
  upper: functionOf([STRING], STRING),
  lower: functionOf([STRING], STRING),
  trim: functionOf([STRING], STRING),
  split: functionOf([STRING, STRING], arrayOf(STRING)),
  join: functionOf([arrayOf(ANY), STRING], STRING),
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
const VARIADIC = new Set(["print", "min", "max"]);

const MODULE_TYPES: Record<string, Record<string, Type>> = {
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
  // the return type of the function being checked, null at the top level
  private expectedReturn: Type | null = null;
  private loopDepth = 0;

  check(program: Program): CheckResult {
    this.errors = [];
    this.interfaces.clear();
    this.expectedReturn = null;
    this.loopDepth = 0;

    const scope = new Scope();
    for (const [name, type] of Object.entries(PRELUDE_TYPES)) {
      scope.define(name, type);
    }

    // interfaces first, so a declaration may reference one declared later
    for (const statement of program.body) {
      if (statement.kind === "interface_declaration") {
        this.declareInterface(statement);
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
          case "null":
            return NULL;
          case "never":
            return NEVER;
        }

        const declared = this.interfaces.get(node.name);
        if (declared) return declared;

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
          this.report(
            `Cannot assign ${displayType(actual)} to ${displayType(annotated)}`,
            statement.value,
          );
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
            this.report(
              `Cannot assign ${displayType(value)} to ${displayType(target)}`,
              statement.value,
            );
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
        this.checkBlock(statement.consequent, new Scope(scope));
        if (statement.alternate) {
          if (statement.alternate.kind === "block_statement") {
            this.checkBlock(statement.alternate, new Scope(scope));
          } else {
            this.checkStatement(statement.alternate, scope);
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
        loopScope.define(statement.binding, element);

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
        // already handled in the hoist pass
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

  private checkBlock(block: BlockStatement, scope: Scope): void {
    // hoist nested function declarations so they can be mutually recursive
    for (const statement of block.body) {
      if (statement.kind === "function_declaration") {
        scope.define(statement.name, this.signatureOf(statement));
      }
    }

    for (const statement of block.body) {
      this.checkStatement(statement, scope);
    }
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

    return `Cannot pass ${displayType(actual)} as ${position} of type ${displayType(expected)}`;
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
      return field.optional ? unionOf([field.type, NULL]) : field.type;
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

    // the match evaluates to whichever arm ran
    return unionOf(armTypes);
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
      return NULL;
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
