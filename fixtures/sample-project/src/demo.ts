import jwt from "jsonwebtoken";
import helper from "./helper.js";

const debugValue = "temporary";
console.log("debugging");

debugger;

export function run() {
  return helper + debugValue;
}
