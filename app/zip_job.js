const crypto = require('crypto');
const https = require('https');
const archiver = require('archiver');
const { Storage } = require('@google-cloud/storage');

const photoModel = require('./photo_model');
const firebaseDb = require('./firebase_db');

// Storage client: authenticates automatically from GOOGLE_APPLICATION_CREDENTIALS.
const storage = new Storage();

const bucketName = process.env.GCS_BUCKET || 'ecni22026bucket';

// In-memory index of finished jobs (key = tags, value = object name in the
// bucket). Kept for GET /; the durable copy now lives in Firebase (saveJob).
const completedJobs = {};

// Download one image and return its content as a Buffer.
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, response => {
        const status = response.statusCode;

        // follow a redirect if there is one
        if (status === 301 || status === 302) {
          response.resume();
          resolve(downloadImage(response.headers.location));
          return;
        }

        if (status !== 200) {
          response.resume();
          reject(new Error('HTTP ' + status + ' for ' + url));
          return;
        }

        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

// Build an in-memory zip from a list of { name, buffer } entries.
function buildZip(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];

    archive.on('data', chunk => chunks.push(chunk));
    archive.on('warning', reject);
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    files.forEach(file => archive.append(file.buffer, { name: file.name }));
    archive.finalize();
  });
}

// Upload the zip to Google Cloud Storage under a random file name.
// Adapted from the snippet given in the assignment.
function uploadZip(objectName, zipBuffer) {
  const file = storage.bucket(bucketName).file(objectName);
  const stream = file.createWriteStream({
    metadata: {
      contentType: 'application/zip',
      cacheControl: 'private'
    },
    resumable: false
  });

  return new Promise((resolve, reject) => {
    stream.on('error', err => reject(err));
    stream.on('finish', () => resolve('Ok'));
    stream.end(zipBuffer);
  });
}

// Full job: Flickr search -> first 10 photos -> in-memory zip -> Cloud Storage.
function processZipRequest(tags) {
  console.log('[zip] Building archive for tags "' + tags + '"');

  return photoModel
    .getFlickrPhotos(tags, 'all')
    .then(photos => {
      const firstTen = photos.slice(0, 10);
      console.log('[zip] Downloading ' + firstTen.length + ' photo(s) for tags "' + tags + '"');
      return Promise.all(
        firstTen.map((photo, index) =>
          downloadImage(photo.media.b).then(buffer => ({
            name: 'photo-' + (index + 1) + '.jpg',
            buffer
          }))
        )
      );
    })
    .then(buildZip)
    .then(zipBuffer => {
      const objectName = 'zips/' + crypto.randomUUID() + '.zip';
      console.log('[zip] Uploading archive (' + zipBuffer.length + ' bytes) to gs://' + bucketName + '/' + objectName);
      return uploadZip(objectName, zipBuffer).then(() => objectName);
    })
    .then(objectName => {
      completedJobs[tags] = objectName;
      // store a signed (temporary) URL in Firebase: the bucket objects are not
      // public, so a plain storage.googleapis.com link would be AccessDenied.
      return getSignedUrl(objectName)
        .then(downloadUrl => firebaseDb.saveJob(tags, objectName, downloadUrl))
        .then(() => objectName);
    })
    .then(objectName => {
      console.log('[zip] Done for tags "' + tags + '" -> gs://' + bucketName + '/' + objectName);
      return objectName;
    });
}

// Generate a temporary (2-day) download link for the zip.
// Snippet given in the assignment.
function getSignedUrl(objectName) {
  const options = {
    action: 'read',
    expires: Date.now() + 2 * 24 * 60 * 60 * 1000
  };

  return storage
    .bucket(bucketName)
    .file(objectName)
    .getSignedUrl(options)
    .then(urls => urls[0]);
}

module.exports = {
  processZipRequest,
  getSignedUrl,
  completedJobs,
  // exported for unit tests
  downloadImage,
  buildZip,
  uploadZip
};
