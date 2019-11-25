/* eslint-disable no-unused-expressions */
const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const _ = require('lodash');
const amqp = require('../lib/amqp.js');
const encryptor = require('../lib/encryptor.js');
const { Sailor } = require('../lib/sailor.js');

chai.use(sinonChai);
const { expect } = chai;

let settings;

const envVars = {
  ELASTICIO_AMQP_URI: 'amqp://test2/test2',
  ELASTICIO_FLOW_ID: '5559edd38968ec0736000003',
  ELASTICIO_STEP_ID: 'step_1',
  ELASTICIO_EXEC_ID: 'some-exec-id',
  ELASTICIO_WORKSPACE_ID: '5559edd38968ec073600683',
  ELASTICIO_CONTAINER_ID: 'dc1c8c3f-f9cb-49e1-a6b8-716af9e15948',
  ELASTICIO_USER_ID: '5559edd38968ec0736000002',
  ELASTICIO_COMP_ID: '5559edd38968ec0736000456',
  ELASTICIO_FUNCTION: 'list',
  ELASTICIO_LISTEN_MESSAGES_ON: '5559edd38968ec0736000003:step_1:1432205514864:messages',
  ELASTICIO_PUBLISH_MESSAGES_TO: 'userexchange:5527f0ea43238e5d5f000001',
  ELASTICIO_DATA_ROUTING_KEY: '5559edd38968ec0736000003:step_1:1432205514864:message',
  ELASTICIO_ERROR_ROUTING_KEY: '5559edd38968ec0736000003:step_1:1432205514864:error',
  ELASTICIO_REBOUND_ROUTING_KEY: '5559edd38968ec0736000003:step_1:1432205514864:rebound',
  ELASTICIO_SNAPSHOT_ROUTING_KEY: '5559edd38968ec0736000003:step_1:1432205514864:snapshot',
  ELASTICIO_COMPONENT_PATH: '/spec/component',
  ELASTICIO_DEBUG: 'sailor',
  ELASTICIO_API_URI: 'http://apihost.com',
  ELASTICIO_API_USERNAME: 'test@test.com',
  ELASTICIO_API_KEY: '5559edd',
};

process.env.ELASTICIO_TIMEOUT = 3000;

const payload = { param1: 'Value1' };

const message = {
  fields: {
    consumerTag: 'abcde',
    deliveryTag: 12345,
    exchange: 'test',
    routingKey: 'test.hello',
  },
  properties: {
    contentType: 'application/json',
    contentEncoding: 'utf8',
    headers: {
      taskId: '5559edd38968ec0736000003',
      execId: 'some-exec-id',
      userId: '5559edd38968ec0736000002',
      workspaceId: '5559edd38968ec073600683',
    },
    deliveryMode: undefined,
    priority: undefined,
    correlationId: undefined,
    replyTo: undefined,
    expiration: undefined,
    messageId: undefined,
    timestamp: undefined,
    type: undefined,
    userId: undefined,
    appId: undefined,
    mandatory: true,
    clusterId: '',
  },
  content: Buffer.from(encryptor.encryptMessageContent(payload)),
};

describe('Sailor', () => {
  beforeEach(() => {
    // eslint-disable-next-line global-require
    settings = require('../lib/settings').readFrom(envVars);
  });

  describe('init', () => {
    it('should init properly if developer returned a plain string in init', async () => {
      settings.FUNCTION = 'init_trigger_returns_string';

      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {
          config: {
            _account: '1234567890',
          },
        };
      });

      await sailor.prepare()
        .then(() => sailor.init({}))
        .then((result) => {
          expect(result).to.be.deep.equal('this_is_a_string');
        });
    });

    it('should init properly if developer returned a promise', async () => {
      settings.FUNCTION = 'init_trigger';

      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {
          config: {
            _account: '1234567890',
          },
        };
      });

      await sailor.prepare()
        .then(() => sailor.init({}))
        .then((result) => {
          expect(result).to.be.deep.equal({
            subscriptionId: '_subscription_123',
          });
        });
    });
  });

  describe('prepare', () => {
    let sailor;

    beforeEach(() => { sailor = new Sailor(settings); });

    describe('when step data retrieved', () => {
      let stepData;

      beforeEach(() => {
        stepData = { snapshot: {} };
      });

      describe('when step data retreived', () => {
        beforeEach(() => {
          sinon.stub(sailor.componentReader, 'init').returns(); // Promise.resolv()
          sinon.stub(sailor.apiClient.tasks, 'retrieveStep').returns(stepData);
        });

        it('should init component', async () => {
          sailor.prepare()
            .then(() => {
              expect(sailor.stepData).to.be.deep.equal(stepData);
              expect(sailor.snapshot).to.be.deep.equal(stepData.snapshot);
              expect(sailor.apiClient.tasks.retrieveStep).to.have.been
                .calledWith(settings.FLOW_ID, settings.STEP_ID);
              expect(sailor.componentReader.init).to.have.been.calledWith(settings.COMPONENT_PATH);
            });
        });
      });
    });

    describe('when step data is not retrieved', () => {
      beforeEach(() => {
        sinon.stub(sailor.apiClient.tasks, 'retrieveStep').throws(new Error('failed'));
      });

      it('should fail', async () => {
        sailor.prepare()
          .then(() => {
            throw new Error('Error is expected');
          })
          .catch((err) => {
            expect(err.message).to.be.equal('failed');
          });
      });
    });
  });

  describe('disconnection', () => {
    it('should disconnect Mongo and RabbitMQ, and exit process', async () => {
      const fakeAMQPConnection = {
        disconnect: sinon.spy(),
      };

      sinon.stub(amqp, 'Amqp').returns(fakeAMQPConnection);
      sinon.stub(process, 'exit').returns(0);

      const sailor = new Sailor(settings);

      await sailor.disconnect();
      expect(fakeAMQPConnection.disconnect).to.have.been.called;
    });

    afterEach(() => {
      amqp.Amqp.restore();
      process.exit.restore();
    });
  });

  describe('processMessage', () => {
    let fakeAMQPConnection;

    beforeEach(() => {
      fakeAMQPConnection = {};

      ['connect', 'sendData', 'sendError', 'sendRebound', 'ack', 'reject',
        'sendSnapshot'].forEach((method) => {
        fakeAMQPConnection[method] = sinon.spy();
      });

      fakeAMQPConnection.sendHttpReply = () => { };

      sinon.stub(amqp, 'Amqp').returns(fakeAMQPConnection);
    });

    afterEach(() => {
      amqp.Amqp.restore();
    });

    it('should call sendData() and ack() if success', async () => {
      settings.FUNCTION = 'data_trigger';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {};
      });

      await sailor.connect();
      await sailor.prepare();
      await sailor.processMessage(payload, message);
      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;
      expect(fakeAMQPConnection.connect).to.have.been.called;
      expect(fakeAMQPConnection.sendData).to.have.been.called;
      const sendDataCalls = fakeAMQPConnection.sendData.getCall(0);

      expect(sendDataCalls.args[0]).to.be.deep.equal({ items: [1, 2, 3, 4, 5, 6] });
      expect(sendDataCalls.args[1]).to.be.an('object');

      expect(sendDataCalls.args[1].contentType).to.be.equal('application/json');
      expect(sendDataCalls.args[1].contentEncoding).to.be.equal('utf8');
      expect(sendDataCalls.args[1].mandatory).to.be.true;
      expect(sendDataCalls.args[1].headers.execId).to.be.equal('some-exec-id');
      expect(sendDataCalls.args[1].headers.taskId).to.be.equal('5559edd38968ec0736000003');
      expect(sendDataCalls.args[1].headers.userId).to.be.equal('5559edd38968ec0736000002');
      expect(sendDataCalls.args[1].headers.workspaceId).to.be.equal('5559edd38968ec073600683');
      expect(sendDataCalls.args[1].headers.containerId).to.be.equal('dc1c8c3f-f9cb-49e1-a6b8-716af9e15948');
      expect(sendDataCalls.args[1].headers.stepId).to.be.equal('step_1');
      expect(sendDataCalls.args[1].headers.compId).to.be.equal('5559edd38968ec0736000456');
      expect(sendDataCalls.args[1].headers.function).to.be.equal('data_trigger');
      expect(sendDataCalls.args[1].headers.cid).to.be.equal(1);
      expect(sendDataCalls.args[1].headers.start).to.be.a('number');
      expect(sendDataCalls.args[1].headers.end).to.be.a('number');
      expect(sendDataCalls.args[1].headers.messageId).to.be.a('string');

      expect(fakeAMQPConnection.ack).to.have.been.called;
      expect(fakeAMQPConnection.ack.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.ack.getCall(0).args[0]).to.be.equal(message);
    });

    it('should call sendData() and ack() only once', async () => {
      settings.FUNCTION = 'end_after_data_twice';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {};
      });

      await sailor.connect();
      await sailor.prepare();
      await sailor.processMessage(payload, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;
      expect(fakeAMQPConnection.connect).to.have.been.called;
      expect(fakeAMQPConnection.sendData).to.have.been.called;

      expect(fakeAMQPConnection.sendData.callCount).to.be.equal(1);

      expect(fakeAMQPConnection.reject).not.to.have.been.called;
      expect(fakeAMQPConnection.ack).to.have.been.called;
      expect(fakeAMQPConnection.ack.callCount).to.be.equal(1);
    });

    it('should augment emitted message with passthrough data', async () => {
      settings.FUNCTION = 'passthrough';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return { is_passthrough: true };
      });

      const psPayload = {
        body: payload,
        passthrough: {
          step_0: {
            body: { key: 'value' },
          },
        },
      };

      await sailor.connect();
      await sailor.prepare();
      await sailor.processMessage(psPayload, message);
      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;
      expect(fakeAMQPConnection.connect).to.have.been.called;
      expect(fakeAMQPConnection.sendData).to.have.been.called;

      const sendDataCalls = fakeAMQPConnection.sendData.getCall(0);

      expect(sendDataCalls.args[0]).to.be.deep.equal({
        body: {
          param1: 'Value1',
        },
        passthrough: {
          step_0: {
            body: {
              key: 'value',
            },
          },
          step_1: {
            body: { param1: 'Value1' },
          },
        },
      });
      expect(sendDataCalls.args[1]).to.be.an('object');

      const dataCallObject = sendDataCalls.args[1];

      expect(dataCallObject.contentType).to.be.equal('application/json');
      expect(dataCallObject.contentEncoding).to.be.equal('utf8');
      expect(dataCallObject.mandatory).to.be.true;
      expect(dataCallObject.headers.execId).to.be.equal('some-exec-id');
      expect(dataCallObject.headers.taskId).to.be.equal('5559edd38968ec0736000003');
      expect(dataCallObject.headers.userId).to.be.equal('5559edd38968ec0736000002');
      expect(dataCallObject.headers.workspaceId).to.be.equal('5559edd38968ec073600683');
      expect(dataCallObject.headers.containerId).to.be.equal('dc1c8c3f-f9cb-49e1-a6b8-716af9e15948');
      expect(dataCallObject.headers.stepId).to.be.equal('step_1');
      expect(dataCallObject.headers.compId).to.be.equal('5559edd38968ec0736000456');
      expect(dataCallObject.headers.function).to.be.equal('passthrough');
      expect(dataCallObject.headers.cid).to.be.equal(1);
      expect(dataCallObject.headers.start).to.be.a('number');
      expect(dataCallObject.headers.end).to.be.a('number');
      expect(dataCallObject.headers.messageId).to.be.a('string');

      expect(fakeAMQPConnection.ack).to.have.been.called;
      expect(fakeAMQPConnection.ack.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.ack.getCall(0).args[0]).to.be.equal(message);
    });

    it('should provide access to flow variables', async () => {
      settings.FUNCTION = 'use_flow_variables';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {
          is_passthrough: true,
          variables: {
            var1: 'val1',
            var2: 'val2',
          },
        };
      });

      const psPayload = {
        body: payload,
      };

      await sailor.connect();
      await sailor.prepare();
      await sailor.processMessage(psPayload, message);
      expect(fakeAMQPConnection.sendData).to.have.been.called;

      const sendDataCalls = fakeAMQPConnection.sendData.getCall(0);

      expect(sendDataCalls.args[0].body).to.be.deep.equal({
        var1: 'val1',
        var2: 'val2',
      });
    });

    it('should send request to API server to update keys', async () => {
      settings.FUNCTION = 'keys_trigger';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {
          config: {
            _account: '1234567890',
          },
        };
      });

      sinon.stub(sailor.apiClient.accounts, 'update').callsFake((accountId, keys) => {
        expect(accountId).to.be.equal('1234567890');
        expect(keys).to.be.deep.equal({ keys: { oauth: { access_token: 'newAccessToken' } } });
      });

      await sailor.connect();
      await sailor.prepare();
      await sailor.processMessage(payload, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;
      expect(sailor.apiClient.accounts.update).to.have.been.called;

      expect(fakeAMQPConnection.connect).to.have.been.called;
      expect(fakeAMQPConnection.ack).to.have.been.called;
      expect(fakeAMQPConnection.ack.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.ack.getCall(0).args[0]).to.be.equal(message);
    });

    it('should emit error if failed to update keys', async () => {
      settings.FUNCTION = 'keys_trigger';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {
          config: {
            _account: '1234567890',
          },
        };
      });

      sinon.stub(sailor.apiClient.accounts, 'update').callsFake((accountId, keys) => {
        expect(accountId).to.be.equal('1234567890');
        expect(keys).to.be.deep.equal({ keys: { oauth: { access_token: 'newAccessToken' } } });
        return Promise.reject(new Error('Update keys error'));
      });

      await sailor.prepare();
      await sailor.connect();
      await sailor.processMessage(payload, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;
      expect(sailor.apiClient.accounts.update).to.have.been.called;

      expect(fakeAMQPConnection.connect).to.have.been.called;
      expect(fakeAMQPConnection.sendError).to.have.been.called;
      expect(fakeAMQPConnection.sendError.getCall(0).args[0].message).to.be.equal('Update keys error');
      expect(fakeAMQPConnection.ack).to.have.been.called;
      expect(fakeAMQPConnection.ack.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.ack.getCall(0).args[0]).to.be.equal(message);
    });

    it('should call sendRebound() and ack()', async () => {
      settings.FUNCTION = 'rebound_trigger';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {};
      });

      await sailor.prepare();
      await sailor.connect();
      await sailor.processMessage(payload, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;

      expect(fakeAMQPConnection.connect).to.have.been.called;

      expect(fakeAMQPConnection.sendRebound).to.have.been.called;
      expect(fakeAMQPConnection.sendRebound.getCall(0).args[0].message).to.be.equal('Rebound reason');
      expect(fakeAMQPConnection.sendRebound.getCall(0).args[1]).to.be.equal(message);

      expect(fakeAMQPConnection.ack).to.have.been.called;
      expect(fakeAMQPConnection.ack.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.ack.getCall(0).args[0]).to.be.equal(message);
    });

    it('should call sendSnapshot() and ack() after a `snapshot` event', async () => {
      settings.FUNCTION = 'update';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {};
      });

      await sailor.prepare();
      await sailor.connect();
      await sailor.processMessage({
        snapshot: { blabla: 'blablabla' },
      }, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;

      const expectedSnapshot = { blabla: 'blablabla' };
      expect(fakeAMQPConnection.connect).to.have.been.called;

      expect(fakeAMQPConnection.sendSnapshot.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.sendSnapshot.getCall(0).args[0]).to.be.deep.equal(expectedSnapshot);

      const snapshotObject = fakeAMQPConnection.sendSnapshot.getCall(0).args[1];

      expect(snapshotObject.contentType).to.be.equal('application/json');
      expect(snapshotObject.contentEncoding).to.be.equal('utf8');
      expect(snapshotObject.mandatory).to.be.true;
      expect(snapshotObject.headers.execId).to.be.equal('some-exec-id');
      expect(snapshotObject.headers.taskId).to.be.equal('5559edd38968ec0736000003');
      expect(snapshotObject.headers.userId).to.be.equal('5559edd38968ec0736000002');
      expect(snapshotObject.headers.workspaceId).to.be.equal('5559edd38968ec073600683');
      expect(snapshotObject.headers.containerId).to.be.equal('dc1c8c3f-f9cb-49e1-a6b8-716af9e15948');
      expect(snapshotObject.headers.stepId).to.be.equal('step_1');
      expect(snapshotObject.headers.compId).to.be.equal('5559edd38968ec0736000456');
      expect(snapshotObject.headers.function).to.be.equal('update');
      expect(snapshotObject.headers.cid).to.be.equal(1);
      expect(snapshotObject.headers.start).to.be.a('number');
      expect(snapshotObject.headers.messageId).to.be.a('string');

      expect(sailor.snapshot).to.be.deep.equal(expectedSnapshot);
      expect(fakeAMQPConnection.ack).to.have.been.called;
      expect(fakeAMQPConnection.ack.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.ack.getCall(0).args[0]).to.be.equal(message);
    });

    it('should call sendSnapshot() and ack() after an `updateSnapshot` event', async () => {
      settings.FUNCTION = 'update';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {
          snapshot: {
            someId: 'someData',
          },
        };
      });

      await sailor.prepare();
      await sailor.connect();
      await sailor.processMessage({
        updateSnapshot: { updated: 'value' },
      }, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;

      const expectedSnapshot = { someId: 'someData', updated: 'value' };
      expect(fakeAMQPConnection.connect).to.have.been.called;

      expect(fakeAMQPConnection.sendSnapshot.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.sendSnapshot.getCall(0).args[0]).to.be.deep.equal({ updated: 'value' });

      const snapshotObject = fakeAMQPConnection.sendSnapshot.getCall(0).args[1];

      expect(snapshotObject.contentType).to.be.equal('application/json');
      expect(snapshotObject.contentEncoding).to.be.equal('utf8');
      expect(snapshotObject.mandatory).to.be.true;
      expect(snapshotObject.headers.execId).to.be.equal('some-exec-id');
      expect(snapshotObject.headers.taskId).to.be.equal('5559edd38968ec0736000003');
      expect(snapshotObject.headers.userId).to.be.equal('5559edd38968ec0736000002');
      expect(snapshotObject.headers.workspaceId).to.be.equal('5559edd38968ec073600683');
      expect(snapshotObject.headers.containerId).to.be.equal('dc1c8c3f-f9cb-49e1-a6b8-716af9e15948');
      expect(snapshotObject.headers.stepId).to.be.equal('step_1');
      expect(snapshotObject.headers.compId).to.be.equal('5559edd38968ec0736000456');
      expect(snapshotObject.headers.function).to.be.equal('update');
      expect(snapshotObject.headers.cid).to.be.equal(1);
      expect(snapshotObject.headers.start).to.be.a('number');
      expect(snapshotObject.headers.messageId).to.be.a('string');

      expect(sailor.snapshot).to.be.deep.equal(expectedSnapshot);
      expect(fakeAMQPConnection.ack).to.have.been.called;
      expect(fakeAMQPConnection.ack.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.ack.getCall(0).args[0]).to.be.deep.equal(message);
    });

    it('should send error if error happened', async () => {
      settings.FUNCTION = 'error_trigger';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {};
      });

      await sailor.prepare();
      await sailor.connect();
      await sailor.processMessage(payload, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;

      expect(fakeAMQPConnection.connect).to.have.been.called;

      expect(fakeAMQPConnection.sendError).to.have.been.called;
      expect(fakeAMQPConnection.sendError.getCall(0).args[0].message).to.be.equal('Some component error');
      expect(fakeAMQPConnection.sendError.getCall(0).args[0].stack).to.not.be.undefined;
      expect(fakeAMQPConnection.sendError.getCall(0).args[2]).to.be.equal(message.content);

      expect(fakeAMQPConnection.reject).to.have.been.called;
      expect(fakeAMQPConnection.reject.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.reject.getCall(0).args[0]).to.be.deep.equal(message);
    });

    it('should send error and reject only once()', async () => {
      settings.FUNCTION = 'end_after_error_twice';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {};
      });

      await sailor.prepare();
      await sailor.connect();
      await sailor.processMessage(payload, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;

      expect(fakeAMQPConnection.connect).to.have.been.called;

      expect(fakeAMQPConnection.sendError).to.have.been.called;
      expect(fakeAMQPConnection.sendError.callCount).to.be.equal(1);

      expect(fakeAMQPConnection.ack).not.to.have.been.called;
      expect(fakeAMQPConnection.reject).to.have.been.called;
      expect(fakeAMQPConnection.reject.callCount).to.be.equal(1);
    });

    it('should reject message if trigger is missing', async () => {
      settings.FUNCTION = 'missing_trigger';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {};
      });

      await sailor.prepare();
      await sailor.connect();
      await sailor.processMessage(payload, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;

      expect(fakeAMQPConnection.connect).to.have.been.called;

      expect(fakeAMQPConnection.sendError).to.have.been.called;
      expect(fakeAMQPConnection.sendError.getCall(0).args[0].message).to.include("Failed to load file './triggers/missing_trigger.js'");
      expect(fakeAMQPConnection.sendError.getCall(0).args[0].stack).to.not.be.undefined;
      expect(fakeAMQPConnection.sendError.getCall(0).args[2]).to.be.equal(message.content);

      expect(fakeAMQPConnection.reject).to.have.been.called;
      expect(fakeAMQPConnection.reject.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.reject.getCall(0).args[0]).to.be.deep.equal(message);
    });

    it('should not process message if taskId in header is not equal to task._id', async () => {
      const message2 = _.cloneDeep(message);
      message2.properties.headers.taskId = 'othertaskid';

      settings.FUNCTION = 'error_trigger';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {};
      });

      await sailor.prepare();
      await sailor.connect();
      await sailor.processMessage(payload, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;
      expect(fakeAMQPConnection.reject).to.have.been.called;
    });

    it('should catch all data calls and all error calls', async () => {
      settings.FUNCTION = 'datas_and_errors';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').callsFake((taskId, stepId) => {
        expect(taskId).to.be.equal('5559edd38968ec0736000003');
        expect(stepId).to.be.equal('step_1');
        return {};
      });

      await sailor.prepare();
      await sailor.connect();
      await sailor.processMessage(payload, message);

      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.called;
      expect(fakeAMQPConnection.connect).to.have.been.called;

      // data
      expect(fakeAMQPConnection.sendData).to.have.been.called;
      expect(fakeAMQPConnection.sendData.callCount).to.be.equal(3);


      // error
      expect(fakeAMQPConnection.sendError).to.have.been.called;
      expect(fakeAMQPConnection.sendError.callCount).to.be.equal(2);


      // ack
      expect(fakeAMQPConnection.reject).to.have.been.called;
      expect(fakeAMQPConnection.reject.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.reject.getCall(0).args[0]).to.be.equal(message);
    });

    it('should handle errors in httpReply properly', async () => {
      settings.FUNCTION = 'http_reply';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').returns(Promise.resolve({}));
      fakeAMQPConnection.sendHttpReply = sinon.spy();

      await sailor.prepare();
      await sailor.connect();
      await sailor.processMessage(payload, message);

      expect(sailor.apiClient.tasks.retrieveStep)
        .to.have.been.calledWith('5559edd38968ec0736000003', 'step_1');

      expect(fakeAMQPConnection.connect).to.have.been.called;
      expect(fakeAMQPConnection.sendHttpReply).to.have.been.called;

      const sendHttpReplyCalls = fakeAMQPConnection.sendHttpReply.getCall(0);

      expect(sendHttpReplyCalls.args[0]).to.be.deep.equal({
        statusCode: 200,
        body: 'Ok',
        headers: {
          'content-type': 'text/plain',
        },
      });
      expect(sendHttpReplyCalls.args[1]).to.be.an('object');
      const httpReply = sendHttpReplyCalls.args[1];

      expect(httpReply.contentType).to.be.equal('application/json');
      expect(httpReply.contentEncoding).to.be.equal('utf8');
      expect(httpReply.mandatory).to.be.true;
      expect(httpReply.headers.execId).to.be.equal('some-exec-id');
      expect(httpReply.headers.taskId).to.be.equal('5559edd38968ec0736000003');
      expect(httpReply.headers.userId).to.be.equal('5559edd38968ec0736000002');
      expect(httpReply.headers.workspaceId).to.be.equal('5559edd38968ec073600683');
      expect(httpReply.headers.containerId).to.be.equal('dc1c8c3f-f9cb-49e1-a6b8-716af9e15948');
      expect(httpReply.headers.stepId).to.be.equal('step_1');
      expect(httpReply.headers.compId).to.be.equal('5559edd38968ec0736000456');
      expect(httpReply.headers.function).to.be.equal('http_reply');
      expect(httpReply.headers.cid).to.be.equal(1);
      expect(httpReply.headers.start).to.be.a('number');
      expect(httpReply.headers.messageId).to.be.a('string');

      expect(fakeAMQPConnection.sendData).to.have.been.called;

      const sendDataCalls = fakeAMQPConnection.sendData.getCall(0);

      expect(sendDataCalls.args[0]).to.be.deep.equal({
        body: {},
      });
      const dataCall = sendDataCalls.args[1];

      expect(dataCall).to.be.an('object');
      expect(dataCall.contentType).to.be.equal('application/json');
      expect(dataCall.contentEncoding).to.be.equal('utf8');
      expect(dataCall.mandatory).to.be.true;
      expect(dataCall.headers.execId).to.be.equal('some-exec-id');
      expect(dataCall.headers.taskId).to.be.equal('5559edd38968ec0736000003');
      expect(dataCall.headers.userId).to.be.equal('5559edd38968ec0736000002');
      expect(dataCall.headers.workspaceId).to.be.equal('5559edd38968ec073600683');
      expect(dataCall.headers.containerId).to.be.equal('dc1c8c3f-f9cb-49e1-a6b8-716af9e15948');
      expect(dataCall.headers.stepId).to.be.equal('step_1');
      expect(dataCall.headers.compId).to.be.equal('5559edd38968ec0736000456');
      expect(dataCall.headers.function).to.be.equal('http_reply');
      expect(dataCall.headers.cid).to.be.equal(1);
      expect(dataCall.headers.start).to.be.a('number');
      expect(dataCall.headers.end).to.be.a('number');
      expect(dataCall.headers.messageId).to.be.a('string');

      expect(fakeAMQPConnection.ack).to.have.been.called;
      expect(fakeAMQPConnection.ack.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.ack.getCall(0).args[0]).to.be.deep.equal(message);
      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledWith('5559edd38968ec0736000003', 'step_1');
    });

    it('should handle errors in httpReply properly', async () => {
      settings.FUNCTION = 'http_reply';
      const sailor = new Sailor(settings);

      sinon.stub(sailor.apiClient.tasks, 'retrieveStep').returns(Promise.resolve({}));

      fakeAMQPConnection.sendHttpReply = sinon.stub(sailor.amqpConnection, 'sendHttpReply').throws(new Error('Failed to send HTTP reply'));

      await sailor.connect();
      await sailor.prepare();
      await sailor.processMessage(payload, message);
      expect(sailor.apiClient.tasks.retrieveStep).to.have.been.calledWith('5559edd38968ec0736000003', 'step_1');

      expect(fakeAMQPConnection.connect).to.have.been.called;
      expect(fakeAMQPConnection.sendHttpReply).to.have.been.called;

      const sendHttpReplyCalls = fakeAMQPConnection.sendHttpReply.getCall(0);

      expect(sendHttpReplyCalls.args[0]).to.be.deep.equal({
        statusCode: 200,
        body: 'Ok',
        headers: {
          'content-type': 'text/plain',
        },
      });
      const httpCall = sendHttpReplyCalls.args[1];
      expect(httpCall).to.be.an('object');

      expect(httpCall.contentType).to.be.equal('application/json');
      expect(httpCall.contentEncoding).to.be.equal('utf8');
      expect(httpCall.mandatory).to.be.true;
      expect(httpCall.headers.execId).to.be.equal('some-exec-id');
      expect(httpCall.headers.taskId).to.be.equal('5559edd38968ec0736000003');
      expect(httpCall.headers.userId).to.be.equal('5559edd38968ec0736000002');
      expect(httpCall.headers.workspaceId).to.be.equal('5559edd38968ec073600683');
      expect(httpCall.headers.containerId).to.be.equal('dc1c8c3f-f9cb-49e1-a6b8-716af9e15948');
      expect(httpCall.headers.stepId).to.be.equal('step_1');
      expect(httpCall.headers.compId).to.be.equal('5559edd38968ec0736000456');
      expect(httpCall.headers.function).to.be.equal('http_reply');
      expect(httpCall.headers.cid).to.be.equal(1);
      expect(httpCall.headers.start).to.be.a('number');
      expect(httpCall.headers.messageId).to.be.a('string');

      expect(fakeAMQPConnection.sendData).not.to.have.been.called;
      expect(fakeAMQPConnection.ack).not.to.have.been.called;

      // error
      expect(fakeAMQPConnection.sendError).to.have.been.called;

      const sendErrorCalls = fakeAMQPConnection.sendError.getCall(0);
      expect(sendErrorCalls.args[0].message).to.be.equal('Failed to send HTTP reply');

      // ack
      expect(fakeAMQPConnection.reject).to.have.been.called;
      expect(fakeAMQPConnection.reject.callCount).to.be.equal(1);
      expect(fakeAMQPConnection.reject.getCall(0).args[0]).to.be.equal(message);
    });
  });

  describe('readIncomingMessageHeaders', () => {
    it('execId missing', () => {
      const sailor = new Sailor(settings);

      try {
        sailor.readIncomingMessageHeaders({
          properties: {
            headers: {},
          },
        });
        throw new Error('Must not be reached');
      } catch (e) {
        expect(e.message).to.be.equal('ExecId is missing in message header');
      }
    });

    it('taskId missing', () => {
      const sailor = new Sailor(settings);

      try {
        sailor.readIncomingMessageHeaders({
          properties: {
            headers: {
              execId: 'my_exec_123',
            },
          },
        });
        throw new Error('Must not be reached');
      } catch (e) {
        expect(e.message).to.be.equal('TaskId is missing in message header');
      }
    });

    it('userId missing', () => {
      const sailor = new Sailor(settings);

      try {
        sailor.readIncomingMessageHeaders({
          properties: {
            headers: {
              execId: 'my_exec_123',
              taskId: 'my_task_123',
            },
          },
        });
        throw new Error('Must not be reached');
      } catch (e) {
        expect(e.message).to.be.equal('UserId is missing in message header');
      }
    });

    it('Message with wrong taskID arrived to the sailor', () => {
      const sailor = new Sailor(settings);

      try {
        sailor.readIncomingMessageHeaders({
          properties: {
            headers: {
              execId: 'my_exec_123',
              taskId: 'my_task_123',
              userId: 'my_user_123',
            },
          },
        });
        throw new Error('Must not be reached');
      } catch (e) {
        expect(e.message).to.be.equal('Message with wrong taskID arrived to the sailor');
      }
    });

    it('should copy standard headers', () => {
      const sailor = new Sailor(settings);

      const headers = {
        execId: 'my_exec_123',
        taskId: settings.FLOW_ID,
        userId: 'my_user_123',
        threadId: undefined,
      };

      const result = sailor.readIncomingMessageHeaders({
        properties: {
          headers,
        },
      });

      expect(result).to.be.deep.equal(headers);
    });

    it('should copy standard headers and parentMessageId', () => {
      const sailor = new Sailor(settings);

      const messageId = 'parent_message_1234';

      const headers = {
        execId: 'my_exec_123',
        taskId: settings.FLOW_ID,
        userId: 'my_user_123',
        messageId,
      };

      const result = sailor.readIncomingMessageHeaders({
        properties: {
          headers,
        },
      });

      expect(result).to.be.deep.equal({
        execId: 'my_exec_123',
        taskId: settings.FLOW_ID,
        userId: 'my_user_123',
        threadId: undefined,
        parentMessageId: messageId,
      });
    });

    it('should copy standard headers and reply_to', () => {
      const sailor = new Sailor(settings);

      const headers = {
        execId: 'my_exec_123',
        taskId: settings.FLOW_ID,
        userId: 'my_user_123',
        threadId: undefined,
        reply_to: 'my_reply_to_exchange',
      };

      const result = sailor.readIncomingMessageHeaders({
        properties: {
          headers,
        },
      });

      expect(result).to.be.deep.equal(headers);
    });

    it('should copy standard headers, reply_to and x-eio headers', () => {
      const sailor = new Sailor(settings);

      const headers = {
        execId: 'my_exec_123',
        taskId: settings.FLOW_ID,
        userId: 'my_user_123',
        threadId: undefined,
        reply_to: 'my_reply_to_exchange',
        'x-eio-meta-lowercase': 'I am lowercase',
        'X-eio-meta-miXeDcAse': 'Eventually to become lowercase',
      };

      const result = sailor.readIncomingMessageHeaders({
        properties: {
          headers,
        },
      });

      expect(result).to.be.deep.equal({
        execId: 'my_exec_123',
        taskId: settings.FLOW_ID,
        userId: 'my_user_123',
        threadId: undefined,
        reply_to: 'my_reply_to_exchange',
        'x-eio-meta-lowercase': 'I am lowercase',
        'x-eio-meta-mixedcase': 'Eventually to become lowercase',
      });
    });
  });
});
