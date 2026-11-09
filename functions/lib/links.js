'use strict';
// Signed links for FINISH / POSTPONE / COMPRESS and signed OAuth state.

const crypto = require('crypto');

function sign(secret, text) {
  return crypto.createHmac('sha256', secret).update(text).digest('hex').slice(0, 32);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function actionPayload({ uid, eventId, action, minutes, exp }) {
  return [uid, eventId, action, minutes, exp].join('|');
}

function makeActionLink(baseUrl, secret, { uid, eventId, action, minutes = 0, ttlMs = 14 * 24 * 3600 * 1000 }, nowMs = Date.now()) {
  const exp = nowMs + ttlMs;
  const sig = sign(secret, actionPayload({ uid, eventId, action, minutes, exp }));
  const q = new URLSearchParams({ u: uid, e: eventId, a: action, m: String(minutes), x: String(exp), s: sig });
  return `${baseUrl.replace(/\/$/, '')}/action?${q}`;
}

/** Returns the verified action or null. */
function verifyAction(secret, query, nowMs = Date.now()) {
  const { u: uid, e: eventId, a: action, m, x, s } = query;
  if (!uid || !eventId || !action || !x || !s) return null;
  const minutes = Number(m) || 0;
  const exp = Number(x);
  if (!Number.isFinite(exp) || exp < nowMs) return null;
  if (!['finish', 'postpone', 'compress'].includes(action)) return null;
  const expected = sign(secret, actionPayload({ uid, eventId, action, minutes, exp }));
  return safeEqual(expected, s) ? { uid, eventId, action, minutes } : null;
}

function makeState(secret, uid, nowMs = Date.now()) {
  const exp = nowMs + 10 * 60 * 1000;
  return `${uid}.${exp}.${sign(secret, `state|${uid}|${exp}`)}`;
}

function verifyState(secret, state, nowMs = Date.now()) {
  const [uid, exp, sig] = String(state || '').split('.');
  if (!uid || !exp || !sig || Number(exp) < nowMs) return null;
  return safeEqual(sign(secret, `state|${uid}|${exp}`), sig) ? uid : null;
}

module.exports = { makeActionLink, verifyAction, makeState, verifyState };
