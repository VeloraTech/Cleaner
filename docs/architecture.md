# Cleaner architecture

Cleaner is intentionally small and conservative. The core flow is:

1. Collect candidate files.
2. Parse the source for important constructs.
3. Build findings with severity and confidence.
4. Decide whether a fix is safe.
5. Show a preview in diff mode.
6. Apply only explicit safe changes in write mode.

The implementation keeps the pipeline simple enough to understand and extend without introducing heavy abstraction.

Unused-import, unused-variable, and unused-parameter analysis uses the
TypeScript compiler AST and checker to resolve local binding symbols. An import
is marked safely removable only when all its local bindings resolve and have no
references; type references, exports, aliases, nested scopes, and shorthand
properties are included. Parse or binding uncertainty never produces an import
removal. Import transformations use the AST declaration's source range rather
than matching identifier text. Variable and parameter findings remain
warning-only and non-fixable.

Console calls are also located with the TypeScript AST. Cleaner removes only a
standalone console expression statement in a block, module body, or switch case.
Calls embedded in another expression or used as an unbraced control-flow body
remain unchanged and receive a warning. Dead-code and legacy-file checks remain
heuristic and report-only; unused-function, unused-export, duplicate-code, and
artifact rules are registered but not currently analyzed.
