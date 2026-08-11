// tree-walk evaluator for gpp.
//
// runs the ast the parser produces. type annotations are carried on the tree
// but ignored here; checking them is a separate pass.

import type {
  BlockStatement,
  Expression,
  MatchArm,
  Pattern,
  Program,
  Statement,
} from "./ast.js";
import {
  createModules,
  createPrelude,
  installPrelude,
  RuntimeError,
} from "./builtins.js";
import { COLLECTIONS_SOURCE } from "./collections.gpp.js";
import { Lexer } from "./lexer.js";
import { parse } from "./parser.js";
import {
  Environment,
  isCallable,
  isObject,
  isTruthy,
  stringify,
  typeName,
  valuesEqual,
  type FunctionValue,
  type ObjectValue,
  type Value,
} from "./values.js";

// non-local control flow is carried by exceptions so a `return` deep inside
// nested blocks unwinds to the function boundary without threading a signal
// through every visit method.
class ReturnSignal {
  constructor(public readonly value: Value) {}
}
class BreakSignal {}
class ContinueSignal {}

export interface RunResult {
  output: string[];
  error: string | null;
  // names the program exported, useful for the playground and future modules
  exports: Record<string, Value>;
}

export interface RunOptions {
  // guards against a runaway loop locking up the browser tab
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 5_000_000;

// modules implemented in gpp. `exports` maps the imported name to the name the
// source declares, so `map` can be exported without shadowing the prelude's
// `map` inside the module itself.
const SOURCE_MODULES: Record<
  string,
  { code: string; exports: Record<string, string> }
> = {
  collections: {
    code: COLLECTIONS_SOURCE,
    exports: {
      stack: "stack",
      queue: "queue",
      set: "set",
      map: "map_new",
      linked_list: "linked_list",
      priority_queue: "priority_queue",
    },
  },
};

export class Evaluator {
  private globals = new Environment();
  private output: string[] = [];
  private modules = createModules();
  private steps = 0;
  private maxSteps = DEFAULT_MAX_STEPS;
  private exported: string[] = [];

  constructor() {
    // the prelude is always in scope; programs never import it
    installPrelude(
      this.globals,
      createPrelude(
        (line) => this.output.push(line),
        (callee, args) => this.callValue(callee, args, 0, 0),
      ),
    );
  }

  run(program: Program, options: RunOptions = {}): RunResult {
    this.output = [];
    this.steps = 0;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.exported = [];

    try {
      for (const statement of program.body) {
        this.execute(statement, this.globals);
      }
    } catch (error) {
      if (error instanceof ReturnSignal) {
        return this.result("Cannot return from outside a function");
      }
      if (error instanceof BreakSignal || error instanceof ContinueSignal) {
        return this.result("Cannot break or continue outside a loop");
      }
      if (error instanceof RuntimeError) {
        return this.result(error.message);
      }
      throw error;
    }

    return this.result(null);
  }

  private result(error: string | null): RunResult {
    const exports: Record<string, Value> = {};
    for (const name of this.exported) {
      const value = this.globals.get(name);
      if (value !== undefined) exports[name] = value;
    }
    return { output: this.output, error, exports };
  }

  /** counted on every loop turn and call so infinite programs terminate. */
  private tick(line: number, column: number): void {
    if (++this.steps > this.maxSteps) {
      throw new RuntimeError(
        "Execution exceeded the step limit, the program may not terminate",
        line,
        column,
      );
    }
  }

  // --- statements -----------------------------------------------------------

  private execute(statement: Statement, env: Environment): void {
    switch (statement.kind) {
      case "let_statement": {
        const value = statement.value
          ? this.evaluate(statement.value, env)
          : null;
        this.bindPattern(statement.target, value, env, true);
        return;
      }

      case "expression_statement":
        this.evaluate(statement.expression, env);
        return;

      case "assignment_statement":
        this.executeAssignment(statement, env);
        return;

      case "block_statement":
        this.executeBlock(statement, new Environment(env));
        return;

      case "if_statement": {
        if (isTruthy(this.evaluate(statement.condition, env))) {
          this.executeBlock(statement.consequent, new Environment(env));
        } else if (statement.alternate) {
          if (statement.alternate.kind === "block_statement") {
            this.executeBlock(statement.alternate, new Environment(env));
          } else {
            this.execute(statement.alternate, env);
          }
        }
        return;
      }

      case "while_statement": {
        while (isTruthy(this.evaluate(statement.condition, env))) {
          this.tick(statement.line, statement.column);
          try {
            this.executeBlock(statement.body, new Environment(env));
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (signal instanceof ContinueSignal) continue;
            throw signal;
          }
        }
        return;
      }

      case "for_statement": {
        const iterable = this.evaluate(statement.iterable, env);
        const items = this.iterableToArray(iterable, statement);

        for (const item of items) {
          this.tick(statement.line, statement.column);
          // a fresh scope per turn so a closure captures that turn's binding
          const loopScope = new Environment(env);
          loopScope.define(statement.binding, item);
          try {
            this.executeBlock(statement.body, loopScope);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (signal instanceof ContinueSignal) continue;
            throw signal;
          }
        }
        return;
      }

      case "function_declaration": {
        const fn: FunctionValue = {
          kind: "function",
          name: statement.name,
          params: statement.params,
          body: statement.body,
          closure: env,
        };
        env.define(statement.name, fn);
        return;
      }

      case "return_statement": {
        // `return 5 if x > 10` falls through when the guard is false
        if (statement.guard && !isTruthy(this.evaluate(statement.guard, env))) {
          return;
        }
        throw new ReturnSignal(
          statement.value ? this.evaluate(statement.value, env) : null,
        );
      }

      case "break_statement":
        throw new BreakSignal();

      case "continue_statement":
        throw new ContinueSignal();

      // interfaces describe types only, so they have no runtime effect
      case "interface_declaration":
        return;

      case "import_statement":
        this.executeImport(statement, env);
        return;

      case "export_statement":
        for (const name of statement.names) {
          if (!env.has(name)) {
            throw new RuntimeError(
              `Cannot export undefined name '${name}'`,
              statement.line,
              statement.column,
            );
          }
          this.exported.push(name);
        }
        return;
    }
  }

  private executeBlock(block: BlockStatement, scope: Environment): void {
    for (const statement of block.body) {
      this.execute(statement, scope);
    }
  }

  /**
   * runs a block and yields the value of its last statement, which is what a
   * function body falls back on when it has no explicit `return`.
   *
   * only a trailing expression, `if` or `match` carries a value. a block ending
   * in a declaration, an assignment or a loop yields nil, because those
   * statements have no value to give.
   */
  private executeBlockValue(block: BlockStatement, scope: Environment): Value {
    let value: Value = null;

    for (const statement of block.body) {
      value = this.executeValue(statement, scope);
    }

    return value;
  }

  /** runs one statement, yielding its value when it has one. */
  private executeValue(statement: Statement, scope: Environment): Value {
    switch (statement.kind) {
      case "expression_statement":
        return this.evaluate(statement.expression, scope);

      case "block_statement":
        return this.executeBlockValue(statement, new Environment(scope));

      case "if_statement": {
        if (isTruthy(this.evaluate(statement.condition, scope))) {
          return this.executeBlockValue(
            statement.consequent,
            new Environment(scope),
          );
        }
        if (!statement.alternate) {
          // an if with no else that did not run produced nothing
          return null;
        }
        // an `else if` chain nests another if_statement here
        return statement.alternate.kind === "block_statement"
          ? this.executeBlockValue(statement.alternate, new Environment(scope))
          : this.executeValue(statement.alternate, scope);
      }

      default:
        // everything else is a statement in the ordinary sense: run it for its
        // effect, and contribute no value
        this.execute(statement, scope);
        return null;
    }
  }

  private executeAssignment(
    statement: Extract<Statement, { kind: "assignment_statement" }>,
    env: Environment,
  ): void {
    const target = statement.target;

    // a compound assignment reads the current value first
    const nextValue = (current: Value): Value => {
      const operand = this.evaluate(statement.value, env);
      if (statement.operator === "=") return operand;
      const op = statement.operator.slice(0, -1);
      return this.binaryOp(op, current, operand, statement.line, statement.column);
    };

    if (target.kind === "identifier") {
      const current =
        statement.operator === "="
          ? null
          : this.lookup(target.name, env, statement.line, statement.column);
      const value = nextValue(current);
      if (!env.assign(target.name, value)) {
        throw new RuntimeError(
          `Cannot assign to undefined variable '${target.name}'`,
          target.line,
          target.column,
        );
      }
      return;
    }

    if (target.kind === "index_expression") {
      const object = this.evaluate(target.object, env);
      const index = this.evaluate(target.index, env);

      if (Array.isArray(object)) {
        if (typeof index !== "number" || !Number.isInteger(index)) {
          throw new RuntimeError(
            "An array index must be an integer",
            target.line,
            target.column,
          );
        }
        if (index < 0 || index >= object.length) {
          throw new RuntimeError(
            `Index ${index} is out of bounds for an array of length ${object.length}`,
            target.line,
            target.column,
          );
        }
        object[index] = nextValue(object[index]!);
        return;
      }

      if (isObject(object)) {
        const key = String(index);
        object[key] = nextValue(object[key] ?? null);
        return;
      }

      throw new RuntimeError(
        `Cannot index into ${typeName(object)}`,
        target.line,
        target.column,
      );
    }

    // member_expression
    const object = this.evaluate(target.object, env);
    if (!isObject(object)) {
      throw new RuntimeError(
        `Cannot set property '${target.property}' on ${typeName(object)}`,
        target.line,
        target.column,
      );
    }
    object[target.property] = nextValue(object[target.property] ?? null);
  }

  private executeImport(
    statement: Extract<Statement, { kind: "import_statement" }>,
    env: Environment,
  ): void {
    // the prelude is already in scope, so importing from it is a no-op that
    // stays legal for programs that spell the import out
    if (statement.source === "prelude") return;

    const module =
      this.modules[statement.source] ??
      this.loadSourceModule(statement.source);

    if (!module) {
      throw new RuntimeError(
        `Unknown module '${statement.source}'`,
        statement.line,
        statement.column,
      );
    }

    for (const specifier of statement.names) {
      const value = module[specifier.name];
      if (value === undefined) {
        throw new RuntimeError(
          `Module '${statement.source}' has no export named '${specifier.name}'`,
          specifier.line,
          specifier.column,
        );
      }
      env.define(specifier.name, value);
    }
  }

  /**
   * modules written in gpp rather than as native functions. the source is
   * evaluated once in its own scope, and the names it declares become the
   * module's exports. caching means two imports share one instance of each
   * constructor, which matters only for identity.
   */
  private loadSourceModule(name: string): Record<string, Value> | undefined {
    const source = SOURCE_MODULES[name];
    if (!source) return undefined;

    // a module sees the prelude but not the importing program's scope
    const scope = new Environment(this.globals);
    const program = parse(new Lexer().lex(source.code));

    for (const statement of program.body) {
      this.execute(statement, scope);
    }

    const exports: Record<string, Value> = {};
    for (const [exported, declared] of Object.entries(source.exports)) {
      const value = scope.get(declared);
      if (value !== undefined) exports[exported] = value;
    }

    this.modules[name] = exports;
    return exports;
  }

  private iterableToArray(value: Value, statement: Statement): Value[] {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [...value];
    if (isObject(value)) return Object.keys(value);
    throw new RuntimeError(
      `Cannot iterate over ${typeName(value)}`,
      statement.line,
      statement.column,
    );
  }

  // --- expressions ----------------------------------------------------------

  private evaluate(expression: Expression, env: Environment): Value {
    switch (expression.kind) {
      case "number_literal":
      case "string_literal":
      case "boolean_literal":
        return expression.value;

      case "nil_literal":
        return null;

      case "interpolated_string": {
        // literals and expressions alternate, so walk them together. each hole
        // is rendered with the same stringify print uses.
        let out = expression.literals[0] ?? "";
        expression.expressions.forEach((hole, index) => {
          out += stringify(this.evaluate(hole, env));
          out += expression.literals[index + 1] ?? "";
        });
        return out;
      }

      case "identifier":
        return this.lookup(
          expression.name,
          env,
          expression.line,
          expression.column,
        );

      case "array_literal":
        return expression.elements.map((element) => this.evaluate(element, env));

      case "object_literal": {
        const object: ObjectValue = {};
        for (const property of expression.properties) {
          object[property.key] = this.evaluate(property.value, env);
        }
        return object;
      }

      case "unary_expression": {
        const operand = this.evaluate(expression.operand, env);
        if (expression.operator === "!") return !isTruthy(operand);
        if (typeof operand !== "number") {
          throw new RuntimeError(
            `Cannot negate ${typeName(operand)}`,
            expression.line,
            expression.column,
          );
        }
        return -operand;
      }

      case "binary_expression":
        return this.binaryOp(
          expression.operator,
          this.evaluate(expression.left, env),
          this.evaluate(expression.right, env),
          expression.line,
          expression.column,
        );

      case "logical_expression": {
        // short circuits, so the right side is only evaluated when needed
        const left = this.evaluate(expression.left, env);
        if (expression.operator === "&&") {
          return isTruthy(left) ? this.evaluate(expression.right, env) : left;
        }
        return isTruthy(left) ? left : this.evaluate(expression.right, env);
      }

      case "call_expression": {
        const callee = this.evaluate(expression.callee, env);
        const args = expression.args.map((arg) => this.evaluate(arg, env));
        return this.callValue(
          callee,
          args,
          expression.line,
          expression.column,
        );
      }

      case "member_expression": {
        const object = this.evaluate(expression.object, env);
        return this.readProperty(
          object,
          expression.property,
          expression.line,
          expression.column,
        );
      }

      case "index_expression": {
        const object = this.evaluate(expression.object, env);
        const index = this.evaluate(expression.index, env);
        return this.readIndex(object, index, expression.line, expression.column);
      }

      case "function_expression":
        return {
          kind: "function",
          name: expression.name,
          params: expression.params,
          body: expression.body,
          closure: env,
        };

      case "if_expression": {
        // an else is required by the parser, so one branch always runs
        const branch = isTruthy(this.evaluate(expression.condition, env))
          ? expression.consequent
          : expression.alternate;

        return branch.kind === "block_statement"
          ? this.executeBlockValue(branch, new Environment(env))
          : this.evaluate(branch, env);
      }

      case "match_expression":
        return this.evaluateMatch(expression, env);
    }
  }

  private lookup(
    name: string,
    env: Environment,
    line: number,
    column: number,
  ): Value {
    if (!env.has(name)) {
      throw new RuntimeError(`Undefined variable '${name}'`, line, column);
    }
    return env.get(name)!;
  }

  private readProperty(
    object: Value,
    property: string,
    line: number,
    column: number,
  ): Value {
    // a couple of properties read naturally as members rather than calls
    if (typeof object === "string" && property === "length") return object.length;
    if (Array.isArray(object) && property === "length") return object.length;

    if (!isObject(object)) {
      throw new RuntimeError(
        `Cannot read property '${property}' of ${typeName(object)}`,
        line,
        column,
      );
    }
    return object[property] ?? null;
  }

  private readIndex(
    object: Value,
    index: Value,
    line: number,
    column: number,
  ): Value {
    if (Array.isArray(object)) {
      if (typeof index !== "number" || !Number.isInteger(index)) {
        throw new RuntimeError("An array index must be an integer", line, column);
      }
      // negative indices count from the end
      const resolved = index < 0 ? object.length + index : index;
      if (resolved < 0 || resolved >= object.length) {
        throw new RuntimeError(
          `Index ${index} is out of bounds for an array of length ${object.length}`,
          line,
          column,
        );
      }
      return object[resolved]!;
    }

    if (typeof object === "string") {
      if (typeof index !== "number") {
        throw new RuntimeError("A string index must be a number", line, column);
      }
      const resolved = index < 0 ? object.length + index : index;
      return object[resolved] ?? null;
    }

    if (isObject(object)) return object[String(index)] ?? null;

    throw new RuntimeError(`Cannot index into ${typeName(object)}`, line, column);
  }

  private callValue(
    callee: Value,
    args: Value[],
    line: number,
    column: number,
  ): Value {
    this.tick(line, column);

    if (!isCallable(callee)) {
      throw new RuntimeError(`Cannot call ${typeName(callee)}`, line, column);
    }

    if (callee.kind === "native") {
      if (callee.arity !== null && args.length !== callee.arity) {
        throw new RuntimeError(
          `${callee.name} expects ${callee.arity} argument(s) but received ${args.length}`,
          line,
          column,
        );
      }
      try {
        return callee.call(args);
      } catch (error) {
        // give a builtin's error the call site's position
        if (error instanceof RuntimeError && error.line === 0) {
          throw new RuntimeError(error.message, line, column);
        }
        throw error;
      }
    }

    if (args.length !== callee.params.length) {
      throw new RuntimeError(
        `${callee.name ?? "This function"} expects ${callee.params.length} argument(s) but received ${args.length}`,
        line,
        column,
      );
    }

    const scope = new Environment(callee.closure);
    callee.params.forEach((param, index) => {
      scope.define(param.name, args[index]!);
    });

    try {
      // a body that falls off the end yields its last statement's value; an
      // explicit `return` unwinds first and still wins
      return this.executeBlockValue(callee.body, scope);
    } catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value;
      throw signal;
    }
  }

  private binaryOp(
    operator: string,
    left: Value,
    right: Value,
    line: number,
    column: number,
  ): Value {
    switch (operator) {
      case "==":
        return valuesEqual(left, right);
      case "!=":
        return !valuesEqual(left, right);
    }

    // `+` concatenates when either side is a string, and joins arrays
    if (operator === "+") {
      if (typeof left === "string" || typeof right === "string") {
        return stringify(left) + stringify(right);
      }
      if (Array.isArray(left) && Array.isArray(right)) {
        return [...left, ...right];
      }
    }

    if (typeof left !== "number" || typeof right !== "number") {
      throw new RuntimeError(
        `Cannot apply '${operator}' to ${typeName(left)} and ${typeName(right)}`,
        line,
        column,
      );
    }

    switch (operator) {
      case "+":
        return left + right;
      case "-":
        return left - right;
      case "*":
        return left * right;
      case "/":
        if (right === 0) throw new RuntimeError("Division by zero", line, column);
        return left / right;
      case "%":
        if (right === 0) throw new RuntimeError("Modulo by zero", line, column);
        return left % right;
      case "<":
        return left < right;
      case ">":
        return left > right;
      case "<=":
        return left <= right;
      case ">=":
        return left >= right;
      default:
        throw new RuntimeError(`Unknown operator '${operator}'`, line, column);
    }
  }

  // --- match ----------------------------------------------------------------

  private evaluateMatch(
    expression: Extract<Expression, { kind: "match_expression" }>,
    env: Environment,
  ): Value {
    const subject = this.evaluate(expression.subject, env);

    for (const arm of expression.arms) {
      // each arm matches in its own scope so bindings do not leak between arms
      const scope = new Environment(env);
      if (!this.matchPattern(arm.pattern, subject, scope)) continue;
      // a guard runs only once the pattern's bindings are in scope
      if (arm.guard && !isTruthy(this.evaluate(arm.guard, scope))) continue;

      return this.evaluateArmBody(arm, scope);
    }

    throw new RuntimeError(
      `No match arm matched ${stringify(subject)}`,
      expression.line,
      expression.column,
    );
  }

  private evaluateArmBody(arm: MatchArm, scope: Environment): Value {
    if (arm.body.kind === "block_statement") {
      // like a function body, a block arm yields its last statement's value.
      // a `return` inside it still unwinds to the enclosing function.
      return this.executeBlockValue(arm.body, new Environment(scope));
    }
    return this.evaluate(arm.body, scope);
  }

  /**
   * tests `value` against `pattern`, defining any bindings in `scope`. bindings
   * made before a later failure are discarded with the scope by the caller.
   */
  private matchPattern(
    pattern: Pattern,
    value: Value,
    scope: Environment,
  ): boolean {
    switch (pattern.kind) {
      case "wildcard_pattern":
        return true;

      case "literal_pattern":
        return valuesEqual(pattern.value, value);

      case "binding_pattern":
        scope.define(pattern.name, value);
        return true;

      case "array_pattern": {
        if (!Array.isArray(value)) return false;
        // without a rest the lengths must agree exactly
        if (pattern.rest === null) {
          if (value.length !== pattern.elements.length) return false;
        } else if (value.length < pattern.elements.length) {
          return false;
        }

        for (const [index, element] of pattern.elements.entries()) {
          if (!this.matchPattern(element, value[index]!, scope)) return false;
        }

        if (pattern.rest !== null) {
          scope.define(pattern.rest, value.slice(pattern.elements.length));
        }
        return true;
      }

      case "object_pattern": {
        if (!isObject(value)) return false;

        const matched = new Set<string>();
        for (const field of pattern.fields) {
          if (!(field.key in value)) return false;
          if (!this.matchPattern(field.value, value[field.key]!, scope)) {
            return false;
          }
          matched.add(field.key);
        }

        if (pattern.rest !== null) {
          const rest: ObjectValue = {};
          for (const [key, item] of Object.entries(value)) {
            if (!matched.has(key)) rest[key] = item;
          }
          scope.define(pattern.rest, rest);
        }
        return true;
      }
    }
  }

  /** declares the names a pattern binds, used by `let`. */
  private bindPattern(
    pattern: Pattern,
    value: Value,
    env: Environment,
    declare: boolean,
  ): void {
    const scope = new Environment(env);
    if (!this.matchPattern(pattern, value, scope)) {
      throw new RuntimeError(
        `Cannot destructure ${stringify(value)}`,
        pattern.line,
        pattern.column,
      );
    }

    // lift the bindings the pattern made into the real scope
    for (const name of collectBindings(pattern)) {
      const bound = scope.get(name);
      if (declare) env.define(name, bound ?? null);
      else env.assign(name, bound ?? null);
    }
  }
}

/** every name a pattern introduces. */
function collectBindings(pattern: Pattern, names: string[] = []): string[] {
  switch (pattern.kind) {
    case "binding_pattern":
      names.push(pattern.name);
      break;
    case "array_pattern":
      for (const element of pattern.elements) collectBindings(element, names);
      if (pattern.rest) names.push(pattern.rest);
      break;
    case "object_pattern":
      for (const field of pattern.fields) collectBindings(field.value, names);
      if (pattern.rest) names.push(pattern.rest);
      break;
    default:
      break;
  }
  return names;
}

/** lex, parse and run a source string. */
export function run(program: Program, options?: RunOptions): RunResult {
  return new Evaluator().run(program, options);
}
