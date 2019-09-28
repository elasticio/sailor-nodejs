exports.process = function processTrigger(msg) {
    this.emit('data', msg);
    this.emit('end');
};
