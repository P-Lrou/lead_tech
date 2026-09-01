const { PubSub } = require('@google-cloud/pubsub');

// The client authenticates automatically from the GOOGLE_APPLICATION_CREDENTIALS
// env var (absolute path to the service account JSON key).
const pubSubClient = new PubSub({ projectId: process.env.GCP_PROJECT_ID });

// Publish a zip request to the Pub/Sub queue. The worker consumes this message
// and zips the matching photos.
function publishZipRequest(tags) {
  const topicName = process.env.PUBSUB_TOPIC;
  const dataBuffer = Buffer.from(JSON.stringify({ tags }));

  return pubSubClient.topic(topicName).publishMessage({ data: dataBuffer });
}

module.exports = {
  publishZipRequest
};
