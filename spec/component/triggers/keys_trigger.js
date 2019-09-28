exports.process = function processTrigger() {
    this.emit('updateKeys', { oauth: { access_token: 'newAccessToken' } });
    this.emit('end');
};
