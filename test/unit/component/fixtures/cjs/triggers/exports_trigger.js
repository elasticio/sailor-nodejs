let calls = 0;
exports.process = function process() {
    calls += 1;
    return calls;
};
