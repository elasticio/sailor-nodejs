exports.process = processTrigger;

async function processTrigger(msg, cfg) {
    var that = this;
    await that.emit('rebound', new Error('Rebound reason'));
    await that.emit('end');
}
