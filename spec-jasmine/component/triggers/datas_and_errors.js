exports.process = processTrigger;

function processTrigger (msg, cfg) {
    this.emit('data', { content: 'Data 1' });
    this.emit('error', new Error('Error 1'));

    return new Promise(resolve => {
        setTimeout(() => {
            this.emit('data', { content: 'Data 2' });
            this.emit('error', new Error('Error 2'));
            this.emit('data', { content: 'Data 3' });
            resolve();
        }, 1000);
    });
}
