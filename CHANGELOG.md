## 2.7.5 (March 14, 2025)

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

