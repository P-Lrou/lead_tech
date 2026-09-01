const mockProcessZipRequest = jest.fn();
const mockOn = jest.fn();
const mockSubscription = jest.fn(() => ({ on: mockOn }));

jest.mock('../../app/zip_job', () => ({
  processZipRequest: mockProcessZipRequest
}));

jest.mock('@google-cloud/pubsub', () => ({
  PubSub: jest.fn(() => ({ subscription: mockSubscription }))
}));

const queueConsumer = require('../../app/queue_consumer');

function fakeMessage(body) {
  return {
    id: 'msg-1',
    data: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
    ack: jest.fn()
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PUBSUB_TOPIC = 'ecni2-test';
});

describe('handleMessage(message)', () => {
  test('runs the zip job then acknowledges the message', () => {
    mockProcessZipRequest.mockReturnValue(Promise.resolve());
    const message = fakeMessage({ tags: 'sunset' });

    return queueConsumer.handleMessage(message).then(() => {
      expect(mockProcessZipRequest).toHaveBeenCalledWith('sunset');
      expect(message.ack).toHaveBeenCalledTimes(1);
    });
  });

  test('acknowledges the message even when the zip job fails', () => {
    mockProcessZipRequest.mockReturnValue(Promise.reject(new Error('job failed')));
    const message = fakeMessage({ tags: 'sunset' });

    return queueConsumer.handleMessage(message).then(() => {
      expect(message.ack).toHaveBeenCalledTimes(1);
    });
  });

  test('discards an unreadable message without running a job', () => {
    const message = fakeMessage('not-json');

    const result = queueConsumer.handleMessage(message);

    expect(result).toBeUndefined();
    expect(mockProcessZipRequest).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
  });
});

describe('startConsumer()', () => {
  test('subscribes to the configured subscription and wires handlers', () => {
    const subscription = queueConsumer.startConsumer();

    expect(mockSubscription).toHaveBeenCalledWith('ecni2-test');
    expect(mockOn).toHaveBeenCalledWith('message', queueConsumer.handleMessage);

    const errorHandler = mockOn.mock.calls.find(call => call[0] === 'error')[1];
    expect(() => errorHandler(new Error('subscription boom'))).not.toThrow();
    expect(subscription).toBeDefined();
  });
});

describe('module bootstrap', () => {
  test('starts the consumer automatically when NODE_ENV is not "test"', () => {
    jest.resetModules();
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    jest.doMock('@google-cloud/pubsub', () => ({
      PubSub: jest.fn(() => ({ subscription: jest.fn(() => ({ on: jest.fn() })) }))
    }));
    jest.doMock('../../app/zip_job', () => ({ processZipRequest: jest.fn() }));

    expect(() => require('../../app/queue_consumer')).not.toThrow();

    process.env.NODE_ENV = previous;
  });
});
