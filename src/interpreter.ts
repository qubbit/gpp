import parse from "./parser";
import { Lexer } from "./lexer";

const lexer = new Lexer();

let s = `if x > 1999.123 {
  print(x)
}

let name = "Gopal" // lol

let y = 4
let _z = 3
let can_i_eat = true

fn double(x) {
  return x * 2
}

fn square_double(x) {
return double(x * x)
}
// some comment
// more comment
`;
let s2 = `let x = 10
let y = x + 20

if (y > 20) {
  y = y * 2
}`;

let p = "let z = (x) + y * 4";
const tokens = lexer.lex(s2.trim());
// const tokens2 = lexer.lex("let a = 4");

console.log("tokens", tokens);
