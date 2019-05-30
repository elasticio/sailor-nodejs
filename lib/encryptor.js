var cipher = require('./cipher.js');
var Readable = require('stream').Readable;
var zlib = require('zlib');
var getStream = require('get-stream');

exports.encryptMessageContent = encryptMessageContent;
exports.decryptMessageContent = decryptMessageContent;
exports.encryptMessageContentStream = encryptMessageContentStream;
exports.decryptMessageContentStream = decryptMessageContentStream;

function encryptMessageContent(messagePayload) {
    return cipher.encrypt(JSON.stringify(messagePayload));
}

function decryptMessageContent(messagePayload) {
    if (!messagePayload || messagePayload.toString().length === 0) {
        return null;
    }
    try {
        return JSON.parse(cipher.decrypt(messagePayload.toString()));
    } catch (err) {
        console.error(err.stack);
        throw Error('Failed to decrypt message: ' + err.message);
    }
}

function encryptMessageContentStream(data) {
    const dataStream = new Readable;
    dataStream.push(JSON.stringify(data));
    dataStream.push(null);
    return dataStream
        .pipe(zlib.createGzip())
        .pipe(cipher.encryptStream());
}

async function decryptMessageContentStream(stream) {
    const s = stream.pipe(cipher.decryptStream()).pipe(zlib.createGunzip());
    const content = await getStream(s);

    return JSON.parse(content);
}
