import foo from "./foo.js";

function test() {
  return function nested() {
    return foo;
  };
}
