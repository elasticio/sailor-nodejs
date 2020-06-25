exports.process = processTrigger;

function processTrigger(msg, cfg) {
    var that = this;
    that.emit('data', { body: { items: [1,2,3,4,5,6] } });
    that.emit('end');
}
