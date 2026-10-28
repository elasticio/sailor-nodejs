exports.process = processTrigger;

function processTrigger(msg, cfg) {
    var that = this;
    var ndjsonBody = '{"id":1,"name":"Entity 1"}\n{"id":2,"name":"Entity 2"}\n{"id":3,"name":"Entity 3"}';
    that.emit('data', { body: ndjsonBody });
    that.emit('end');
}
