exports.init = function initTrigger() {
    return Promise.resolve({
        subscriptionId: '_subscription_123'
    });
};

exports.process = function processTrigger() {
    this.emit('data', {
        body: {}
    });
    this.emit('end');
};
