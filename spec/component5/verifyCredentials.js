module.exports = function verify() {
    return Promise.reject(new Error('Your API key is invalid'));
};
