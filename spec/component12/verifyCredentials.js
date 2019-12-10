const request = require('request');

module.exports = function verify(cfg, callback) {
  request('http://my-url-to-check-credentials', (error, body) => {
    if (!error && everything_is_ok_with_body) {
      callback(null, body);
    } else {
      callback(new Error('smth bad happened'));
    }
  });
}