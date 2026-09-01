const mockPublishMessage = jest.fn(() => Promise.resolve('message-id-1'));
const mockTopic = jest.fn(() => ({ publishMessage: mockPublishMessage }));

jest.mock('@google-cloud/pubsub', () => ({
  PubSub: jest.fn(() => ({ topic: mockTopic }))
}));

const queueProducer = require('../../app/queue_producer');

describe('publishZipRequest(tags)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBSUB_TOPIC = 'ecni2-test';
  });

  test('publishes the tags as a JSON buffer on the configured topic', () => {
    return queueProducer.publishZipRequest('sunset, beach').then(messageId => {
      expect(messageId).toBe('message-id-1');
      expect(mockTopic).toHaveBeenCalledWith('ecni2-test');

      const payload = mockPublishMessage.mock.calls[0][0];
      expect(Buffer.isBuffer(payload.data)).toBe(true);
      expect(JSON.parse(payload.data.toString())).toEqual({ tags: 'sunset, beach' });
    });
  });

  test('rejects when Pub/Sub fails', () => {
    mockPublishMessage.mockReturnValueOnce(Promise.reject(new Error('pubsub down')));

    return queueProducer.publishZipRequest('x').catch(error => {
      expect(error.message).toBe('pubsub down');
    });
  });
});
