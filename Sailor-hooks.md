## Sailor hooks

### Init hook

### Startup hook

- Only on the first trigger
- Called without ``this``
- May return promise
- May return value
- May throw - not recommended
- May return a promise that will fail

- TBD - Startup logs, where to find it?
- TBD - Separate them under different tab in UI
- TBD - Where to see restart errors?overwritten

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

 - Only on the first trigger
 - One stop is pressed
    - If task is running then containers are shutdown
    - If task is sleeping then do nothing
 - Start new trigger container
 - Trigger starts without ``this`` context - it's not possible to log errors or send new data
 - Should either return value (ignored) or promise (resolved).
 - Startup data is removed after shutdown hook
 - Call the shutdown hook, parameters that are passed is from the startup results or ``{}`` if nothing was returned
 - Errors are ignored
 - If shutdown hook won't complete within 60 seconds then container will be killed
 - As soon as user pressed stop, task is marked as inactive and hooks will start responding with the error to possible data

TBD - log for shutdown hooks?
