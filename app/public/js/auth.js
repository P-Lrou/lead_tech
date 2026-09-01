// Firebase web authentication with Google Sign-In.
// The whole application is gated behind a signed-in user: while nobody is
// signed in only the login prompt is shown.
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { app } from './firebase-app.js';
import { startZipsList, stopZipsList } from './zips-list.js';

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const signInBtn = document.getElementById('sign-in');
const signOutBtn = document.getElementById('sign-out');
const userInfo = document.getElementById('user-info');
const userEmail = document.getElementById('user-email');
const appContent = document.getElementById('app-content');
const authRequired = document.getElementById('auth-required');

signInBtn.addEventListener('click', () => {
  signInWithPopup(auth, provider).catch(error => {
    authRequired.innerHTML =
      '<div class="alert alert-danger">Sign-in failed: ' + error.message + '</div>';
  });
});

signOutBtn.addEventListener('click', () => {
  signOut(auth);
});

onAuthStateChanged(auth, user => {
  const signedIn = Boolean(user);

  signInBtn.hidden = signedIn;
  userInfo.hidden = !signedIn;
  appContent.hidden = !signedIn;
  authRequired.hidden = signedIn;

  if (signedIn) {
    userEmail.textContent = user.email || user.displayName || 'signed in';
    startZipsList();
  } else {
    stopZipsList();
  }
});
