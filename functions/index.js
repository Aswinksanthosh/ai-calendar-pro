'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');

const gcal = require('./lib/gcal');
const { makeState, verifyState, verifyAction } = require('./lib/links');
const { loadTasks, scheduleUser, applyAction } = require('./lib/run');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const CLIENT_ID = defineSecret('GOOGLE_OAUTH_CLIENT_ID');
const CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');
const SIGNING = defineSecret('WEBHOOK_SIGNING_SECRET');
const APP_URL = defineString('APP_URL'); // e.g. https://your-project.web.app
const SECRETS = [CLIENT_ID, CLIENT_SECRET, SIGNING];

const client = () =>
  gcal.oauthClient({ clientId: CLIENT_ID.value(), clientSecret: CLIENT_SECRET.value(), appUrl: APP_URL.value() });

function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');
  return request.auth.uid;
}

async function calendarForUser(uid) {
  const tok = await db.doc(`users/${uid}/private/tokens`).get();
  if (!tok.exists || !tok.data().refreshToken) {
    throw new HttpsError('failed-precondition', 'Google Calendar is not connected yet.');
  }
  return gcal.calendarFor(client(), tok.data().refreshToken);
}

async function runUser(uid) {
  const userSnap = await db.doc(`users/${uid}`).get();
  const tz = (userSnap.exists && userSnap.data().timezone) || 'UTC';
  const cal = await calendarForUser(uid);
  const { taskMap, problems } = loadTasks(await db.collection(`users/${uid}/tasks`).get());
  const result = await scheduleUser({
    cal, tz, taskMap, uid, appUrl: APP_URL.value(), linkSecret: SIGNING.value(),
  });
  const summary = {
    at: admin.firestore.FieldValue.serverTimestamp(),
    created: result.created.length,
    skipped: result.skipped.slice(0, 20),
    ruleProblems: problems,
  };
  await db.doc(`users/${uid}`).set({ lastRun: summary }, { merge: true });
  return { ...summary, createdEvents: result.created };
}

// 1) Browser asks for the "Allow access" URL.
exports.connectUrl = onCall({ secrets: SECRETS }, (request) => {
  const uid = requireAuth(request);
  return { url: gcal.authUrl(client(), makeState(SIGNING.value(), uid)) };
});

// 2) Google sends the user back here (via Hosting rewrite /oauthCallback).
exports.oauthCallback = onRequest({ secrets: SECRETS }, async (req, res) => {
  try {
    const uid = verifyState(SIGNING.value(), req.query.state);
    if (!uid || !req.query.code) return res.status(400).send('Invalid or expired request. Please try again.');
    const { tokens } = await client().getToken(String(req.query.code));
    if (!tokens.refresh_token) return res.status(400).send('Google did not return offline access. Please try again.');
    await db.doc(`users/${uid}/private/tokens`).set({ refreshToken: tokens.refresh_token });
    await db.doc(`users/${uid}`).set({ connected: true }, { merge: true });
    return res.redirect(`${APP_URL.value()}/?connected=1`);
  } catch (err) {
    console.error('oauthCallback failed', err);
    return res.status(500).send('Could not connect Google Calendar.');
  }
});

// 3) "Run now" button.
exports.scheduleNow = onCall({ secrets: SECRETS, timeoutSeconds: 120 }, async (request) => {
  const uid = requireAuth(request);
  return runUser(uid);
});

// 4) Show upcoming events on the web page.
exports.listUpcoming = onCall({ secrets: SECRETS }, async (request) => {
  const uid = requireAuth(request);
  const cal = await calendarForUser(uid);
  const now = Date.now();
  const items = await gcal.listEvents(cal, now, now + 7 * 24 * 3600 * 1000);
  return {
    events: items.map((e) => ({
      id: e.id,
      title: e.summary || '(no title)',
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      allDay: !!e.start.date,
    })),
  };
});

// 5) Every 5 minutes for every connected user.
exports.scheduler = onSchedule({ schedule: 'every 5 minutes', secrets: SECRETS, timeoutSeconds: 540 }, async () => {
  const users = await db.collection('users').where('connected', '==', true).get();
  for (const doc of users.docs) {
    try {
      await runUser(doc.id);
    } catch (err) {
      console.error(`scheduler failed for ${doc.id}`, err.message);
    }
  }
});

// 6) FINISH / POSTPONE / COMPRESS links in event descriptions (via Hosting rewrite /action).
exports.action = onRequest({ secrets: SECRETS }, async (req, res) => {
  const page = (msg, code = 200) =>
    res.status(code).set('Content-Type', 'text/html; charset=utf-8').send(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ai-calendar-pro</title>` +
        `<body style="font-family:system-ui;text-align:center;padding:3rem"><h2>${msg}</h2><p>You can close this tab.</p></body>`,
    );
  const v = verifyAction(SIGNING.value(), req.query);
  if (!v) return page('This link is invalid or has expired.', 400);
  try {
    const cal = await calendarForUser(v.uid);
    return page(await applyAction(cal, v));
  } catch (err) {
    console.error('action failed', err.message);
    return page('Sorry, that did not work.', 500);
  }
});
