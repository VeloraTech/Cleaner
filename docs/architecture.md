# Cleaner architecture

Cleaner is intentionally small and conservative. The core flow is:

1. Collect candidate files.
2. Parse the source for important constructs.
3. Build findings with severity and confidence.
4. Decide whether a fix is safe.
5. Show a preview in diff mode.
6. Apply only explicit safe changes in write mode.

The implementation keeps the pipeline simple enough to understand and extend without introducing heavy abstraction.

Unused-import analysis uses the TypeScript compiler AST and checker to resolve
local binding symbols. A declaration is marked safely removable only when all
its local bindings resolve and have no references; type references, exports,
aliases, nested scopes, and shorthand properties are included. Parse or binding
uncertainty produces a warning without a fix. Import transformations use the
AST declaration's source range rather than matching identifier text.
