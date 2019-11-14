
const { expect } = require('chai');
const settings = require('../lib/settings.js');

describe('Settings', () => {
  it('should throw error if no important settings provided', () => {
    expect(() => {
      settings.readFrom({});
    }).to.throw('ELASTICIO_FLOW_ID is missing');
  });

  it('should not throw error if all important settings provided', () => {
    const envVars = {
      ELASTICIO_AMQP_URI: 'amqp://test2/test2',
      ELASTICIO_FLOW_ID: '5559edd38968ec0736000003',
      ELASTICIO_EXEC_ID: 'some-exec-id',
      ELASTICIO_STEP_ID: 'step_1',
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
    };

    const result = settings.readFrom(envVars);

    expect(result.LISTEN_MESSAGES_ON).to.be.equal('5559edd38968ec0736000003:step_1:1432205514864:messages');
  });

  it('should support also numbers as a settings parameter', () => {
    const envVars = {
      ELASTICIO_AMQP_URI: 'amqp://test2/test2',
      ELASTICIO_FLOW_ID: '5559edd38968ec0736000003',
      ELASTICIO_EXEC_ID: 'some-exec-id',
      ELASTICIO_STEP_ID: 'step_1',
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

      ELASTICIO_RABBITMQ_PREFETCH_SAILOR: '20',
    };

    const result = settings.readFrom(envVars);

    expect(result.LISTEN_MESSAGES_ON).to.be.equal('5559edd38968ec0736000003:step_1:1432205514864:messages');
    expect(result.RABBITMQ_PREFETCH_SAILOR).to.be.equal(20);
  });
});
