// Firebase "Sign in with Google" + a short-lived Google Calendar access token.
// The token lives about one hour. It is kept in memory and in sessionStorage (cleared when the tab closes).

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const KEY = 'calendar-token';
const auth = getAuth(initializeApp(firebaseConfig));
let mem = null;

function current() {
  if (mem && mem.exp > Date.now()) return mem;
  try {
    const t = JSON.parse(sessionStorage.getItem(KEY));
    if (t && t.exp > Date.now()) { mem = t; return t; }
  } catch { /* ignore */ }
  return null;
}

export const getToken = () => (current() ? current().value : null);

export function clearToken() {
  mem = null;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.addScope(SCOPE);
  const result = await signInWithPopup(auth, provider);
  const cred = GoogleAuthProvider.credentialFromResult(result);
  mem = { value: cred.accessToken, exp: Date.now() + 55 * 60 * 1000 };
  try { sessionStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* ignore */ }
  return result.user;
}

export async function signOutUser() {
  clearToken();
  await signOut(auth);
}

export const onUser = (cb) => onAuthStateChanged(auth, cb);
