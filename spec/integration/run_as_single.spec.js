const testPack = require('./integration_tests_pack.js');
const SingleApp = require('../../lib/SingleApp.js');
describe('Single sailor mode integration tests', () => {
    testPack(() => new SingleApp());
});
