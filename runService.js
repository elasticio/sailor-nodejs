var logging = require('./lib/logging');
var service = require('./lib/service');
require('./lib/settings').init(process.env);

var serviceMethod = process.argv[2];

service.processService(serviceMethod)
    .catch(logging.criticalError)
    .done();

process.on('uncaughtException', logging.criticalError);
