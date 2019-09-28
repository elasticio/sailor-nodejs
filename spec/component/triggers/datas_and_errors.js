exports.process = function processTrigger() {
    this.emit('data', { content: 'Data 1' });
    this.emit('error', new Error('Error 1'));

    setTimeout(() => {
        this.emit('data', { content: 'Data 2' });
        this.emit('error', new Error('Error 2'));
        this.emit('data', { content: 'Data 3' });
    }, 1000);
};
