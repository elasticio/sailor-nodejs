exports.process = processTrigger;

function processTrigger(msg, cfg) {
  const that = this;
  that.emit('data', { items: [1, 2, 3, 4, 5, 6] });
  that.emit('end');
}
