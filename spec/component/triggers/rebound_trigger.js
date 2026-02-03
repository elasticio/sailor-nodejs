exports.process = processTrigger;

async function processTrigger(msg, cfg) {
    var that = this;
    await that.emit('error', new Error('Rebound reason'));
    await that.emit('end');
}
