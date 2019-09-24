const { expect } = require('chai');
const ComponentReader = require('../../lib/component_reader.js').ComponentReader;
const { ComponentLogger } = require('../../lib/logging.js');

describe('Component reader', () => {
    let logger;
    let reader;
    beforeEach(() => {
        logger = new ComponentLogger({ get: () => undefined }, {});
        reader = new ComponentReader(logger);
    });
    it('Should find component located on the path', async () => {
        await reader.init('/spec/component/');
        expect(reader.componentJson.title).to.equal('Client component');
    });

    it('Should find component trigger', async () => {
        await reader.init('/spec/component/');
        const filename = await reader._findTriggerOrAction('passthrough');

        expect(reader.componentJson.title).to.equal('Client component');
        expect(filename).contains('triggers/passthrough.js');
    });

    it('Should return error if trigger not found', async () => {
        await reader.init('/spec/component/');
        let caughtError;
        try {
            await reader._findTriggerOrAction('some-missing-component');
        } catch (e) {
            caughtError = e;
        }

        expect(caughtError.message).to.equal(
            'Trigger or action "some-missing-component" is not found in component.json!'
        );
    });

    it('Should return appropriate error if trigger file is missing', async () => {
        await reader.init('/spec/component/');

        let caughtError;
        try {
            await reader.loadTriggerOrAction('missing_trigger');
        } catch (e) {
            caughtError = e;
        }
        expect(caughtError.message).match(
            //eslint-disable-next-line no-useless-escape
            /Failed to load file \'.\/triggers\/missing_trigger.js\': Cannot find module.+missing_trigger\.js/
        );
        expect(caughtError.code).to.equal('MODULE_NOT_FOUND');
    });

    it('Should return appropriate error if missing dependency is required by module', async () => {
        await reader.init('/spec/component/');

        let caughtError;
        try {
            await reader.loadTriggerOrAction('trigger_with_wrong_dependency');
        } catch (e) {
            caughtError = e;
        }

        expect(caughtError.message).to.equal(
            'Failed to load file \'./triggers/trigger_with_wrong_dependency.js\': '
            + 'Cannot find module \'../not-found-dependency\''
        );
        expect(caughtError.code).to.equal('MODULE_NOT_FOUND');
    });

    it('Should return appropriate error if trigger file is presented, but contains syntax error', async () => {
        await reader.init('/spec/component/');

        let caughtError;
        try {
            await reader.loadTriggerOrAction('syntax_error_trigger');
        } catch (e) {
            caughtError = e;
        }

        expect(caughtError.message).to.equal(
            "Trigger or action 'syntax_error_trigger' is found, but can not be loaded. "
            + "Please check if the file './triggers/syntax_error_trigger.js' is correct."
        );
    });

    it('Should return error if trigger not initialized', async () => {
        let caughtError;
        try {
            await reader._findTriggerOrAction('some-missing-component');
        } catch (err) {
            caughtError = err;
        }
        expect(caughtError.message).to.equal('Component.json was not loaded');
    });
});
