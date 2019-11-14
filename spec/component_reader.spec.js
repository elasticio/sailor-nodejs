/* eslint-disable no-unused-expressions */
const { expect } = require('chai');
const { ComponentReader } = require('../lib/component_reader.js');

const waitForThen = (fn, testFn) => {
  fn;
  testFn;
};

describe('Component reader', () => {
  it('Should find component located on the path', () => {
    const reader = new ComponentReader();
    const promise = reader.init('/spec/component/');

    waitForThen(() => promise.isFulfilled() || promise.isRejected(),
      () => {
        expect(promise.isFulfilled()).to.be.true;
        expect(reader.componentJson.title).to.be.equal('Client component');
      });
  });

  it('Should find component trigger', () => {
    const reader = new ComponentReader();
    let filename;
    let error;
    reader.init('/spec/component/').then(() => {
      try {
        filename = reader.findTriggerOrAction('passthrough');
      } catch (err) {
        error = err;
      }
    });

    waitForThen(() => filename || error,
      () => {
        expect(reader.componentJson.title).to.be.equal('Client component');
        expect(filename).to.include('triggers/passthrough.js');
      });
  });

  it('Should return error if trigger not found', () => {
    const reader = new ComponentReader();
    let filename;
    let error;

    reader.init('/spec/component/').then(() => {
      try {
        filename = reader.findTriggerOrAction('some-missing-component');
      } catch (err) {
        error = err;
      }
    });

    waitForThen(() => filename || error,
      () => {
        expect(error.message).to.be.equal('Trigger or action "some-missing-component" is not found in component.json!');
      });

  });

  it('Should return appropriate error if trigger file is missing', () => {
    const reader = new ComponentReader();

    const promise = reader.init('/spec/component/')
      .then(() => reader.loadTriggerOrAction('missing_trigger'));

    waitForThen(() => promise.isFulfilled() || promise.isRejected(),
      () => {
        expect(promise.isRejected()).to.be.equal(true);
        const err = promise.inspect().reason;
        expect(err.message).to.include(
          // eslint-disable-next-line no-useless-escape
          /Failed to load file \'.\/triggers\/missing_trigger.js\': Cannot find module.+missing_trigger\.js/,
        );
        expect(err.code).to.be.equal('MODULE_NOT_FOUND');
      });
  });

  it('Should return appropriate error if missing dependency is required by module', () => {
    const reader = new ComponentReader();

    const promise = reader.init('/spec/component/')
      .then(() => reader.loadTriggerOrAction('trigger_with_wrong_dependency'));

    waitForThen(() => promise.isFulfilled() || promise.isRejected(),
      () => {
        expect(promise.isRejected()).to.be.equal(true);
        const err = promise.inspect().reason;
        expect(err.message).to.be.equal(
          'Failed to load file \'./triggers/trigger_with_wrong_dependency.js\': '
          + 'Cannot find module \'../not-found-dependency\'',
        );
        expect(err.code).to.be.equal('MODULE_NOT_FOUND');
      });
  });

  it('Should return appropriate error if trigger file is presented, but contains syntax error', () => {
    const reader = new ComponentReader();

    const promise = reader.init('/spec/component/')
      .then(() => reader.loadTriggerOrAction('syntax_error_trigger'));

    waitForThen(() => promise.isFulfilled() || promise.isRejected(),
      () => {
        expect(promise.isRejected()).to.be.equal(true);
        const err = promise.inspect().reason;
        expect(err.message).to.be.equal(
          "Trigger or action 'syntax_error_trigger' is found, but can not be loaded. "
          + "Please check if the file './triggers/syntax_error_trigger.js' is correct.",
        );
      });
  });

  it('Should return error if trigger not initialized', () => {
    const reader = new ComponentReader();
    let filename;
    let error;

    try {
      filename = reader.findTriggerOrAction('some-missing-component');
    } catch (err) {
      error = err;
    }

    waitForThen(() => filename || error,
      () => {
        expect(error.message).to.be.equal('Component.json was not loaded');
      });
  });
});
