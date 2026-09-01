// Reads the already-generated zips straight from Firebase Realtime Database
// (client side) and renders them into #available-zips.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getDatabase,
  ref,
  onValue
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCIvTlTGG115yaWDeFqxi-Jc2oYH45FlME',
  authDomain: 'ecni2-2026.firebaseapp.com',
  databaseURL: 'https://ecni2-2026-default-rtdb.firebaseio.com',
  projectId: 'ecni2-2026',
  storageBucket: 'ecni2-2026.firebasestorage.app',
  messagingSenderId: '1046535202867',
  appId: '1:1046535202867:web:a23b26f739647f87221b46'
};

// same path the server writes to (see app/firebase_db.js)
const PROFILE = 'pierrelouis';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const container = document.getElementById('available-zips');

onValue(
  ref(db, PROFILE),
  snapshot => render(snapshot.val()),
  error => {
    container.innerHTML =
      '<div class="alert alert-warning">Could not load zips: ' +
      escapeHtml(error.message) +
      '</div>';
  }
);

function render(data) {
  if (!data) {
    container.innerHTML = '<p class="text-muted">No zip generated yet.</p>';
    return;
  }

  const jobs = [];
  Object.keys(data).forEach(zipTime => {
    const byFile = data[zipTime] || {};
    Object.keys(byFile).forEach(fileKey => jobs.push(byFile[fileKey]));
  });
  jobs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  container.innerHTML =
    '<ul>' +
    jobs
      .map(job => {
        const when = job.createdAt
          ? new Date(job.createdAt).toLocaleString()
          : '';
        return (
          '<li class="list-unstyled"><a href="' +
          escapeHtml(job.publicUrl) +
          '">' +
          escapeHtml(job.tags || 'zip') +
          '</a> <small class="text-muted">' +
          escapeHtml(when) +
          '</small></li>'
        );
      })
      .join('') +
    '</ul>';
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    char =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
  );
}
