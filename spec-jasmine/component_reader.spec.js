const ComponentReader = require('../src/component_reader.js').ComponentReader;

describe('Component reader', async () => {
    it('Should find component located on the path', async () => {
        let reader = new ComponentReader();
        await reader.init('/spec-jasmine/component/');

        expect(reader.componentJson.title).toEqual('Client component');
    });

    it('Should find component trigger', async () => {
        let reader = new ComponentReader();
        let filename;

        await reader.init('/spec-jasmine/component/');
        try {
            filename = reader.findTriggerOrAction('passthrough');
        } catch (e) {
            throw e;
        }

        expect(reader.componentJson.title).toEqual('Client component');
        expect(filename).toContain('triggers/passthrough.js');
    });

    it('Should return error if trigger not found', async () => {
        let reader = new ComponentReader();
        let error;

        await reader.init('/spec-jasmine/component/');
        try {
            reader.findTriggerOrAction('some-missing-component');
        } catch (err) {
            error = err;
        }

        expect(error.message).toEqual('Trigger or action "some-missing-component" is not found in component.json!');
    });

    it('Should return appropriate error if trigger file is missing', async () => {
        let reader = new ComponentReader();

        try {
            await reader.init('/spec-jasmine/component/');
            await reader.loadTriggerOrAction('missing_trigger');
        } catch (err) {
            expect(err.message).toMatch(/Failed to load file '.\/triggers\/missing_trigger.js': Cannot find module.+missing_trigger\.js/);
            expect(err.code).toEqual('MODULE_NOT_FOUND');
        }
    });

    it('Should return appropriate error if missing dependency is required by module', async () => {
        let reader = new ComponentReader();

        try {
            await reader.init('/spec-jasmine/component/');
            await reader.loadTriggerOrAction('trigger_with_wrong_dependency');
        } catch (err) {
            expect(err.message).toEqual(
                'Failed to load file \'./triggers/trigger_with_wrong_dependency.js\': ' +
                'Cannot find module \'../not-found-dependency\''
            );
            expect(err.code).toEqual('MODULE_NOT_FOUND');
        }
    });

    it('Should return appropriate error if trigger file is presented, but contains syntax error', async () => {
        let reader = new ComponentReader();

        try {
            await reader.init('/spec-jasmine/component/');
            await reader.loadTriggerOrAction('syntax_error_trigger');
        } catch (err) {
            expect(err.message).toEqual(
                "Trigger or action 'syntax_error_trigger' is found, but can not be loaded. " +
                "Please check if the file './triggers/syntax_error_trigger.js' is correct."
            );
        }
    });

    it('Should return error if trigger not initialized', async () => {
        let reader = new ComponentReader();

        try {
            reader.findTriggerOrAction('some-missing-component');
        } catch (err) {
            expect(err.message).toEqual('Component.json was not loaded');
        }
    });
});
