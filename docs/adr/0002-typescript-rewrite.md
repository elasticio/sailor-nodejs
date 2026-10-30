# 2. Rewrite sailor in TypeScript, big-bang, for 3.0.0

Status: accepted (2026-10-30)

## Context

The JS code base (`lib/`) relied on old libraries (`q`, `co`) and had no types. Its tests
were split between jasmine and mocha, and they reached into module internals.

## Decision

- Rewrite all of `lib/` at once into `src/` (no file-by-file migration). The old specs serve as the
  gate: they ran against the new code before they were rewritten.
- `tsc` → `dist/`. Only `dist/` plus the root shims `run.js`/`runService.js` are published. The shims
  stay at the package root so platform entrypoints don't change.
- `strict`, `erasableSyntaxOnly` (no `enum`, `namespace` or parameter properties), so `.ts` runs
  natively in Node for tests and scripts (no ts-node).
- `engines.node: ">=24.22.1"`. One test runner: mocha + chai + sinon. eslint 9 flat config.
- Collaborators are injected through constructors (`Sailor`, `MessageProcessor`, `ProxyClient`, …),
  and factories (`createSailor`) wire the real ones.

## Consequences

- Major version bump (Node engine, see also ADR 0005).
- `enum` and parameter properties are off-limits; use `as const` objects and explicit fields.
- Tests fake collaborators instead of stubbing modules (fits ADR 0001).
- The `.d.ts` files are published; types for component authors are exported from `src/index.ts`.
