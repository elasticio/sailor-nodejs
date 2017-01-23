exports.process = processTrigger;

function processTrigger(msg, cfg) {
    var that = this;
    that.emit('data', {
        headers: {
            "X-EIO-Flow-ID": "alternative-flow-id"
        },
        items: [1, 2, 3, 4, 5, 6]
    });
    that.emit('end');
}
