exports.process = processTrigger;

function processTrigger(msg, cfg) {
  const that = this;

  that.emit('error', new Error('Some component error'));
  that.emit('end');
}
