<<<<<<< HEAD
## 3.0.0

Sailor no longer connects to RabbitMQ: it talks to the platform through **Sailor Proxy** over HTTP/2.
It is also rewritten in TypeScript.

### Sailor Proxy

* Messages are fetched from and sent to Sailor Proxy (`ELASTICIO_SAILOR_PROXY_URI`), which mediates between sailors
  and the message broker. Requests are signed with a JWT (`ELASTICIO_SAILOR_PROXY_JWT_SECRET`)
* One HTTP/2 session with PING keepalive (`ELASTICIO_PROXY_PING_INTERVAL_MS`) and reconnect with jittered
  exponential backoff (`ELASTICIO_PROXY_RECONNECT_*`); request retries via `ELASTICIO_PROXY_OBJECT_REQUEST_*`
* Prefetch: `ELASTICIO_PROXY_PREFETCH_SAILOR`
* Removed env vars (broker handling moved to the proxy), all with the `ELASTICIO_` prefix:
  * connection: `AMQP_URI`, `AMQP_RECONNECT_ATTEMPTS`, `AMQP_RECONNECT_TIMEOUT`
  * queues/routing: `LISTEN_MESSAGES_ON`, `PUBLISH_MESSAGES_TO`, `DATA_ROUTING_KEY`, `ERROR_ROUTING_KEY`,
    `REBOUND_ROUTING_KEY`, `SNAPSHOT_ROUTING_KEY`
  * publishing: `AMQP_PUBLISH_RETRY_ATTEMPTS`, `AMQP_PUBLISH_RETRY_DELAY`, `AMQP_PUBLISH_MAX_RETRY_DELAY`,
    `AMQP_PERSISTENT_MESSAGES`, `PROCESS_AMQP_DRAIN`
  * consuming: `RABBITMQ_PREFETCH_SAILOR` (now `PROXY_PREFETCH_SAILOR`), `WAIT_MESSAGES_TIMEOUT`
  * rebounds/errors: `REBOUND_LIMIT`, `REBOUND_INITIAL_EXPIRATION`, `NO_ERROR_REPLIES`
* Lightweight message bodies still go directly to object storage (Maester)

### Breaking changes for components

* `this.__getAmqp()` is removed: sailor has no direct access to AMQP any more.
* New emit type `customType` replaces publishing to exchanges yourself:
  ```javascript
  await this.emit('customType', { type: '{TYPE_STRING}', payload: { body: {}, headers: {} } });
  ```
  Sailor sends the payload as `POST /message?type={TYPE_STRING}` and does not interpret `type`, so new custom
  types only need a change in Sailor Proxy, not in sailor. Currently the only type is `pub-sub`.

  Migrating a pub-sub publisher, before:
  ```javascript
  const amqp = this.__getAmqp();
  const encryptedBody = amqp.encryptMessageContent({ body: msg.body }, 2);
  await amqp.sendToExchange(pubSubExchange, topic, encryptedBody, {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
          protocolVersion: 2,
          messageId: uuid.v4(),
          pubSubOriginalMessageId: msg.headers.messageId
      }
  });
  ```
  After (the topic goes into the `x-eio-routing-key` header; encryption and message ids are handled by sailor):
  ```javascript
  await this.emit('customType', {
      type: 'pub-sub',
      payload: {
          body: msg.body,
          headers: { 'x-eio-routing-key': topic }
      }
  });
  ```

### Requirements

* Node.js `>=24.22.1`
* Sailor no longer installs `q`, `co`, `lodash`, `uuid`, `event-to-promise` or `debug`. Components that used
  them without declaring them (e.g. `q` coming in transitively) must add them to their own `package.json`.

### Added

* Written in TypeScript; types are bundled (`TaskExecContext`, `IncomingMessage`, hook types, `Settings`, …)
* ESM components: triggers, actions and `verifyCredentials` are loaded with `import()`. CommonJS components work as before
* Hooks (`startup`/`init`/`shutdown`) get `this`: `logger`, `getApiClient()`, `getConfig()`
* `ELASTICIO_OBJECT_STORAGE_RETRY_ATTEMPTS` (default 2, 0–4) and `ELASTICIO_OBJECT_STORAGE_REQUEST_TIMEOUT`
  (default 10000, 500–20000 ms) for object storage (Maester) requests

### Breaking changes

* Env vars are validated at startup, an invalid value stops the sailor:
  * numeric mandatory settings (`OUTGOING_MESSAGE_SIZE_LIMIT`) are parsed as positive integers
  * optional numbers: `"0"` is honoured where allowed, a non-numeric value throws `ELASTICIO_X must be a number`
  * booleans: only `true`/`1`/`false`/`0` (case-insensitive) or empty; `"no"`, `"yes"` etc. throw
* `NO_SELF_PASSTRHOUGH` (typo) is ignored: use `ELASTICIO_NO_SELF_PASSTHROUGH`
* `runService`: env is parsed by the same typed settings parser; `this.getConfig()` returns the parsed settings,
  not `process.env`
* `/resume-processing` failure goes through the fatal error path (logged as fatal, still exit code 1)
* Startup data 409: re-created with the same normalised state (`{}` for empty), not the raw hook result
* Graceful shutdown failure exits with code 1 (was 255)
* `verifyCredentials` load errors (syntax error, missing dependency) report `verified: false` with the reason.
  The always-verified stub is used only when the component has no `verifyCredentials`
* `scheduleShutdown` is idempotent: every call gets the same promise, resolved when no message is in flight
* `DEBUG=sailor` is gone; use `LOG_LEVEL=trace`

### Fixed

* Graceful shutdown no longer waits forever after a trigger failed to load or a lightweight body could not be fetched
* Outgoing size check counts bytes, not characters (non-ASCII snapshots)
* A failed success POST in `runService` is no longer re-sent as an `error` result

## 2.7.9 (August 27, 2026)

* Fix double-stringifying of string bodies in lightweight message emission — if `body` or passthrough body was already a string, `JSON.stringify` would wrap it in extra quotes ([#226](https://github.com/elasticio/sailor-nodejs/issues/226))
* Update package dependencies

## 2.7.8 (February 4, 2026)

* Ensure connection before ack/nack of the message
[#7855](https://github.com/elasticio/elasticio/issues/7855)

## 2.7.7 (November 19, 2025)

* Improve handling of cases when connection to RabbitMQ is re-established.
[#7855](https://github.com/elasticio/elasticio/issues/7855)

## 2.7.6 (August 1, 2025)

* Updated `elasticio-rest-node` to version 2.0.0 to address a vulnerability
* Removed `request` related libraries from main dependencies

## 2.7.5 (March 21, 2025)

* @elastic.io/maester-client updated to 6.0.0 to get rid of the vulnerability

## 2.7.4 (November 14, 2024)

* Fixed error location if component use `Rebound` functionality

## 2.7.3 (September 12, 2024)

* @elastic.io/maester-client updated to 5.0.3 to get rid of the vulnerability

## 2.7.2 (March 22, 2024)

* @elastic.io/maester-client updated to 5.0.2 ([#206](https://github.com/elasticio/sailor-nodejs/issues/206))

## 2.7.1  (October 20, 2022)

* Replaced `object-storage-client` with `maester-client`

## 2.7.0 (September 15, 2022)

* Add AMQP_PERSISTENT_MESSAGES configuration env var to enable persistent delivery mode.

## 2.6.29 (July 14, 2022)

* Enabled keep-alive for global HTTPS agent ([#6359](https://github.com/elasticio/elasticio/issues/6359))

## 2.6.28 (June 21, 2022)

* Fix: "sailor-nodejs ignores errors from maester during lightweight message upload" [#6233](https://github.com/elasticio/elasticio/issues/6233))

## 2.6.27 (March 10, 2022)

* Added npm audit to CI and fixed all dependencies

## 2.6.26 (June 24, 2021)

* Replaced exit on "unhandledRejection" with error logging

## 2.6.25 (June 17, 2021)

* Improve consume performance by switching back to pushing instead of polling, keeping reconnections mechanism
  ([#5432](https://github.com/elasticio/elasticio/issues/5432))

## 2.6.24 (January 27, 2021)

* Fix "Big messages processing is not stable" errors ([#5051](https://github.com/elasticio/elasticio/issues/5051))

## 2.6.23 (January 4, 2021)

* Fix "Cannot read property 'publish' of undefined" error ([#5036](https://github.com/elasticio/elasticio/issues/5036))

## 2.6.22 (December 23, 2020)

* Enabled keep-alive for global HTTP agent ([#5012](#https://github.com/elasticio/elasticio/issues/5012))

## 2.6.21 (December 3, 2020)

* Fixed rebound message expiry time ([#4950](https://github.com/elasticio/elasticio/issues/4950))

## 2.6.20 (December 1, 2020)

* Fixed rebound message headers ([#4950](https://github.com/elasticio/elasticio/issues/4950))

## 2.6.19 (November 23, 2020)

* Separate connections for consuming and publishing
* Consuming is done with polling instead of pushing
* Reconnects on connection errors
* Handling consumer cancel notification
* Lowered log levels of some developers' log messages
* Addded env vars:
    * AMQP_RECONNECT_ATTEMPTS - number of retries on connection close
    * AMQP_RECONNECT_TIMEOUT - delay between connection retries
    * WAIT_MESSAGES_TIMEOUT - delay between next poll when queue is empty

## 2.6.18 (October 26, 2020)

* Remove the logging of triggers and actions processing errors stack

## 2.6.17 (October 15, 2020)

* Annual audit of the component code to check if it exposes a sensitive data in the logs

## 2.6.16 (October 12, 2020)

* Fix incoming headers appearance in the logs (part 2)

## 2.6.15 (October 12, 2020)

* Fix incoming headers appearance in the logs (part 1)

## 2.6.14 (July 06, 2020)

* Add Lightweight messages support
* Sync this.emit() calls are not supported anymore. Use async process() interface and await this.emit() calls instead

## 2.6.13 (July 01, 2020)

* Error as incoming message in custom error handler

## 2.6.10 (June 03, 2020)

* Fix bug with incorrect publish retry policy.Dynamic flow control
* Dynamic flow control

## 2.6.9 (May 26, 2020)

* Fix bugs with 'Retention policy' notification and 'Nodejs sailor return promise interface does not support dynamic flow control'

## 2.6.8 (May 18, 2020)

* Fix bug when Lookout throws exception if incoming message from error queue doesn't have errorInput property
* From now on errors (description + stack) happening during component initialization won't be ignored and you will see them on frontend and in logs

## 2.6.7 (May 07, 2020)

* Add ability to publish to arbitrary exchange

## 2.6.6 (May 06, 2020)

* From now on Wiper will not suspend overloaded flows if all the components in the flow have the latest sailor (which supports dynamic flow control)

## 2.6.5 (February 20, 2020)

* Add support of non-base64 message in Admiral. This function is activated if 2 neighbour components' Sailors support a feature of non-base64 message

## 2.6.4 (February 14, 2020)

* Enable graceful restart for tasks pods

## 2.6.2 (January 29, 2020)

* Fix bug when Sailor does not reliably publish large messages

## 2.6.1 (January 15, 2020)

* Fix bug when publishing fail leads to fail in all subsequent pending messages

## 2.6.0 (January 06, 2020)

* A step must not put its own output message into the passthrough object

## 2.5.4 (December 23, 2019)

* Introduce new environment variable for Sailor: ELASTICIO_OUTGOING_MESSAGE_SIZE_LIMIT, which controls the outgoing message size limit

## 2.5.3 (December 11, 2019)

* Introduce new component environment variable ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS. It contains comma-separated environment variables that will be passed to message headers

## 2.4.1 (July 18, 2019)

* Add additional information to RabbitMQ messages

## 2.4.0 (June 11, 2019)

* Add elastic's Threads functionality support
* Add component custom logger. E.g. `this.logger.info('hello')`

## 2.3.0 (October 19, 2018)

* Sailor now handles RabbitMQ disconnects correctly

