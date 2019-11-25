exports.process = processTrigger;

function processTrigger(msg, cfg) {
  const that = this;
  that.emit('updateKeys', { oauth: { access_token: 'newAccessToken' } });
  that.emit('end');
}
