const { PubSub } = require('@google-cloud/pubsub');

// Même client que le producer : authentification automatique via
// GOOGLE_APPLICATION_CREDENTIALS (clef JSON du service account).
const pubSubClient = new PubSub({ projectId: process.env.GCP_PROJECT_ID });

// Traite un message de demande de zippage reçu depuis la queue.
function handleMessage(message) {
  try {
    const payload = JSON.parse(message.data.toString());
    console.log(`Zip request received (message ${message.id}):`, payload.tags);
    // TODO (étape suivante) : rechercher les photos Flickr, zipper les 10
    // premières, uploader le zip sur Cloud Storage puis écrire le path et les
    // liens dans la Realtime Database Firebase.
  } catch (err) {
    console.log(`Invalid message ${message.id}: ${err.message}`);
  }

  message.ack();
}

// Ouvre la souscription et écoute les messages de la queue.
// Le topic et la souscription portent le même nom : "ecni2-" + i.
function startConsumer() {
  const subscriptionName = process.env.PUBSUB_TOPIC;
  const subscription = pubSubClient.subscription(subscriptionName);

  subscription.on('message', handleMessage);
  subscription.on('error', error => {
    console.log('Pub/Sub subscription error:', error.message);
  });

  console.log(`Listening for zip requests on subscription "${subscriptionName}"`);
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
