exports.process = processTrigger;

async function processTrigger(msg, cfg) {
    var that = this;
    // await new Promise(resolve => setTimeout(resolve, 10000));
    // await that.emit('data', { body: { items: [1, 2, 3, 4, 5, 6] } });
    await that.emit('data', { body: 'a'.repeat(10485761), headers: { testHeader: 'headerValue' } });
    await that.emit('end');
}
