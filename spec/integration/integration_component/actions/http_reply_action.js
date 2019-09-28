exports.process = function processAction() {
    this.emit('httpReply', {
        statusCode: 200,
        body: 'Ok',
        headers: {
            'content-type': 'text/plain'
        }
    });
    this.emit('end');
};
