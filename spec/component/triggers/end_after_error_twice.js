exports.process = function processTrigger() {
    this.emit('error', new Error('Some error occurred!'));
    this.emit('end');
    this.emit('end');
};
