const { initializeApp, applicationDefault, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const databaseURL =
  process.env.FIREBASE_DB_URL || 'https://ecni2-2026-default-rtdb.firebaseio.com';
const profile = process.env.FIREBASE_PROFILE || 'pierrelouis';
const bucketName = process.env.GCS_BUCKET || 'ecni22026bucket';

// Initialise the Admin SDK once. Auth works like Pub/Sub: the credential is
// read from GOOGLE_APPLICATION_CREDENTIALS (service account JSON key).
const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: applicationDefault(), databaseURL });

// Firebase Realtime Database keys may not contain . # $ [ ] /
function safeKey(value) {
  return value.replace(/[.#$/[\]]/g, '-');
}

// Persist a finished zip job under /<profile>/<zipTime>/<filename> so it
// survives an instance restart. Stores the Cloud Storage path and the links.
function saveJob(tags, objectName) {
  const filename = objectName.split('/').pop();
  const zipTime = safeKey(new Date().toISOString());
  const path = '/' + profile + '/' + zipTime + '/' + safeKey(filename);

  return getDatabase(app)
    .ref(path)
    .set({
      tags,
      storagePath: objectName,
      gsUri: 'gs://' + bucketName + '/' + objectName,
      publicUrl: 'https://storage.googleapis.com/' + bucketName + '/' + objectName,
      createdAt: Date.now()
    })
    .then(() => path);
}

module.exports = {
  saveJob
};
