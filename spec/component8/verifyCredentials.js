module.exports = verify;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function verify(credentials, cb) {
    try {
        await sleep(100);
        const q = true;
        if (q) {throw new Error("Verification failed :(")};
        return cb(null, { verified: true });
    } catch (e) {
        // should do this
        return cb(e, { verified: false });
    }
    
}
