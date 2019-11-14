/* eslint-disable no-unused-expressions */
const nock = require('nock');
const sinon = require('sinon');
const chai = require('chai');
const sinonChai = require('sinon-chai');
const { TaskExec } = require('../lib/executor.js');

chai.use(sinonChai);
const { expect } = chai;

const waitForThen = (fn, testFn) => {
  fn;
  testFn;
};

describe('Executor', () => {
  const payload = { content: 'MessageContent' };
  const cfg = {};

  it('Should execute passthrough trigger and emit all events - data, end', () => {
    const taskexec = new TaskExec();

    taskexec.on('error', () => { });
    sinon.stub(taskexec, 'emit');

    const module = require('./component/triggers/passthrough.js');

    taskexec.process(module, payload, cfg);

    expect(taskexec.emit).to.have.been.called;
    expect(taskexec.emit.getCall(0).args[0]).to.be.equal('data');
    expect(taskexec.emit.getCall(1).args[0]).to.be.equal('end');
  });

  it('Should reject if module is missing', () => {
    const taskexec = new TaskExec();
    // eslint-disable-next-line no-empty-function
    taskexec.on('error', () => { });
    sinon.stub(taskexec, 'emit');

    taskexec.process({}, payload, cfg);

    expect(taskexec.emit).to.have.been.called;
    expect(taskexec.emit.getCall(0).args[0]).to.be.equal('error');
    expect(taskexec.emit.getCall(0).args[1].message).to.be.equal('Process function is not found');
    expect(taskexec.emit.getCall(1).args[0]).to.be.equal('end');
  });

  it('Should execute rebound_trigger and emit all events - rebound, end', () => {
    const taskexec = new TaskExec();
    // eslint-disable-next-line no-empty-function
    taskexec.on('error', () => { });
    sinon.stub(taskexec, 'emit');

    const module = require('./component/triggers/rebound_trigger.js');

    taskexec.process(module, payload, cfg);
    expect(taskexec.emit).to.have.been.called;
    expect(taskexec.emit.getCall(0).args[0]).to.be.equal('rebound');
    expect(taskexec.emit.getCall(1).args[0]).to.be.equal('end');
  });

  it('Should execute complex trigger, and emit all 6 events', async () => {
    const taskexec = new TaskExec();
    // eslint-disable-next-line no-empty-function
    taskexec.on('error', () => { });
    sinon.stub(taskexec, 'emit');

    const module = require('./component/triggers/datas_and_errors.js');

    taskexec.process(module, payload, cfg);

    waitForThen(() => taskexec.emit.callCount < 5,
      () => {
        expect(taskexec.emit).to.have.been.called;
        expect(taskexec.emit.callCount).to.be.equal(6);
        expect(taskexec.emit.getCall(0).args[0]).to.be.equal('data');
        expect(taskexec.emit.getCall(0).args[1]).to.be.deep.equal({ content: 'Data 1' });
        expect(taskexec.emit.getCall(1).args[0]).to.be.equal('error');
        expect(taskexec.emit.getCall(1).args[1].message).to.be.equal('Error 1');
        expect(taskexec.emit.getCall(2).args[0]).to.be.equal('data');
        expect(taskexec.emit.getCall(2).args[1]).to.be.deep.equal({ content: 'Data 2' });
        expect(taskexec.emit.getCall(3).args[0]).to.be.equal('error');
        expect(taskexec.emit.getCall(3).args[1].message).to.be.equal('Error 2');
        expect(taskexec.emit.getCall(4).args[0]).to.be.equal('data');
        expect(taskexec.emit.getCall(4).args[1]).to.be.deep.equal({ content: 'Data 3' });
      });
  });

  it('Should execute test_trigger and emit all events - 3 data events, 3 errors, 3 rebounds, 1 end', () => {
    const taskexec = new TaskExec();
    // eslint-disable-next-line no-empty-function
    taskexec.on('error', () => { });
    sinon.stub(taskexec, 'emit');

    const module = require('./component/triggers/test_trigger.js');
    taskexec.process(module, payload, cfg);

    waitForThen(() => taskexec.emit.callCount >= 9,
      () => {
        expect(taskexec.emit).to.have.been.called;
        expect(taskexec.emit.getCall(0).args).to.be.equal(['data', 'Data 1']);
        expect(taskexec.emit.getCall(1).args).to.be.equal(['data', { content: 'Data 2' }]);
        expect(taskexec.emit.getCall(2).args).to.be.equal(['data']);
        expect(taskexec.emit.getCall(3).args).to.be.equal(['error', 'Error 1']);
        expect(taskexec.emit.getCall(4).args).to.be.equal(['error', {}]);
        expect(taskexec.emit.getCall(5).args).to.be.equal(['error']);
        expect(taskexec.emit.getCall(6).args).to.be.equal(['rebound', 'Rebound Error 1']);
        expect(taskexec.emit.getCall(7).args).to.be.equal(['rebound', {}]);
        expect(taskexec.emit.getCall(8).args).to.be.equal(['rebound']);
        expect(taskexec.emit.getCall(9).args[0]).to.be.equal('end');
      });
  });

  describe('Promises', () => {
    it('Should execute a Promise trigger and emit all events - data, end', () => {
      const taskexec = new TaskExec();

      // eslint-disable-next-line no-empty-function
      taskexec.on('error', () => { });
      sinon.stub(taskexec, 'emit');

      const module = require('./component/triggers/promise_trigger.js');

      taskexec.process(module, payload, cfg);

      waitForThen(() => taskexec.emit.callCount > 1,
        () => {
          expect(taskexec.emit).to.have.been.called;
          expect(taskexec.emit.callCount).to.be.equal(2);
          expect(taskexec.emit.getCall(0).args[0]).to.be.equal('data');
          expect(taskexec.emit.getCall(0).args[1]).to.be.deep.equal({
            body: 'I am a simple promise',
          });
          expect(taskexec.emit.getCall(1).args[0]).to.be.equal('end');
        });
    });

    it('Should execute a Promise.resolve() trigger and emit end', () => {
      const taskexec = new TaskExec();

      taskexec.on('error', () => { });
      sinon.stub(taskexec, 'emit');

      const module = require('./component/triggers/promise_resolve_no_data.js');
      taskexec.process(module, payload, cfg);

      waitForThen(() => taskexec.emit.callCount > 0,
        () => {
          expect(taskexec.emit).to.have.been.called;
          expect(taskexec.emit.callCount).to.be.equal(1);
          expect(taskexec.emit.getCall(0).args[0]).to.be.equal('end');
        });
    });
  });

  describe('Request Promise', () => {
    beforeEach(() => {
      nock('http://promise_target_url:80')
        .get('/foo/bar')
        .reply(200, {
          message: 'Life is good with promises',
        });
    });

    it('Should execute a Promise trigger and emit all events - data, end', () => {
      const taskexec = new TaskExec();

      // eslint-disable-next-line no-empty-function
      taskexec.on('error', () => { });
      sinon.stub(taskexec, 'emit');

      const module = require('./component/triggers/promise_request_trigger.js');
      taskexec.process(module, payload, cfg);

      waitForThen(() => taskexec.emit.callCount > 1,
        () => {
          expect(taskexec.emit).to.have.been.called;
          expect(taskexec.emit.callCount).to.be.equal(2);
          expect(taskexec.emit.getCall(0).args[0]).to.be.equal('data');
          expect(taskexec.emit.getCall(0).args[1]).to.be.deep.equal({
            body: {
              message: 'Life is good with promises',
            },
          });
          expect(taskexec.emit.getCall(1).args[0]).to.be.equal('end');
        });
    });
  });

  describe('Request Generators', () => {
    it('Should execute a Promise trigger and emit all events - data, end', () => {
      nock('http://promise_target_url:80')
        .get('/foo/bar')
        .reply(200, {
          message: 'Life is good with generators',
        });


      const taskexec = new TaskExec();

      // eslint-disable-next-line no-empty-function
      taskexec.on('error', () => { });
      sinon.stub(taskexec, 'emit');

      const module = require('./component/triggers/generator_request_trigger.js');
      taskexec.process(module, payload, cfg);

      waitForThen(() => taskexec.emit.callCount > 1,
        () => {
          expect(taskexec.emit).to.have.been.called;
          expect(taskexec.emit.callCount).to.be.equal(2);
          expect(taskexec.emit.getCall(0).args[0]).to.be.equal('data');
          expect(taskexec.emit.getCall(0).args[1]).to.be.deep.equal({
            body: {
              message: 'Life is good with generators',
            },
          });
          expect(taskexec.emit.getCall(1).args[0]).to.be.equal('end');
        });
    });

    it('Should execute a Promise trigger and emit all events - data, end', () => {
      nock('https://login.acme')
        .post('/oauth2/v2.0/token', {
          client_id: 'admin',
          client_secret: 'secret',
        })
        .reply(200, {
          access_token: 'new_access_token',
        })
        .get('/oauth2/v2.0/contacts')
        .reply(200, {
          result: [
            {
              email: 'homer.simpson@acme.org',
            },
            {
              email: 'marge.simpson@acme.org',
            },
          ],
        });


      const taskexec = new TaskExec();

      // eslint-disable-next-line no-empty-function
      taskexec.on('error', () => { });
      sinon.stub(taskexec, 'emit');

      const module = require('./component/triggers/promise_emitting_events.js');

      taskexec.process(module, payload, cfg);

      waitForThen(() => taskexec.emit.callCount > 1,
        () => {
          expect(taskexec.emit).to.have.been.called;
          expect(taskexec.emit.callCount).to.be.equal(3);
          expect(taskexec.emit.getCall(0).args[0]).to.be.equal('updateKeys');
          expect(taskexec.emit.getCall(0).args[1]).to.be.deep.equal({
            oauth: {
              access_token: 'new_access_token',
            },
          });
          expect(taskexec.emit.getCall(1).args[0]).to.be.equal('data');
          expect(taskexec.emit.getCall(1).args[1]).to.be.deep.equal({
            body: {
              result: [
                {
                  email: 'homer.simpson@acme.org',
                },
                {
                  email: 'marge.simpson@acme.org',
                },
              ],
            },
          });
          expect(taskexec.emit.getCall(2).args[0]).to.be.equal('end');
        });
    });
  });

  describe('async process function', () => {
    it('should work', () => {
      const taskexec = new TaskExec();

      // eslint-disable-next-line no-empty-function
      taskexec.on('error', () => { });
      sinon.stub(taskexec, 'emit');

      const module = require('./component/triggers/async_process_function');

      taskexec.process(module, payload, cfg);

      waitForThen(() => taskexec.emit.callCount > 1,
        () => {
          expect(taskexec.emit).to.have.been.called;
          expect(taskexec.emit.callCount).to.be.equal(2);
          expect(taskexec.emit.getCall(0).args[0]).to.be.equal('data');
          expect(taskexec.emit.getCall(0).args[1]).to.be.equal({
            some: 'data',
          });
          expect(taskexec.emit.getCall(1).args[0]).to.be.equal('end');
        });
    });
  });

  describe('executor logger', () => {
    function TestStream() {
      this.lastRecord = '';
    }

    TestStream.prototype.write = function write(record) {
      this.lastRecord = record;
    };

    let taskExec;
    let testStream;

    beforeEach(() => {
      testStream = new TestStream();

      taskExec = new TaskExec({
        loggerOptions: {
          streams: [
            {
              type: 'raw',
              stream: testStream,
            },
          ],
        },
      });
    });

    it('should check if level is enabled', () => {
      expect(taskExec.logger.info()).to.be.true;
    });

    it('should implicitly convert first argument to string', () => {
      taskExec.logger.info(undefined);
      expect(testStream.lastRecord.msg).to.be.equal('undefined');

      taskExec.logger.info(null);
      expect(testStream.lastRecord.msg).to.be.equal('null');

      taskExec.logger.info({});
      expect(testStream.lastRecord.msg).to.be.equal('[object Object]');
    });

    it('should format log message', () => {
      taskExec.logger.info('hello %s', 'world');

      expect(testStream.lastRecord.msg).to.be.equal('hello world');
    });

    it('should log extra fields', () => {
      const testStream = new TestStream();

      const taskExec = new TaskExec({
        loggerOptions: {
          streams: [
            {
              type: 'raw',
              stream: testStream,
            },
          ],

          threadId: 'threadId',
          messageId: 'messageId',
          parentMessageId: 'parentMessageId',
        },
      });

      taskExec.logger.info('info');

      expect(testStream.lastRecord.name).to.be.equal('component');
      expect(testStream.lastRecord.threadId).to.be.equal('threadId');
      expect(testStream.lastRecord.messageId).to.be.equal('messageId');
      expect(testStream.lastRecord.parentMessageId).to.be.equal('parentMessageId');
      expect(testStream.lastRecord.msg).to.be.equal('info');
    });
  });
});
