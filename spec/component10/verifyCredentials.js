module.exports = verify;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function verify(credentials, cb) {
    await sleep(100);
    cb(null, { verified: true });
    return;
}
