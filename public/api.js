// Google Calendar REST client. Runs in the browser with the signed-in user's access token.

const BASE = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;

export class AuthError extends Error {}

export function createApi(getToken) {
  async function req(path, { method = 'GET', params, body } = {}) {
    const token = getToken();
    if (!token) throw new AuthError('Please sign in again.');
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params || {})) if (v != null) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new AuthError('Your session expired. Please sign in again.');
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || `Google Calendar error (${res.status})`);
    return data;
  }

  return {
    async calendars() {
      const d = await req('/users/me/calendarList', { params: { minAccessRole: 'reader' } });
      return d.items || [];
    },
    async events(calId, timeMin, timeMax) {
      const items = [];
      let pageToken;
      do {
        const d = await req(`/calendars/${enc(calId)}/events`, {
          params: {
            timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
            singleEvents: 'true', orderBy: 'startTime', maxResults: '250', pageToken,
          },
        });
        items.push(...(d.items || []));
        pageToken = d.nextPageToken;
      } while (pageToken);
      return items.filter((e) => e.status !== 'cancelled');
    },
    get: (calId, id) => req(`/calendars/${enc(calId)}/events/${enc(id)}`),
    insert: (calId, body) => req(`/calendars/${enc(calId)}/events`, { method: 'POST', body }),
    patch: (calId, id, body) => req(`/calendars/${enc(calId)}/events/${enc(id)}`, { method: 'PATCH', body }),
    remove: (calId, id) => req(`/calendars/${enc(calId)}/events/${enc(id)}`, { method: 'DELETE' }),
  };
}
