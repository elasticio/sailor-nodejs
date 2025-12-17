function getJitteredDelay(baseDelay, jitterFactor) {
    const minJitter = baseDelay * -jitterFactor;
    const maxJitter = baseDelay * jitterFactor;
    const jitter = Math.random() * (maxJitter - minJitter) + minJitter;
    return baseDelay + jitter;
}

module.exports.getJitteredDelay = getJitteredDelay;
