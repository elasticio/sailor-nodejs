function process() {
    this.emit('data', {
        id: 'f45be600-f770-11e6-b42d-b187bfbf19fd',
        headers: {
            'x-custom-component-header': '123_abc'
        },
        body: {
            id: 'someId',
            hai: 'there'
        }
    });
}

exports.process = process;

