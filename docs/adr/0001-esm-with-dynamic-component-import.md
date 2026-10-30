# 1. Ship sailor as ESM, load components with dynamic `import()`

Status: accepted (2026-10-27)

## Context

Existing components are CommonJS and were loaded with `require`. The TypeScript rewrite targets
Node >= 24.22.1, so both module systems are fully available.

## Decision

Sailor is compiled to ESM. Component modules (triggers, actions, verifyCredentials, hooks) are
loaded with dynamic `import()`, which loads both CJS and ESM components.

## Consequences

- Existing CJS components keep working unchanged; ESM components become possible.
- A CJS module's `module.exports` arrives as `default` — the loader must unwrap it.
- Sailor's own modules cannot be stubbed in tests via module mocking; collaborators are passed in
  through constructors instead.
- Going back to CJS later would mean re-checking every component-loading path.
