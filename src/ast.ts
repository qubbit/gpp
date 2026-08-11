// ast node definitions for gpp.
//
// every node carries the line/column of the token that started it so the type
// checker and the interpreter can report errors against source positions.

export interface Position {
  line: number;
  column: number;
}

// --- types ------------------------------------------------------------------

// type annotations are parsed into this tree and kept on the ast. the checker
// walks them; the interpreter ignores them.
export type TypeNode =
  | NamedType
  | ArrayType
  | ObjectType
  | FunctionType
  | UnionType;

export interface NamedType extends Position {
  kind: "named_type";
  // number, string, bool, any, void, or an interface name
  name: string;
}

export interface ArrayType extends Position {
  kind: "array_type";
  element: TypeNode;
}

export interface ObjectType extends Position {
  kind: "object_type";
  fields: TypeField[];
}

export interface TypeField extends Position {
  name: string;
  type: TypeNode;
  optional: boolean;
}

export interface FunctionType extends Position {
  kind: "function_type";
  params: TypeNode[];
  returns: TypeNode;
}

export interface UnionType extends Position {
  kind: "union_type";
  options: TypeNode[];
}

// --- patterns ---------------------------------------------------------------

// used by match arms and by destructuring declarations.
export type Pattern =
  | WildcardPattern
  | LiteralPattern
  | BindingPattern
  | ArrayPattern
  | ObjectPattern;

// `_` matches anything and binds nothing.
export interface WildcardPattern extends Position {
  kind: "wildcard_pattern";
}

export interface LiteralPattern extends Position {
  kind: "literal_pattern";
  value: number | string | boolean | null;
}

// a bare identifier in pattern position binds whatever it matches.
export interface BindingPattern extends Position {
  kind: "binding_pattern";
  name: string;
}

export interface ArrayPattern extends Position {
  kind: "array_pattern";
  elements: Pattern[];
  // name bound to the tail by `...rest`, if present
  rest: string | null;
}

export interface ObjectPattern extends Position {
  kind: "object_pattern";
  fields: ObjectPatternField[];
  rest: string | null;
}

export interface ObjectPatternField extends Position {
  // property read from the subject
  key: string;
  // pattern the property must match; `{a}` desugars to key "a" with a
  // binding_pattern of the same name.
  value: Pattern;
}

// --- expressions ------------------------------------------------------------

export type Expression =
  | NumberLiteral
  | StringLiteral
  | InterpolatedString
  | BooleanLiteral
  | NilLiteral
  | Identifier
  | ArrayLiteral
  | ObjectLiteral
  | UnaryExpression
  | BinaryExpression
  | LogicalExpression
  | CallExpression
  | MemberExpression
  | IndexExpression
  | FunctionExpression
  | IfExpression
  | MatchExpression;

export interface NumberLiteral extends Position {
  kind: "number_literal";
  value: number;
}

export interface StringLiteral extends Position {
  kind: "string_literal";
  value: string;
}

/**
 * `"a {b} c"`. literals and expressions alternate, starting and ending with a
 * literal, so `literals.length === expressions.length + 1`.
 */
export interface InterpolatedString extends Position {
  kind: "interpolated_string";
  literals: string[];
  expressions: Expression[];
}

export interface BooleanLiteral extends Position {
  kind: "boolean_literal";
  value: boolean;
}

export interface NilLiteral extends Position {
  kind: "nil_literal";
}

export interface Identifier extends Position {
  kind: "identifier";
  name: string;
}

export interface ArrayLiteral extends Position {
  kind: "array_literal";
  elements: Expression[];
}

export interface ObjectLiteral extends Position {
  kind: "object_literal";
  properties: ObjectProperty[];
}

export interface ObjectProperty extends Position {
  key: string;
  // `{ a }` is shorthand for `{ a: a }`; shorthand is recorded so a printer
  // can round-trip the source.
  value: Expression;
  shorthand: boolean;
}

export interface UnaryExpression extends Position {
  kind: "unary_expression";
  operator: "-" | "!";
  operand: Expression;
}

export interface BinaryExpression extends Position {
  kind: "binary_expression";
  operator: string;
  left: Expression;
  right: Expression;
}

// `&&` and `||` are separate from binary_expression because they short-circuit,
// so the interpreter must not eagerly evaluate the right side.
export interface LogicalExpression extends Position {
  kind: "logical_expression";
  operator: "&&" | "||";
  left: Expression;
  right: Expression;
}

export interface CallExpression extends Position {
  kind: "call_expression";
  callee: Expression;
  args: Expression[];
}

// dot access: `a.b`. the property is a fixed name, not an expression.
export interface MemberExpression extends Position {
  kind: "member_expression";
  object: Expression;
  property: string;
}

// bracket access: `a[expr]`, where the key is computed.
export interface IndexExpression extends Position {
  kind: "index_expression";
  object: Expression;
  index: Expression;
}

export interface FunctionExpression extends Position {
  kind: "function_expression";
  // null for anonymous functions
  name: string | null;
  params: Parameter[];
  returnType: TypeNode | null;
  body: BlockStatement;
}

export interface Parameter extends Position {
  name: string;
  type: TypeNode | null;
}

// `let s = if n > 0 { "pos" } else { "neg" }`. distinct from IfStatement: an
// if in expression position must produce a value, so both branches are blocks
// whose last statement is the result, and an else is required.
export interface IfExpression extends Position {
  kind: "if_expression";
  condition: Expression;
  consequent: BlockStatement;
  // an `else if` chain nests another if_expression here
  alternate: BlockStatement | IfExpression;
}

export interface MatchExpression extends Position {
  kind: "match_expression";
  subject: Expression;
  arms: MatchArm[];
}

export interface MatchArm extends Position {
  pattern: Pattern;
  // optional `if <expr>` guard evaluated only when the pattern matches
  guard: Expression | null;
  body: Expression | BlockStatement;
}

// --- statements -------------------------------------------------------------

export type Statement =
  | LetStatement
  | ExpressionStatement
  | AssignmentStatement
  | BlockStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | FunctionDeclaration
  | ReturnStatement
  | BreakStatement
  | ContinueStatement
  | InterfaceDeclaration
  | ImportStatement
  | ExportStatement;

// gpp has no `const`; every binding is introduced with `let`. the target is a
// pattern so `let {a} = zz` destructures.
export interface LetStatement extends Position {
  kind: "let_statement";
  target: Pattern;
  typeAnnotation: TypeNode | null;
  value: Expression | null;
}

export interface ExpressionStatement extends Position {
  kind: "expression_statement";
  expression: Expression;
}

// `x = 1`, `zz["a"] = 5`, `f += 1`. `operator` is "=" for plain assignment or
// the compound form ("+=", "-=", "*=", "/=", "%=").
export interface AssignmentStatement extends Position {
  kind: "assignment_statement";
  target: Identifier | MemberExpression | IndexExpression;
  operator: string;
  value: Expression;
}

export interface BlockStatement extends Position {
  kind: "block_statement";
  body: Statement[];
}

export interface IfStatement extends Position {
  kind: "if_statement";
  condition: Expression;
  consequent: BlockStatement;
  // an `else if` chain nests an if_statement here
  alternate: BlockStatement | IfStatement | null;
}

export interface WhileStatement extends Position {
  kind: "while_statement";
  condition: Expression;
  body: BlockStatement;
}

// `for x in xs { ... }`
export interface ForStatement extends Position {
  kind: "for_statement";
  binding: string;
  // `for i, v in xs` binds a second name: the index for an array or string,
  // the key for an object. null for the single-binding form.
  valueBinding: string | null;
  iterable: Expression;
  body: BlockStatement;
}

export interface FunctionDeclaration extends Position {
  kind: "function_declaration";
  name: string;
  params: Parameter[];
  returnType: TypeNode | null;
  body: BlockStatement;
}

export interface ReturnStatement extends Position {
  kind: "return_statement";
  value: Expression | null;
  // `return 5 if x > 10` returns only when the guard holds
  guard: Expression | null;
}

export interface BreakStatement extends Position {
  kind: "break_statement";
}

export interface ContinueStatement extends Position {
  kind: "continue_statement";
}

export interface InterfaceDeclaration extends Position {
  kind: "interface_declaration";
  name: string;
  fields: TypeField[];
}

// `from math import sin, cos` — the source is a bare name or a string literal.
export interface ImportStatement extends Position {
  kind: "import_statement";
  source: string;
  names: ImportSpecifier[];
}

export interface ImportSpecifier extends Position {
  name: string;
}

// `export z, zz`
export interface ExportStatement extends Position {
  kind: "export_statement";
  names: string[];
}

export interface Program extends Position {
  kind: "program";
  body: Statement[];
}

export type Node = Program | Statement | Expression | Pattern | TypeNode;
