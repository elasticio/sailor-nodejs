# 3. Component-facing API stays compatible

Status: accepted (2026-10-30)

## Context

Many existing components run on sailor. The rewrite must not force them to change.

## Decision

The runtime API that components see stays the same:
`this.emit/logger/getApiClient/getConfig/getFlowVariables`, `process` that returns data or a
promise, and callback-style `verifyCredentials`/model methods (resolved by the callback or by a
truthy return value). Sailor never runs generators itself; components that use them bring their own `co`.

The only change on purpose is additive: hooks get a `this` context (`logger`, `getApiClient`,
`getConfig`) (B7).

## Consequences

- `component/compat.ts` keeps the callback/return-value adapter for good.
- The integration fixture components stay CJS JS to prove this.
- Components that used sailor's transitive `q` without declaring it break (see ADR 0004). `lodash`
  stays available. That is a dependency issue, not an API change.
