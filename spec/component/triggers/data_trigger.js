exports.process = processTrigger;

async function processTrigger(msg, cfg) {
    var that = this;
    await that.emit('data', { body: { items: [1, 2, 3, 4, 5, 6] } });
    await that.emit('end');
}
