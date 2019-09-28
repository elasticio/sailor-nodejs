exports.process = function processTrigger() {
    return Promise.resolve({
        body: 'I am a simple promise'
    });
};
