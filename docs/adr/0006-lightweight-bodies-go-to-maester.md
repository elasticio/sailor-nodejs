# 6. Lightweight message bodies go directly to Maester

Status: accepted (2026-10-30)

## Context

The sailor-proxy contains references to an `/object` endpoint, but it does not implement one; they are
leftovers. The old sailor talked to Maester directly for lightweight bodies.

## Decision

Lightweight message/passthrough bodies keep being uploaded to and fetched from Maester directly
(`storage/`, via `@elastic.io/maester-client`), encrypted with the same Encryptor as proxy messages.
Retries use maester-client's native `retryOptions`, configured by new env vars:
`ELASTICIO_OBJECT_STORAGE_RETRY_ATTEMPTS` (2, range 0–4) and `ELASTICIO_OBJECT_STORAGE_REQUEST_TIMEOUT`
(10000, range 500–20000 ms). Out-of-range values throw at startup. `PROXY_OBJECT_REQUEST_*` stays
proxy-request-only, as it always was in practice.

## Consequences

- Sailor needs network access and credentials for Maester as well as the proxy.
- Revisit if the proxy ever gets a real `/object` endpoint.
