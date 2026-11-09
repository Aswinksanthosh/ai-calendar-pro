# 📅 ai-calendar-pro

Google Calendar that schedules itself. Create an **all-day** event such as `Gym`, and the app turns it into a timed event at the best free slot, using your rules. Built on Firebase.

Rebuilt from my n8n [Auto-Scheduler](https://github.com/Aswinksanthosh/n8n-AutoScheduling) so anyone can use it with their own Google account.

## v1 features
- Google sign-in, and one-click "Allow" access to your own calendar (no API keys for users)
- Rules stored in Firestore and edited on a web page: ideal time, duration, priority, movable or fixed, day-specific times, buffers, time window
- Scheduler runs every 5 minutes: tries the ideal time, then searches in 15-minute steps
- Dependencies: "Gym after Work", "keep 4h away from Sleep"
- Duplicate prevention, per-user timezone, never schedules in the past
- FINISH / POSTPONE / COMPRESS links inside each event description (signed, expire after 14 days)
- Next-7-days view on the page

Planned: AI suggestions (v2), French study reminders (v3), description commands and two-way description sync.

## How it works
```
Browser (Hosting) ──Firestore── rules, profile
      │  callable functions
      ▼
Cloud Functions ── Google Calendar API (user's refresh token, kept server-side only)
   scheduler (every 5 min) · scheduleNow · listUpcoming · connectUrl
   oauthCallback (/oauthCallback) · action (/action)
```
The scheduling engine (`functions/lib/scheduler.js`) is pure code with unit tests.

## Setup
1. **Firebase project:** create a new one at console.firebase.google.com. Upgrade to **Blaze** (needed for scheduled functions). Enable **Authentication → Google** and **Firestore**.
2. **Web app config:** add a Web app, then paste its config into `public/firebase-config.js`. Put your project id in `.firebaserc`.
3. **Google Cloud (same project):** enable the **Google Calendar API**. On *APIs & Services → OAuth consent screen* add the scope `calendar.events`. Under *Credentials* create an **OAuth client ID (Web)** with the redirect URI `https://YOUR-PROJECT-ID.web.app/oauthCallback`.
4. **Secrets:**
   ```bash
   firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_ID
   firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
   firebase functions:secrets:set WEBHOOK_SIGNING_SECRET   # any long random string
   cp functions/.env.example functions/.env.YOUR-PROJECT-ID   # set APP_URL
   ```
5. **Deploy:**
   ```bash
   cd functions && npm install && npm test && cd ..
   firebase deploy
   ```

## Using it
1. Sign in, click **Connect Google Calendar**, then **Allow**.
2. Add a rule, e.g. `Gym`, ideal time `3pm`, duration `1h`.
3. In Google Calendar create an all-day event called `Gym`. Within 5 minutes (or press **Run scheduler now**) a timed event appears.

## Going public
Calendar access is a *sensitive scope*. Until Google verifies the app, up to 100 test users can sign in (add them on the OAuth consent screen) and will see an "unverified app" warning. Verification needs a privacy policy page, a demo video and a domain.

## Security notes
- Refresh tokens live in `users/{uid}/private/tokens`, which Firestore rules block from every browser.
- Action links are HMAC-signed and expire. They change a calendar on click (GET), so don't forward event descriptions.
- Never commit secrets. `.env*` files are git-ignored (except `.env.example`).

## Tests
`cd functions && npm test` runs 17 tests: time and timezone handling, the slot-finder, dependencies, buffers, duplicate prevention, signed links and the calendar actions (against a fake calendar).
