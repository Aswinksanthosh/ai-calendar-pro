'use strict';
// Thin wrapper around the Google Calendar API using a user's stored refresh token.

const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

function oauthClient({ clientId, clientSecret, appUrl }) {
  return new google.auth.OAuth2(clientId, clientSecret, `${appUrl.replace(/\/$/, '')}/oauthCallback`);
}

function authUrl(client, state) {
  return client.generateAuthUrl({
    access_type: 'offline', // gives us a refresh token for the 5-minute scheduler
    prompt: 'consent',
    include_granted_scopes: true,
    scope: SCOPES,
    state,
  });
}

function calendarFor(client, refreshToken) {
  client.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: client });
}

async function listEvents(cal, timeMinMs, timeMaxMs) {
  const items = [];
  let pageToken;
  do {
    const res = await cal.events.list({
      calendarId: 'primary',
      timeMin: new Date(timeMinMs).toISOString(),
      timeMax: new Date(timeMaxMs).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken,
    });
    items.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items.filter((e) => e.status !== 'cancelled');
}

module.exports = { SCOPES, oauthClient, authUrl, calendarFor, listEvents };
