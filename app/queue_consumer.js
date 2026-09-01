const { PubSub } = require('@google-cloud/pubsub');

const zipJob = require('./zip_job');

// Same client as the producer: authenticates automatically from
// GOOGLE_APPLICATION_CREDENTIALS (service account JSON key).
const pubSubClient = new PubSub({ projectId: process.env.GCP_PROJECT_ID });

// Handle one zip request pulled from the queue:
// Flickr search -> first 10 photos -> zip -> Google Cloud Storage.
function handleMessage(message) {
  let payload;

  try {
    payload = JSON.parse(message.data.toString());
  } catch (err) {
    console.error(`[worker] Discarding unreadable message ${message.id}: ${err.message}`);
    message.ack();
    return;
  }

  console.log(`[worker] Received zip request for tags "${payload.tags}" (message ${message.id})`);

  zipJob
    .processZipRequest(payload.tags)
    .then(() => {
      console.log(`[worker] Message ${message.id} acknowledged`);
      message.ack();
    })
    .catch(err => {
      console.error(`[worker] Zip request for tags "${payload.tags}" failed (message ${message.id}): ${err.message}`);
      message.ack();
    });
}

// Open the subscription and listen for queue messages.
// The topic and the subscription share the same name: "ecni2-" + i.
function startConsumer() {
  const subscriptionName = process.env.PUBSUB_TOPIC;
  const subscription = pubSubClient.subscription(subscriptionName);

  subscription.on('message', handleMessage);
  subscription.on('error', error => {
    console.error(`[worker] Subscription "${subscriptionName}" error: ${error.message}`);
  });

  console.log(`[worker] Listening for zip requests on subscription "${subscriptionName}"`);
  return subscription;
}

// Do not open the subscription during tests (avoids a real network connection).
if (process.env.NODE_ENV !== 'test') {
  startConsumer();
}

module.exports = {
  startConsumer,
  handleMessage
};
