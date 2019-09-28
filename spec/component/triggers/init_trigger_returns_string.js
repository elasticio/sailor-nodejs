exports.init = function initTrigger() {
    return 'this_is_a_string';
};

exports.process = function processTrigger() {
    this.emit('data', {
        body: {}
    });
    this.emit('end');
};
