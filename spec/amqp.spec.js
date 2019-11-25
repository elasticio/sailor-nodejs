/* eslint-disable max-len, no-unused-expressions */
const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const _ = require('lodash');
const pThrottle = require('p-throttle');
const { Amqp } = require('../lib/amqp.js');
const encryptor = require('../lib/encryptor.js');

const { expect } = chai;
chai.use(sinonChai);

process.env.ELASTICIO_MESSAGE_CRYPTO_PASSWORD = 'testCryptoPassword';
process.env.ELASTICIO_MESSAGE_CRYPTO_IV = 'iv=any16_symbols';

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

  ELASTICIO_API_URI: 'http://apihost.com',
  ELASTICIO_API_USERNAME: 'test@test.com',
  ELASTICIO_API_KEY: '5559edd',

  PROCESS_AMQP_DRAIN: false,
};

const settings = require('../lib/settings.js').readFrom(envVars);

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
      taskId: 'task1234567890',
      execId: 'exec1234567890',
      reply_to: 'replyTo1234567890',
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
  content: encryptor.encryptMessageContent({ content: 'Message content' }),
};

const waitForThen = (fn, testFn) => {
  fn;
  testFn;
};

describe('AMQP', () => {
  beforeEach(() => {
    sinon.spy(encryptor, 'decryptMessageContent');
  });

  afterEach(() => {
    encryptor.decryptMessageContent.restore();
  });

  it('Should send message to outgoing channel when process data', () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        taskId: 'task1234567890',
        stepId: 'step_456',
      },
    };

    amqp.sendData({
      headers: {
        'some-other-header': 'headerValue',
      },
      body: 'Message content',
    }, props);

    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(1);

    const publishParameters = amqp.publishChannel.publish.getCall(0).args;
    expect(publishParameters).to.include(settings.PUBLISH_MESSAGES_TO);
    expect(publishParameters).to.include(settings.DATA_ROUTING_KEY);
    expect(publishParameters).to.include(props);

    const payload = encryptor.decryptMessageContent(publishParameters[2].toString());
    expect(payload).to.be.deep.equal({
      headers: {
        'some-other-header': 'headerValue',
      },
      body: 'Message content',
    });
  });

  it('Should send message async to outgoing channel when process data', async () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      on: sinon.spy(),
    };
    amqp.publishChannel.publish = () => true;
    sinon.stub(amqp.publishChannel, 'publish').returns(true);
    amqp.publishChannel.waitForConfirms = () => Promise.resolve([null]);

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        taskId: 'task1234567890',
        stepId: 'step_456',
      },
    };
    // One request every 500 ms
    const throttle = pThrottle(() => Promise.resolve(), 1, 500);
    const start = Date.now();
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await amqp.sendData({
        headers: {
          'some-other-header': 'headerValue',
        },
        body: 'Message content',
      }, props, throttle);
    }
    const duration = Math.round((Date.now() - start) / 1000);
    // Total duration should be around 1 seconds, because
    // first goes through
    // second throttled for 500ms
    // third throttled for another 500 ms
    expect(duration).to.be.equal(1);
    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(3);

    const publishParameters = amqp.publishChannel.publish.getCall(0).args;
    expect(publishParameters).to.include(settings.PUBLISH_MESSAGES_TO);
    expect(publishParameters).to.include(settings.DATA_ROUTING_KEY);
    expect(publishParameters).to.include(props);

    const payload = encryptor.decryptMessageContent(publishParameters[2]);
    expect(payload).to.be.deep.equal({
      headers: {
        'some-other-header': 'headerValue',
      },
      body: 'Message content',
    });
  });

  it('Should sendHttpReply to outgoing channel using routing key from headers when process data', () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const msg = {
      statusCode: 200,
      headers: {
        'content-type': 'text/plain',
      },
      body: 'OK',
    };

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        taskId: 'task1234567890',
        stepId: 'step_456',
        reply_to: 'my-special-routing-key',
      },
    };
    amqp.sendHttpReply(msg, props);

    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(1);

    const publishParameters = amqp.publishChannel.publish.getCall(0).args;
    expect(publishParameters[0]).to.be.equal(settings.PUBLISH_MESSAGES_TO);
    expect(publishParameters[1]).to.be.equal('my-special-routing-key');
    expect(publishParameters[2].toString()).to.be.equal(encryptor.encryptMessageContent(msg));
    expect(publishParameters[3]).to.be.deep.equal(props);

    const payload = encryptor.decryptMessageContent(publishParameters[2].toString());
    expect(payload).to.be.deep.equal(msg);
  });

  it('Should throw error in sendHttpReply if reply_to header not found', async () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const msg = {
      statusCode: 200,
      headers: {
        'content-type': 'text/plain',
      },
      body: 'OK',
    };
    await amqp.sendHttpReply(msg, {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        taskId: 'task1234567890',
        stepId: 'step_456',
      },
    }).catch((e) => {
      expect(amqp.publishChannel.publish).not.to.have.been.called;
      expect(e.message).to.be.equal("Component emitted 'httpReply' event but 'reply_to' was not found in AMQP headers");
    });
  });

  it('Should send message to outgoing channel using routing key from headers when process data', () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const msg = {
      headers: {
        'X-EIO-Routing-Key': 'my-special-routing-key',
      },
      body: {
        content: 'Message content',
      },
    };

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        taskId: 'task1234567890',
        stepId: 'step_456',
      },
    };

    amqp.sendData(msg, props);

    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(1);

    const publishParameters = amqp.publishChannel.publish.getCall(0).args;
    expect(publishParameters[0]).to.be.equal(settings.PUBLISH_MESSAGES_TO);
    expect(publishParameters[1]).to.be.equal('my-special-routing-key');
    expect(publishParameters[3]).to.be.deep.equal(props);

    const payload = encryptor.decryptMessageContent(publishParameters[2]);
    expect(payload).to.be.deep.equal({
      headers: {},
      body: {
        content: 'Message content',
      },
    });
  });

  it('Should send message to errors when process error', () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        taskId: 'task1234567890',
        stepId: 'step_456',
      },
    };

    amqp.sendError(new Error('Test error'), props, message.content);

    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(1);

    const publishParameters = amqp.publishChannel.publish.getCall(0).args;
    expect(publishParameters[0]).to.be.equal(settings.PUBLISH_MESSAGES_TO);
    expect(publishParameters[1]).to.be.equal(settings.ERROR_ROUTING_KEY);
    expect(publishParameters[3]).to.be.deep.equal(props);

    const payload = JSON.parse(publishParameters[2].toString());
    payload.error = encryptor.decryptMessageContent(payload.error);
    payload.errorInput = encryptor.decryptMessageContent(payload.errorInput);

    expect(payload.error.message).to.be.equal('Test error');
    expect(payload.errorInput.content).to.be.equal('Message content');
  });

  it('Should send message to errors using routing key from headers when process error', async () => {
    const expectedErrorPayload = {
      error: {
        name: 'Error',
        message: 'Test error',
        stack: 'string...',
      },
      errorInput: {
        content: 'Message content',
      },
    };

    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        taskId: 'task1234567890',
        stepId: 'step_456',
        reply_to: 'my-special-routing-key',
      },
    };

    amqp.sendError(new Error('Test error'), props, message.content);

    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(2);

    let publishParameters = amqp.publishChannel.publish.getCall(0).args;
    expect(publishParameters.length).to.be.equal(4);
    expect(publishParameters[0]).to.be.equal(settings.PUBLISH_MESSAGES_TO);
    expect(publishParameters[1]).to.be.equal('5559edd38968ec0736000003:step_1:1432205514864:error');
    expect(publishParameters[3]).to.be.equal(props);

    let payload = JSON.parse(publishParameters[2].toString());
    payload.error = encryptor.decryptMessageContent(payload.error);
    payload.errorInput = encryptor.decryptMessageContent(payload.errorInput);

    expect({
      ...payload,
      error: {
        ...payload.error,
        stack: expectedErrorPayload.error.stack,
      },
    }).to.be.deep.equal(expectedErrorPayload);


    publishParameters = amqp.publishChannel.publish.getCall(1).args;
    expect(publishParameters.length).to.be.equal(4);
    expect(publishParameters[0]).to.be.equal(settings.PUBLISH_MESSAGES_TO);
    expect(publishParameters[1]).to.be.equal('my-special-routing-key');
    expect(publishParameters[3]).to.be.deep.equal({
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        taskId: 'task1234567890',
        stepId: 'step_456',
        reply_to: 'my-special-routing-key',
        'x-eio-error-response': true,
      },
    });

    payload = encryptor.decryptMessageContent(publishParameters[2]);

    expect({ ...payload, stack: expectedErrorPayload.error.stack }).to.be.deep.equal(expectedErrorPayload.error);
  });

  it('Should not provide errorInput if errorInput was empty', () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        taskId: 'task1234567890',
        stepId: 'step_456',
      },
    };

    amqp.sendError(new Error('Test error'), props, '');

    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(1);

    const publishParameters = amqp.publishChannel.publish.getCall(0).args;
    expect(publishParameters[0]).to.be.equal(settings.PUBLISH_MESSAGES_TO);
    expect(publishParameters[1]).to.be.equal('5559edd38968ec0736000003:step_1:1432205514864:error');

    const payload = JSON.parse(publishParameters[2].toString());
    payload.error = encryptor.decryptMessageContent(payload.error);

    expect(payload.error.message).to.be.equal('Test error');
    expect(payload.errorInput).to.be.undefined;

    expect(publishParameters[3]).to.be.equal(props);
  });

  it('Should not provide errorInput if errorInput was null', () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        taskId: 'task1234567890',
        stepId: 'step_456',
      },
    };

    amqp.sendError(new Error('Test error'), props, null);

    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(1);

    const publishParameters = amqp.publishChannel.publish.getCall(0).args;

    expect(publishParameters[0]).to.be.equal(settings.PUBLISH_MESSAGES_TO);
    expect(publishParameters[1]).to.be.equal('5559edd38968ec0736000003:step_1:1432205514864:error');

    const payload = JSON.parse(publishParameters[2]);
    payload.error = encryptor.decryptMessageContent(payload.error);

    expect(payload.error.message).to.be.equal('Test error');
    expect(payload.errorInput).to.be.undefined;

    expect(publishParameters[3]).to.be.equal(props);
  });

  it('Should send message to rebounds when rebound happened', () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        execId: 'exec1234567890',
        taskId: 'task1234567890',
        stepId: 'step_1',
        compId: 'comp1',
        function: 'list',
        start: '1432815685034',
      },
    };

    amqp.sendRebound(new Error('Rebound error'), message, props);

    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(1);

    const publishParameters = amqp.publishChannel.publish.getCall(0).args;
    expect(publishParameters).to.be.deep.equal([
      settings.PUBLISH_MESSAGES_TO,
      settings.REBOUND_ROUTING_KEY,
      publishParameters[2],
      {
        contentType: 'application/json',
        contentEncoding: 'utf8',
        mandatory: true,
        expiration: 15000,
        headers: {
          execId: 'exec1234567890',
          taskId: 'task1234567890',
          stepId: 'step_1',
          compId: 'comp1',
          function: 'list',
          start: '1432815685034',
          reboundIteration: 1,
        },
      },
    ]);

    const payload = encryptor.decryptMessageContent(publishParameters[2]);
    expect(payload).to.be.deep.equal({ content: 'Message content' });
  });

  it('Should send message to rebounds with reboundIteration=3', () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        execId: 'exec1234567890',
        taskId: 'task1234567890',
        stepId: 'step_1',
        compId: 'comp1',
        function: 'list',
        start: '1432815685034',
      },
    };

    const clonedMessage = _.cloneDeep(message);
    clonedMessage.properties.headers.reboundIteration = 2;

    amqp.sendRebound(new Error('Rebound error'), clonedMessage, props);

    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(1);

    const publishParameters = amqp.publishChannel.publish.getCall(0).args;
    expect(publishParameters).to.be.deep.equal([
      settings.PUBLISH_MESSAGES_TO,
      settings.REBOUND_ROUTING_KEY,
      publishParameters[2],
      {
        contentType: 'application/json',
        contentEncoding: 'utf8',
        mandatory: true,
        expiration: 60000,
        headers: {
          execId: 'exec1234567890',
          taskId: 'task1234567890',
          stepId: 'step_1',
          compId: 'comp1',
          function: 'list',
          start: '1432815685034',
          reboundIteration: 3,
        },
      },
    ]);

    const payload = encryptor.decryptMessageContent(publishParameters[2]);
    expect(payload).to.be.deep.equal({ content: 'Message content' });
  });

  it('Should send message to errors when rebound limit exceeded', () => {
    const amqp = new Amqp(settings);
    amqp.publishChannel = {
      publish: sinon.spy(),
    };

    const props = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      mandatory: true,
      headers: {
        execId: 'exec1234567890',
        taskId: 'task1234567890',
        stepId: 'step_1',
        compId: 'comp1',
        function: 'list',
        start: '1432815685034',
      },
    };

    const clonedMessage = _.cloneDeep(message);
    clonedMessage.properties.headers.reboundIteration = 100;

    amqp.sendRebound(new Error('Rebound error'), clonedMessage, props);

    expect(amqp.publishChannel.publish).to.have.been.called;
    expect(amqp.publishChannel.publish.callCount).to.be.equal(1);

    const publishParameters = amqp.publishChannel.publish.getCall(0).args;
    expect(publishParameters).to.be.deep.equal([
      settings.PUBLISH_MESSAGES_TO,
      settings.ERROR_ROUTING_KEY,
      publishParameters[2],
      props,
    ]);

    const payload = JSON.parse(publishParameters[2]);
    payload.error = encryptor.decryptMessageContent(payload.error);
    payload.errorInput = encryptor.decryptMessageContent(payload.errorInput);

    expect(payload.error.message).to.be.equal('Rebound limit exceeded');
    expect(payload.errorInput).to.be.deep.equal({ content: 'Message content' });
  });


  it('Should ack message when confirmed', () => {
    const amqp = new Amqp();
    amqp.subscribeChannel = {
      ack: sinon.spy(),
    };

    amqp.ack(message);

    expect(amqp.subscribeChannel.ack).to.have.been.called;
    expect(amqp.subscribeChannel.ack.callCount).to.be.equal(1);
    expect(amqp.subscribeChannel.ack.getCall(0).args[0]).to.be.equal(message);
  });

  it('Should reject message when ack is called with false', () => {
    const amqp = new Amqp(settings);
    amqp.subscribeChannel = {
      reject: sinon.spy(),
    };
    amqp.reject(message);

    expect(amqp.subscribeChannel.reject).to.have.been.called;
    expect(amqp.subscribeChannel.reject.callCount).to.be.equal(1);
    expect(amqp.subscribeChannel.reject.getCall(0).args[0]).to.be.equal(message);
    expect(amqp.subscribeChannel.reject.getCall(0).args[1]).to.be.equal(false);
  });

  it('Should listen queue and pass decrypted message to client function', () => {
    const amqp = new Amqp(settings);
    const clientFunction = sinon.spy();
    amqp.subscribeChannel = {
      consume: () => {},
      prefetch: sinon.spy(),
    };
    sinon.stub(amqp.subscribeChannel, 'consume').callsFake((queueName, callback) => {
      callback(message);
    });

    amqp.listenQueue('testQueue', clientFunction);

    waitForThen(() => clientFunction.callCount > 0,
      () => {
        expect(amqp.subscribeChannel.prefetch).to.have.been.calledWith(1);
        expect(clientFunction.callCount).to.be.equal(1);
        expect(clientFunction.getCall(0).args[0]).to.be.deep.equal(
          {
            headers: {
              reply_to: 'replyTo1234567890',
            },
            content: 'Message content',
          },
        );
        expect(clientFunction.getCall(0).args[1]).to.be.equal(message);
        // eslint-disable-next-line max-len
        expect(clientFunction.getCall(0).args[1].content).to.be.deep.equal(encryptor.encryptMessageContent({ content: 'Message content' }));

        expect(encryptor.decryptMessageContent).to.have.been.calledWith(message.content, message.properties.headers);
      });
  });

  it('Should disconnect from all channels and connection', () => {
    const amqp = new Amqp(settings);
    amqp.subscribeChannel = {
      close: sinon.spy(),
    };
    amqp.publishChannel = {
      close: sinon.spy(),
    };

    amqp.amqp = {
      close: sinon.spy(),
    };

    amqp.disconnect();

    expect(amqp.subscribeChannel.close.callCount).to.be.equal(1);
    expect(amqp.publishChannel.close.callCount).to.be.equal(1);
    expect(amqp.amqp.close.callCount).to.be.equal(1);
  });
});
