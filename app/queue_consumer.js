const { PubSub } = require('@google-cloud/pubsub');

const zipJob = require('./zip_job');

// Même client que le producer : authentification automatique via
// GOOGLE_APPLICATION_CREDENTIALS (clef JSON du service account).
const pubSubClient = new PubSub({ projectId: process.env.GCP_PROJECT_ID });

// Traite un message de demande de zippage reçu depuis la queue :
// Flickr -> 10 premières images -> zip -> Google Cloud Storage.
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

// Ouvre la souscription et écoute les messages de la queue.
// Le topic et la souscription portent le même nom : "ecni2-" + i.
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

// On ne branche pas la souscription pendant les tests (pas de connexion réseau).
if (process.env.NODE_ENV !== 'test') {
  startConsumer();
}

module.exports = {
  startConsumer,
  handleMessage
};
