// Reads the already-generated zips straight from Firebase Realtime Database
// (client side) and renders them into #available-zips.
// Started/stopped by auth.js depending on the sign-in state, because the
// database rules require an authenticated user.
import {
  getDatabase,
  ref,
  onValue
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { app } from './firebase-app.js';

// same path the server writes to (see app/firebase_db.js)
const PROFILE = 'pierrelouis';

const db = getDatabase(app);
const container = document.getElementById('available-zips');
let unsubscribe = null;

export function startZipsList() {
  if (unsubscribe) {
    return;
  }
  container.innerHTML = '<p class="text-muted">Loading&hellip;</p>';
  unsubscribe = onValue(
    ref(db, PROFILE),
    snapshot => render(snapshot.val()),
    error => {
      container.innerHTML =
        '<div class="alert alert-warning">Could not load zips: ' +
        escapeHtml(error.message) +
        '</div>';
    }
  );
}

export function stopZipsList() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  container.innerHTML = '';
}

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
          escapeHtml(job.downloadUrl || job.publicUrl || '#') +
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
