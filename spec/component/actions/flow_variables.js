exports.process = function processTrigger() {
    this.emit('data', { body: this.getFlowVariables() });
    this.emit('end');
};
