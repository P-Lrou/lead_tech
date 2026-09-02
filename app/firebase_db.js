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
// survives an instance restart. Stores the Cloud Storage path and a signed
// (temporary) download URL the web client can link to directly.
function saveJob(tags, objectName, downloadUrl) {
  const filename = objectName.split('/').pop();
  const zipTime = safeKey(new Date().toISOString());
  const path = '/' + profile + '/' + zipTime + '/' + safeKey(filename);

  return getDatabase(app)
    .ref(path)
    .set({
      tags,
      storagePath: objectName,
      gsUri: 'gs://' + bucketName + '/' + objectName,
      downloadUrl,
      createdAt: Date.now()
    })
    .then(() => path);
}

// List every finished job stored under /<profile>, flattened and sorted newest
// first. Firebase gives us { zipTime: { fileKey: job } }.
function listJobs() {
  return getDatabase(app)
    .ref('/' + profile)
    .get()
    .then(snapshot => {
      const data = snapshot.val() || {};
      const jobs = [];

      Object.keys(data).forEach(zipTime => {
        const byFile = data[zipTime] || {};
        Object.keys(byFile).forEach(fileKey => {
          const job = byFile[fileKey];
          if (job) {
            jobs.push({
              tags: job.tags,
              storagePath: job.storagePath,
              gsUri: job.gsUri,
              downloadUrl: job.downloadUrl,
              createdAt: job.createdAt
            });
          }
        });
      });

      return jobs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    });
}

module.exports = {
  saveJob,
  listJobs
};
