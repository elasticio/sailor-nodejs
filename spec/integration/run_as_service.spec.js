const testPack = require('./integration_tests_pack.js');
const MultiApp = require('../../lib/MultiApp.js');
describe('Component as service integration tests', () => {
    testPack(() => new MultiApp(), false);
});
