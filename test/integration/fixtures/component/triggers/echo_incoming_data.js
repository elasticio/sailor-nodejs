exports.process = handleMessage;

function handleMessage(msg, cfg, snapshot) {
    console.log('echo_incoming_data');
    // eslint-disable-next-line no-invalid-this
    this.emit('data', {
        headers: {
            'x-custom-component-header': '123_abc'
        },
        body: {
            msg,
            cfg,
            snapshot
        }
    });
    this.emit('end');
}
