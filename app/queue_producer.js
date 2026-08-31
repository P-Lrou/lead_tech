const { PubSub } = require('@google-cloud/pubsub');

// Le client s'authentifie automatiquement via la variable d'environnement
// GOOGLE_APPLICATION_CREDENTIALS (chemin absolu vers la clef JSON du service account).
const pubSubClient = new PubSub({ projectId: process.env.GCP_PROJECT_ID });

// Publie une demande de zippage dans la queue Pub/Sub.
// Le worker consommera ce message pour zipper les photos correspondantes.
function publishZipRequest(tags) {
  const topicName = process.env.PUBSUB_TOPIC;
  const dataBuffer = Buffer.from(JSON.stringify({ tags }));

  return pubSubClient.topic(topicName).publishMessage({ data: dataBuffer });
}

module.exports = {
  publishZipRequest
};
