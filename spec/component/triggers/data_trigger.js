exports.process = processTrigger;

async function processTrigger(msg, cfg) {
    var that = this;
    //that.emit('data', { body: { items: [1,2,3,4,5,6] } });
    await that.emit('data', { body: 'a'.repeat(1048576), headers: { testHeader: 'headerValue' } });
    await that.emit('end');
}
