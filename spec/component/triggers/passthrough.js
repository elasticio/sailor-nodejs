exports.process = processTrigger;

function processTrigger(msg, cfg) {
  const that = this;
  that.emit('data', msg);
  that.emit('end');
}
