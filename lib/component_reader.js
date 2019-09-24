const path = require('path');
const fs = require('fs');
const util = require('util');
const _ = require('lodash');

class ComponentReader {
    constructor(logger) {
        this._logger = logger;
        this.componentPath = null;
        this.componentJson = null;
    }

    async init(componentPath) {
        this.componentPath = path.join(process.cwd(), componentPath || '');
        this._logger.debug('Component path is: %s', this.componentPath);
        try {
            const dirContent = await util.promisify(fs.readdir.bind(fs))(this.componentPath);
            this._loger.trace('Root files: %j', dirContent);
        } catch (e) {
            // skip intentionally. Don't make debug mechanism to kill everything around
        }

        const componentJsonPath = path.join(this.componentPath, 'component.json');
        return this._promiseLoadJson(componentJsonPath);
    }

    async _promiseLoadJson(jsonFilePath) {
        try {
            this.componentJson = require(jsonFilePath);
            this._logger.debug('Successfully loaded %s', jsonFilePath);
            this._logger.debug('Triggers: %j', _.keys(this.componentJson.triggers));
            this._logger.debug('Actions: %j', _.keys(this.componentJson.actions));
        } catch (err) {
            throw new Error('Failed to load component.json from ' + this.componentPath);
        }
    }

    _findTriggerOrAction(name) {
        if (this.componentJson === null) {
            throw new Error('Component.json was not loaded');
        }

        if (this.componentJson.triggers && this.componentJson.triggers[name]) {
            return this.componentJson.triggers[name].main;
        } else if (this.componentJson.actions && this.componentJson.actions[name]) {
            return this.componentJson.actions[name].main;
        } else {
            throw new Error('Trigger or action "' + name + '" is not found in component.json!');
        }
    }

    async loadTriggerOrAction(name) {
        let filename;
        let modulePath;

        try {
            filename = this._findTriggerOrAction(name);
            modulePath = path.join(this.componentPath, filename);
        } catch (err) {
            this._logger.trace(err);
            throw err;
        }

        try {
            this._logger.trace('Trying to find module at: %s', modulePath);
            return require(modulePath);
        } catch (err) {
            let message;

            if (err.code === 'MODULE_NOT_FOUND') {
                message = 'Failed to load file \'%s\': %s';
                err.message = util.format(message, filename, err.message);
            } else {
                message = 'Trigger or action \'%s\' is found, but can not be loaded. '
                    + 'Please check if the file \'%s\' is correct.';
                err.message = util.format(message, name, filename);
            }

            this._logger.trace(err);
            throw err;
        }
    }

    async loadVerifyCredentials() {

        try {
            const modulePath = path.join(this.componentPath, 'verifyCredentials');
            this._logger.trace('Trying to find verifyCredentials.js at: %s', modulePath);
            return require(modulePath);
        } catch (err) {
            this._logger.trace(err);
            return (cfg, cb) => cb(null, { verified: true });
        }
    }
}

exports.ComponentReader = ComponentReader;
