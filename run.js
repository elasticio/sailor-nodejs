var settings = require('./lib/settings.js').initSailor(process.env);
var logging = require('./lib/logging.js');
var Sailor = require('./lib/sailor.js').Sailor;

var sailor = new Sailor();

sailor.connect()
    .then(sailor.run.bind(sailor))
    .fail(logging.criticalError)
    .done();

process.on('SIGTERM', function() {
    sailor.disconnect();
});

process.on('uncaughtException', logging.criticalError);
