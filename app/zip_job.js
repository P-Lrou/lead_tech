const crypto = require('crypto');
const https = require('https');
const archiver = require('archiver');
const { Storage } = require('@google-cloud/storage');

const photoModel = require('./photo_model');

// Client Storage : authentification automatique via GOOGLE_APPLICATION_CREDENTIALS.
const storage = new Storage();

const bucketName = process.env.GCS_BUCKET || 'ecni22026bucket';

// Pas de BDD pour cette expérimentation : on garde l'état des jobs terminés
// dans une variable de module (le worker tourne sur la même instance que l'API).
// clef = tags, valeur = lien vers le zip.
const completedJobs = {};

// Télécharge une image et renvoie son contenu en Buffer.
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, response => {
        const status = response.statusCode;

        // suit une éventuelle redirection
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

// Construit un zip en mémoire à partir d'une liste { name, buffer }.
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

// Envoie le zip dans Google Cloud Storage sous un nom de fichier aléatoire.
// Adapté du snippet fourni dans l'énoncé.
function uploadZip(filename, zipBuffer) {
  const file = storage.bucket(bucketName).file('zips/' + filename);
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

// Job complet : Flickr -> 10 premières images -> zip -> Cloud Storage.
function processZipRequest(tags) {
  return photoModel
    .getFlickrPhotos(tags, 'all')
    .then(photos => {
      const firstTen = photos.slice(0, 10);
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
      const filename = crypto.randomUUID() + '.zip';
      return uploadZip(filename, zipBuffer).then(() => filename);
    })
    .then(filename => {
      const link = 'https://storage.googleapis.com/' + bucketName + '/zips/' + filename;
      completedJobs[tags] = link;
      console.log('Zip job done for "' + tags + '": ' + link);
      return link;
    });
}

module.exports = {
  processZipRequest,
  completedJobs
};
