exports.process = processTrigger;

async function processTrigger(msg, cfg) {
    const msgSize = msg.body.result.length;
    this.logger.info(`Message size: ${msgSize}`);
    const body = { result: 'Hello world!' };

    if (msg.passthrough.step_2.body.results[0].To === 'Hello world!') {
        throw new Error('Whoooooops!');
    };

    await this.emit('data', { body });
    this.logger.info('Execution finished');
    // var that = this;
    // // await new Promise(resolve => setTimeout(resolve, 120000));
    // // await that.emit('data', { body: { items: [1, 2, 3, 4, 5, 6] } });
    // await that.emit('data', { body: 'a'.repeat(224288), headers: { testHeader: 'headerValue' } });
    // await that.emit('end');
}
