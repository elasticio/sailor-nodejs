module.exports = verify;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function verify(credentials, cb) {
    try {
        await sleep(100);
        throw new Error('Verification failed :(');
    } catch (e) {
        // should do this
        return cb(e, { verified: false });
    }
}
