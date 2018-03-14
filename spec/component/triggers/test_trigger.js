exports.process = processTrigger;

function processTrigger(msg, cfg) {
    var that = this;

    that.emit('data', 'Data 1');
    that.emit('data', { content: 'Data 2' });
    that.emit('data');


    that.emit('error', 'Error 1');
    that.emit('error', new Error('Error 2'));
    that.emit('error');

    that.emit('rebound', 'Rebound Error 1');
    that.emit('rebound', new Error('Rebound Error 2'));
    that.emit('rebound');

    that.emit('end');
}
