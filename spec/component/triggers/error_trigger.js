exports.process = function processTrigger() {
    this.emit('error', new Error('Some component error'));
    this.emit('end');
};
