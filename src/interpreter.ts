import parse from "./parser.js";
import { Lexer } from "./lexer.js";

const lexer = new Lexer();

let s = `if x > 1999.123 {
  println(x)
}

let name = "Gopal" // lol

let s: string = ""

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
export double
`;
let s2 = `let x = 10
let y = x + 20

interface Point {
  x: number
  y: number
}

from "abc" import xyz 
from math import sin, cos, tan, pi
from prelude import map, reduce, type // prelude is always imported

// type(x) returns type of x (as string)

let zz = {a: 1, b: "hello", c: []}

let {a} = zz // a = 1

let obj = { a }

let matched = match some_function(obj) {
  [1,2] -> "success"
  [3,4] -> "fail"
}

interface Ok {
  value: any;
}

interface Error {
  err: string
}

zz["a"] = 5

f += 1

let z = [1,2,3,4, [1]]

if (y > 20) {
  y = y * 2
}

export z, zz
`;

let p = "let z = (x) + y * 4";

const program = parse(lexer.lex(s2.trim()));
console.log(JSON.stringify(program, null, 2));
