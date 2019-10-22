module.exports = verify;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function verify(credentials, callback) {
    await sleep(100);
    callback(null, {
        verified: true
    });
}
