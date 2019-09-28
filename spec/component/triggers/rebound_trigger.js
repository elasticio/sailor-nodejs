exports.process = function processTrigger() {
    this.emit('rebound', new Error('Rebound reason'));
    this.emit('end');
};
