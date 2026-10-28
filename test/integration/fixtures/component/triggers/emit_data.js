'use strict';

exports.process = process;

function process(msg, cfg, snapshot) {
    // eslint-disable-next-line no-invalid-this
    this.emit('data', {
        headers: {
            'x-custom-component-header': '123_abc'
        },
        body: {
            id: 'someId',
            hai: 'there'
        }
    });
    // eslint-disable-next-line no-invalid-this
    this.emit('end');
}
