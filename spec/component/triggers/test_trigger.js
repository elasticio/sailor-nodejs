exports.process = function processTrigger() {
    this.emit('data', 'Data 1');
    this.emit('data', { content: 'Data 2' });
    this.emit('data');

    this.emit('error', 'Error 1');
    this.emit('error', new Error('Error 2'));
    this.emit('error');

    this.emit('rebound', 'Rebound Error 1');
    this.emit('rebound', new Error('Rebound Error 2'));
    this.emit('rebound');

    this.emit('end');
};
