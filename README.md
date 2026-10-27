# elasticio-sailor-nodejs

> The official elastic.io library for bootstrapping and executing for Node.js connectors.

[![NPM](https://nodei.co/npm/elasticio-sailor-nodejs.png?downloads=true)](https://nodei.co/npm/elasticio-sailor-nodejs/)

`elasticio-sailor-nodejs` is a **required dependency for all components build for [elastic.io platform](http://www.elastic.io) in Node.js**.

## Install

Requires **Node.js >= 24.22.1**.

```json
    "dependencies": {
        "elasticio-sailor-nodejs": "^3.0.0"
    }
```

Sailor no longer brings `q`, `co` or `lodash` in. If your component uses them, declare them in its own `package.json`.
See the [CHANGELOG](CHANGELOG.md) for everything that changed in 3.0.0.

## How it works: Sailor Proxy

Since 3.0.0 sailor does not connect to RabbitMQ. It is a client of **Sailor Proxy**, which mediates between
sailors and the message broker:

- sailor keeps one HTTP/2 session to the proxy (`ELASTICIO_SAILOR_PROXY_URI`), with PING keepalive and
  automatic reconnect (jittered exponential backoff)
- incoming messages are streamed from the proxy (prefetch: `ELASTICIO_PROXY_PREFETCH_SAILOR`); each one is
  acknowledged to the proxy when processing finishes
- `data`, `error`, `snapshot`, rebound etc. emitted by the component are sent to the proxy, rate limited
  (see [Flow control](#flow-control))
- every request is signed with a JWT (`ELASTICIO_SAILOR_PROXY_JWT_SECRET`)
- lightweight message bodies go directly to object storage (Maester), not through the proxy

## Components: CommonJS or ESM

Sailor loads triggers, actions and `verifyCredentials` with dynamic `import()`, so both module formats work:

```JavaScript
// CommonJS
exports.process = async function process(msg, cfg, snapshot) {
    await this.emit('data', { body: msg.body });
};

// ESM (component package.json has "type": "module")
export async function process(msg, cfg, snapshot) {
    return { body: msg.body }; // a returned value is emitted as `data`, then `end`
}
```

`module.exports = fn` (a single function) and `exports.process = fn` both work. Callback-style
`verifyCredentials(cfg, cb)` and model methods are still supported, as is returning a value or a promise.

## TypeScript

Sailor is written in TypeScript and ships its types. Type `this` in `process` and hooks:

```TypeScript
import type { TaskExecContext, IncomingMessage, InitHook } from 'elasticio-sailor-nodejs';

export async function process(this: TaskExecContext, msg: IncomingMessage, cfg: { apiKey: string }) {
    this.logger.info('Processing message');
    await this.emit('data', { body: msg.body });
}

export const init: InitHook<{ apiKey: string }> = async function (cfg) {
    this.logger.info('init');
};
```

Exported types: `TaskExecContext`, `IncomingMessage`, `OutgoingMessage`, `Snapshot`, `ProcessFunction`,
`StartupHook`, `InitHook`, `ShutdownHook`, `HookContext`, `Settings`, `ServiceSettings`, `ServiceExec`,
`VerifyCredentialsResult`, `ComponentLogger`, `ApiClient`, `StepData`, `MessageMetadata`, `LegacyCallback`.



## Environment variables

Every variable has the `ELASTICIO_` prefix. They are set by the platform; values are validated at startup
and an invalid value stops the sailor with an error.

- Numbers must be numeric (`Infinity` is allowed where it is the default) and within the range below.
- Booleans accept `true`/`1` and `false`/`0` (case-insensitive); empty means the default.

### Mandatory

| Variable | Notes |
|----------|-------|
| `FLOW_ID`, `EXEC_ID`, `STEP_ID`, `CONTAINER_ID`, `WORKSPACE_ID`, `USER_ID`, `COMP_ID`, `FUNCTION` | Execution identity |
| `API_URI`, `API_USERNAME`, `API_KEY` | Platform API credentials |
| `SAILOR_PROXY_JWT_SECRET` | Signs requests to the sailor proxy |
| `OUTGOING_MESSAGE_SIZE_LIMIT` | Positive integer, bytes |
| `SAILOR_PROXY_URI`, `MESSAGE_CRYPTO_PASSWORD`, `MESSAGE_CRYPTO_IV` | Not required when `HOOK_SHUTDOWN` is set |

### Optional

| Variable | Default | Range / notes |
|----------|---------|---------------|
| `COMPONENT_PATH` | `''` | Component directory, relative to cwd |
| `INPUT_FORMAT` | `default` | |
| `PROTOCOL_VERSION` | `1` | >= 1 |
| `STARTUP_REQUIRED` | `false` | Run the startup hook |
| `HOOK_SHUTDOWN` | `false` | Only run the shutdown hook |
| `NO_SELF_PASSTHROUGH` | `false` | |
| `EMIT_LIGHTWEIGHT_MESSAGE` | `false` | Store message bodies in object storage |
| `OBJECT_STORAGE_URI`, `OBJECT_STORAGE_TOKEN` | `null` | |
| `OBJECT_STORAGE_SIZE_THRESHOLD` | `1048576` | >= 0, bytes |
| `OBJECT_STORAGE_RETRY_ATTEMPTS` | `2` | 0–4 |
| `OBJECT_STORAGE_REQUEST_TIMEOUT` | `10000` | 500–20000 ms |
| `DATA_RATE_LIMIT` | `10` | >= 1, per `RATE_INTERVAL` |
| `ERROR_RATE_LIMIT` | `2` | >= 1, per `RATE_INTERVAL` |
| `SNAPSHOT_RATE_LIMIT` | `2` | >= 1, per `RATE_INTERVAL` |
| `RATE_INTERVAL` | `100` | >= 1 ms |
| `API_REQUEST_RETRY_ATTEMPTS` | `3` | >= 0 |
| `API_REQUEST_RETRY_DELAY` | `100` | >= 0 ms |
| `PROXY_PREFETCH_SAILOR` | `1` | >= 1 |
| `PROXY_PING_INTERVAL_MS` | `10000` | >= 1 ms |
| `PROXY_RECONNECT_MAX_RETRIES` | `Infinity` | >= 0 |
| `PROXY_RECONNECT_INITIAL_DELAY` | `1000` | >= 0 ms |
| `PROXY_RECONNECT_MAX_DELAY` | `30000` | >= 0 ms |
| `PROXY_RECONNECT_BACKOFF_MULTIPLIER` | `2` | >= 1 |
| `PROXY_RECONNECT_JITTER_FACTOR` | `0.3` | >= 0 |
| `PROXY_OBJECT_REQUEST_RETRY_ATTEMPTS` | `Infinity` | >= 0 |
| `PROXY_OBJECT_REQUEST_RETRY_DELAY` | `100` | >= 0 ms |
| `PROXY_OBJECT_REQUEST_MAX_RETRY_DELAY` | `300000` | >= 0 ms |
| `ADDITIONAL_VARS_FOR_HEADERS` | – | Comma-separated env var names, sent as headers |

`runService` (verifyCredentials, select models) reads `POST_RESULT_URL`, `CFG`, `ACTION_OR_TRIGGER`,
`GET_MODEL_METHOD`, `COMPONENT_PATH`, `API_URI`, `API_USERNAME`, `API_KEY`, `API_REQUEST_RETRY_ATTEMPTS`,
`API_REQUEST_RETRY_DELAY`. `this.getConfig()` returns these parsed settings, not `process.env`.

## Sailor logging

Sailor uses [bunyan](https://github.com/trentm/node-bunyan) logging framework. 
 
Supported log levels are:

- `FATAL`
- `ERROR`
- `WARN`
- `INFO`
- `DEBUG`
- `TRACE`

Default log level is `INFO`. You can change default log level with environment variable `LOG_LEVEL`
(e.g. `LOG_LEVEL=trace` for sailor internals; `DEBUG=sailor` is no longer used).

Sailor logger adds the following extra context to log messages:

- `ELASTICIO_API_USERNAME`
- `ELASTICIO_COMP_ID`
- `ELASTICIO_COMP_NAME`
- `ELASTICIO_CONTAINER_ID`
- `ELASTICIO_CONTRACT_ID`
- `ELASTICIO_EXEC_ID`
- `ELASTICIO_EXEC_TYPE`
- `ELASTICIO_EXECUTION_RESULT_ID`
- `ELASTICIO_FLOW_ID`
- `ELASTICIO_FLOW_VERSION`
- `ELASTICIO_FUNCTION`
- `ELASTICIO_STEP_ID`
- `ELASTICIO_TASK_USER_EMAIL`
- `ELASTICIO_TENANT_ID`
- `ELASTICIO_USER_ID`
- `ELASTICIO_WORKSPACE_ID`

## Component logging

Sailor exposes logger object for use in a component. Component logger inherits log level from sailor's logger
and adds the following extra context to log messages:

- `messageId` (unique ID of the next message)
- `parentMessageId` (unique ID of the previous message)
- `threadId` (unique ID of execution thread)

Component logger usage example:

```JavaScript
this.logger.fatal('message');
this.logger.error('message');
this.logger.warn('message');
this.logger.info('message');
this.logger.debug('message');
this.logger.trace('message');
```

## Flow control

When working in the multi-tenant integration environment it's important to obey the API and
consumption limits imposed by the platform. This is not only a condition for you integrations to
run on the platform (and not begin suspended), but also a good integration practice to sustainably
and efficiently use resources.

Imagine a system where one party (published) publishes to the queue and one or more consumers
consume from the queue. If publishers are writing to the queue faster than consumers read data
from the queue, queue will earlier or later be overfilled. Once one queue of your integration flow
will grow to a particular limit, the complete integration flow will be suspended and author will be
informed about it. Flow control is a build-in mechanism in the SDK that will help you to prevent
the overflow to happen.

There are two types of flow control:
 * Static flow control - the hard limit of the events (e.g. messages published to the queue) that can
 be generated by component. This limit is dictated by your pricing plan and will limit protect the
 platform from extensive load.
 * Dynamic flow control - the limit that is imposed based on the state of individual queue, more
 messages are in the queue, slower publisher could write to it.

Let's take a look at the simple example:

```JavaScript
'use strict';

exports.process = process;

async function process(msg, cfg, snapshot) {
    for (let i = 0; i < 100000; i++) {
        this.logger.info('Sending message %s', i);
        await this.emit('data', {
            body: {
                counter: i,
                hi: 'there'
            }
        });
        this.logger.info('Message %s was sent', i);
    }
}
```

This simple component, once started on the platform will generate 100k messages. Without flow control this
example will quickly bring the integration queue to the limits and integration flow will be suspended.
With flow control the publishing rate of the messages will be slowed down so both publisher and consumers
will operate in balance.

### How to configure it

The static flow control is configured with `DATA_RATE_LIMIT`, `ERROR_RATE_LIMIT`, `SNAPSHOT_RATE_LIMIT`
and `RATE_INTERVAL` (see [Environment variables](#environment-variables)). Dynamic flow control is implemented
in the message-oriented middleware of the platform hence can't be configured on the component level.

## Sailor hooks

### Init hook

```javascript
/**
* cfg - This is the same config as the one passed to "processMessage" method of the trigger or action
*/
exports.init = function(cfg) {
    //do stuff
    return Promise.resolve();
}
```

### Startup hook

```javascript
/**
* cfg - This is the same config as the one passed to "processMessage" method of the trigger or action
*/
exports.startup = function(cfg) {
    //do stuff
    const data = {
        message: 'Hello from STARTUP_HOOK'
    };
    return Promise.resolve(data);
}
```

- Only on the first trigger
- Called with ``this`` = `HookContext` (see below)
- May return promise
- May return value
- May throw - not recommended
- May return a promise that will fail

- Startup logs can be found in the tab of the component on execution page

Startup state data - either return value or the result of the promise

- OK
  - Results will be stored as the startup state, previous will be overwritten with warning
  - After that init hook will be run, etc
- NOK
  - Sailor will exit the process
  - Platform will restart the component immediately
  - If init wont' happen it will be removed after 5 minutes (see restart policy)
  - In the next scheduling interval initialisation will repeat

### Shutdown hook

```javascript
/**
* cfg - This is the same config as the one passed to "processMessage" method of the trigger or action
* startData - result from the startup
*/
exports.shutdown = function(cfg, startData) {
    //corresponding to the startup example above, startData is { message: 'Hello from STARTUP_HOOK' }
    //do stuff
    return Promise.resolve();
}
```

 - Only on the first trigger
 - One stop is pressed
    - If task is running then containers are shutdown
    - If task is sleeping then do nothing
 - Start new trigger container
 - Called with ``this`` = `HookContext` (see below); it's not possible to send new data
 - Should either return value (ignored) or promise (resolved).
 - Startup data is removed after shutdown hook
 - Call the shutdown hook, parameters that are passed is from the startup results or ``{}`` if nothing was returned
 - Errors are ignored
 - If shutdown hook won't complete within 60 seconds then container will be killed
 - As soon as user pressed stop, task is marked as inactive and 'webhooks gateway' will start responding with the error (Task either does not exist or is inactive) to possible data

### Hook context

`startup`, `init` and `shutdown` are called with `this` set to a hook context:

- `this.logger` – the component logger
- `this.getApiClient()` – the platform API client
- `this.getConfig()` – the sailor settings

Hooks that do not use `this` keep working.

## Local development

```bash
npm run dev:local                            # run against a local sailor-proxy, env from config/local.json
npm run encode -- '{"body":{"k":"v"}}' [1|2] # encrypt a message (protocol version 1 or 2)
npm run decode -- <base64> [1|2]             # decrypt a message
npm test                                     # build, lint, unit + integration tests
```
