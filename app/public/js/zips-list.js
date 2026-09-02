// Reads the already-generated zips straight from Firebase Realtime Database
// (client side) and renders them into #available-zips, paginated.
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

// how many zips per page (the "and then you can change page" navigation below)
const PAGE_SIZE = 30;

const db = getDatabase(app);
const container = document.getElementById('available-zips');
let unsubscribe = null;

// paging / filtering state, kept between snapshots so the user's view sticks
let allJobs = [];
let currentPage = 0;
let currentSort = 'date_desc'; // sorted by date (newest first) by default

const SORTS = {
  date_desc: {
    label: 'Date (récent → ancien)',
    compare: (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
  },
  date_asc: {
    label: 'Date (ancien → récent)',
    compare: (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
  },
  tags_asc: {
    label: 'Tags (A → Z)',
    compare: (a, b) => String(a.tags || '').localeCompare(String(b.tags || ''))
  },
  tags_desc: {
    label: 'Tags (Z → A)',
    compare: (a, b) => String(b.tags || '').localeCompare(String(a.tags || ''))
  }
};

export function startZipsList() {
  if (unsubscribe) {
    return;
  }
  container.innerHTML = '<p class="text-muted">Loading&hellip;</p>';
  unsubscribe = onValue(
    ref(db, PROFILE),
    snapshot => {
      allJobs = flatten(snapshot.val());
      clampPage();
      render();
    },
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
  allJobs = [];
  currentPage = 0;
  currentSort = 'date_desc';
  container.innerHTML = '';
}

// Firebase gives us { zipTime: { fileKey: job } }; turn it into a flat list.
function flatten(data) {
  if (!data) {
    return [];
  }
  const jobs = [];
  Object.keys(data).forEach(zipTime => {
    const byFile = data[zipTime] || {};
    Object.keys(byFile).forEach(fileKey => jobs.push(byFile[fileKey]));
  });
  return jobs;
}

// Apply the currently selected filter to a copy of the job list.
function sortJobs(jobs) {
  const sort = SORTS[currentSort] || SORTS.date_desc;
  return jobs.slice().sort(sort.compare);
}

function pageCount() {
  return Math.max(1, Math.ceil(allJobs.length / PAGE_SIZE));
}

function clampPage() {
  if (currentPage < 0) {
    currentPage = 0;
  }
  if (currentPage > pageCount() - 1) {
    currentPage = pageCount() - 1;
  }
}

function render() {
  if (!allJobs.length) {
    container.innerHTML = '<p class="text-muted">No zip generated yet.</p>';
    return;
  }

  const sorted = sortJobs(allJobs);
  const start = currentPage * PAGE_SIZE;
  const pageJobs = sorted.slice(start, start + PAGE_SIZE);
  const total = sorted.length;
  const pages = pageCount();

  const filters =
    '<div class="form-inline" style="margin-bottom:10px">' +
    '<label for="zips-sort" class="text-muted" style="font-weight:normal">Trier&nbsp;par&nbsp;</label> ' +
    '<select id="zips-sort" class="form-control input-sm">' +
    Object.keys(SORTS)
      .map(
        key =>
          '<option value="' +
          key +
          '"' +
          (key === currentSort ? ' selected' : '') +
          '>' +
          escapeHtml(SORTS[key].label) +
          '</option>'
      )
      .join('') +
    '</select>' +
    '</div>';

  const list =
    '<ul>' +
    pageJobs
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

  // counter: how many zips are shown right now, out of the total
  const counter =
    '<p class="text-muted" id="zips-counter">' +
    pageJobs.length +
    ' zip affiché' +
    (pageJobs.length > 1 ? 's' : '') +
    ' (' +
    (start + 1) +
    '–' +
    (start + pageJobs.length) +
    ' sur ' +
    total +
    ')</p>';

  const pager =
    pages > 1
      ? '<nav class="text-center">' +
        '<button type="button" class="btn btn-default btn-sm" id="zips-prev"' +
        (currentPage === 0 ? ' disabled' : '') +
        '>&laquo; Précédent</button> ' +
        '<span class="text-muted" style="margin:0 10px">Page ' +
        (currentPage + 1) +
        ' / ' +
        pages +
        '</span> ' +
        '<button type="button" class="btn btn-default btn-sm" id="zips-next"' +
        (currentPage === pages - 1 ? ' disabled' : '') +
        '>Suivant &raquo;</button>' +
        '</nav>'
      : '';

  container.innerHTML = filters + counter + list + pager;

  const sortSelect = document.getElementById('zips-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', event => {
      currentSort = event.target.value;
      currentPage = 0; // a new order starts from the first page
      render();
    });
  }

  const prev = document.getElementById('zips-prev');
  const next = document.getElementById('zips-next');
  if (prev) {
    prev.addEventListener('click', () => {
      currentPage -= 1;
      clampPage();
      render();
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      currentPage += 1;
      clampPage();
      render();
    });
  }
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
