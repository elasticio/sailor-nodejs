module.exports = verify;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verify(credentials, cb) {
  await sleep(100);
  this.emit('error', 'Error emitted!!');
  return cb(null, { verified: true });
};
