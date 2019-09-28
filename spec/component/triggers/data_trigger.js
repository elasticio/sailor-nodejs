exports.process = function processTrigger() {
    this.emit('data', { items: [1, 2, 3, 4, 5, 6] });
    this.emit('end');
};
