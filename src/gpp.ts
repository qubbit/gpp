// the public entry point: source in, output and ast out.

import { Lexer, LexError } from "./lexer.js";
import { parse, ParseError } from "./parser.js";
import { Evaluator, type RunOptions } from "./evaluator.js";
import { check, type TypeError } from "./checker.js";
import type { Program } from "./ast.js";

export { Lexer, LexError } from "./lexer.js";
export { parse, Parser, ParseError } from "./parser.js";
export { Evaluator, run } from "./evaluator.js";
export { RuntimeError } from "./builtins.js";
export { check, Checker, type TypeError } from "./checker.js";
export * from "./ast.js";
export type { Value } from "./values.js";
export type { Type } from "./types.js";

export interface GppError {
  message: string;
  line: number;
  column: number;
  stage: "lex" | "parse" | "runtime";
}

export interface ExecuteResult {
  output: string[];
  ast: Program | null;
  error: GppError | null;
  // type errors do not stop execution: the evaluator is dynamically typed and
  // checking is gradual, so these are reported alongside whatever the program
  // produced rather than in place of it.
  typeErrors: TypeError[];
}

/**
 * runs a program, returning its output alongside the ast. errors are returned
 * rather than thrown so a caller like the playground can render them.
 */
export function execute(source: string, options?: RunOptions): ExecuteResult {
  let ast: Program;

  try {
    ast = parse(new Lexer().lex(source));
  } catch (error) {
    if (error instanceof LexError) {
      return {
        output: [],
        ast: null,
        error: {
          message: error.message,
          line: error.line,
          column: error.column,
          stage: "lex",
        },
        typeErrors: [],
      };
    }
    if (error instanceof ParseError) {
      return {
        output: [],
        ast: null,
        error: {
          message: error.message,
          line: error.line,
          column: error.column,
          stage: "parse",
        },
        typeErrors: [],
      };
    }
    throw error;
  }

  // checking never blocks execution, so a type error and real output can be
  // reported together
  const { errors: typeErrors } = check(ast);
  const result = new Evaluator().run(ast, options);

  return {
    output: result.output,
    ast,
    // the evaluator already formats the position into the message
    error: result.error
      ? { message: result.error, line: 0, column: 0, stage: "runtime" }
      : null,
    typeErrors,
  };
}

/** parses without running, for the playground's ast view. */
export function parseOnly(source: string): { ast: Program | null; error: GppError | null } {
  try {
    return { ast: parse(new Lexer().lex(source)), error: null };
  } catch (error) {
    if (error instanceof LexError || error instanceof ParseError) {
      return {
        ast: null,
        error: {
          message: error.message,
          line: error.line,
          column: error.column,
          stage: error instanceof LexError ? "lex" : "parse",
        },
      };
    }
    throw error;
  }
}
