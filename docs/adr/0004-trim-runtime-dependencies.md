# 4. Trim runtime dependencies

Status: accepted (2026-10-30)

## Context

Native Node 24 covers what `q`, `co`, `uuid`, `event-to-promise` and `debug` provided. Dropping `lodash` too
was planned, but many components use it without declaring it and get it through sailor.

## Decision

Drop `q`, `co`, `uuid`, `event-to-promise` and `debug` (replaced by native promises, async/await,
`crypto.randomUUID`, `events.once` and `logger.trace`).
Keep `lodash`: components depend on it transitively, and sailor uses it itself (`pick`, `omit`, `isEmpty`,
`isPlainObject`, `snakeCase`) instead of custom utils. Deep copies use native `structuredClone`.
Keep `bunyan` (the platform parses its log format), `p-throttle`, `jsonwebtoken`,
`elasticio-rest-node` and `@elastic.io/maester-client`.

## Consequences

- Components that relied on sailor bringing in `q` must declare it. This goes in the CHANGELOG.
- `DEBUG=sailor` is replaced by `LOG_LEVEL=trace`.
- Log output must stay byte-compatible with bunyan; do not swap the logger lightly.
