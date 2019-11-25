exports.process = processTrigger;

function processTrigger(msg, cfg) {
  const that = this;
  that.emit('rebound', new Error('Rebound reason'));
  that.emit('end');
}
