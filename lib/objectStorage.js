const encryptor = require('./encryptor.js');
const uuid = require('uuid');
const axios = require('axios');
const http = require('http');
const https = require('https');

class ObjectStorage {
    constructor(settings) {
        this.api = axios.create({
            baseURL: `${settings.OBJECT_STORAGE_URI}/`,
            httpAgent: new http.Agent({ keepAlive: true }),
            httpsAgent: new https.Agent({ keepAlive: true }),
            headers: { Authorization: `Bearer ${settings.OBJECT_STORAGE_TOKEN}` },
            validateStatus: null
        });
    }

    async requestRetry({ maxAttempts, delay, request, onResponse }) {
        let attempts = 0;
        let res;
        let err;
        while (attempts < maxAttempts) {
            err = null;
            res = null;
            attempts++;
            try {
                res = await request();
            } catch (e) {
                err = e;
            }
            if (onResponse && onResponse(err, res)) {
                continue;
            }
            if (err || res.status >= 400) {
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            break;
        }
        if (err || res.status >= 400) {
            throw err || new Error(`HTTP error during object get: ${res.status} (${res.statusText})`);
        }
        return res;
    }

    async getObject(objectId) {
        const res = await this.requestRetry({
            maxAttempts: 3,
            delay: 100,
            request: () => this.api.get(`/objects/${objectId}`, { responseType: 'stream' })
        });

        return await encryptor.decryptMessageContentStream(res.data);
    }

    async addObject(data) {
        let objectId = uuid.v4();
        await this.requestRetry({
            maxAttempts: 3,
            delay: 100,
            request: () => this.api.put(
                `/objects/${objectId}`,
                encryptor.encryptMessageContentStream(data),
                { headers: { 'content-type': 'application/octet-stream' } }
            ),
            onResponse: (err, res) => {
                if (!err && res.status === 409) {
                    objectId = uuid.v4();
                    return true;
                }
            }
        });

        return objectId;
    }
}

module.exports = ObjectStorage;
