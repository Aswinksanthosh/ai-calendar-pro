# 📅 ai-calendar-pro

A fast, phone-first Google Calendar. Sign in with Google and see and edit your **real** calendar. Extra features get added one by one.

## What works now (v0.1)
- Google sign-in; no backend, the browser talks to Google Calendar directly
- **Month, week (3-day on phones) and day** views, "now" line, swipe left/right to change period
- **Create, edit, delete** events: title, all-day, start/end, location, description
- **Multiple calendars** with their Google colors and show/hide toggles (read-only calendars are respected)
- **Repeating events** (daily, weekly, monthly, yearly); editing or deleting a repeating event asks "this event" or "all events"
- **Reminders** (default, none, 10 min, 30 min, 1 hour, 1 day) delivered by Google
- Dark mode, installable as a home-screen app (PWA manifest)

Planned, one at a time: n8n-style auto-scheduling, AI suggestions, French study reminders, move events between calendars, custom repeat rules, offline mode.

## Setup
1. Create a **new Firebase project** at console.firebase.google.com (the free Spark plan is enough).
2. **Authentication → Sign-in method → Google**: enable it.
3. **Project settings → Your apps → Web app**: register one and paste its config into `public/firebase-config.js`. Put the project id in `.firebaserc`.
4. In **Google Cloud Console** (same project): enable the **Google Calendar API**. On *OAuth consent screen* add the scope `.../auth/calendar` and, while testing, add your Google account under *Test users*.
5. Deploy:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only hosting
   ```
   For local testing: `firebase serve --only hosting` or any static server on `public/` (add `localhost` under Authentication → Settings → Authorized domains).

## Going public
Calendar access is a *sensitive scope*. Until Google verifies the app, only your listed test users (max 100) can sign in and they see an "unverified app" warning. Verification needs a privacy policy page, a short demo video and a domain.

## How it works
`public/` is a static site (plain JS modules, no build step):

| File | Job |
|---|---|
| `dates.js` | date math, overlap layout, event form ⇄ Google API body (unit tested) |
| `api.js` | Google Calendar REST calls with the user's access token |
| `auth.js` | Firebase Google sign-in; the access token lasts about an hour and is kept in the tab's sessionStorage |
| `views.js`, `dialog.js`, `app.js` | month / week / day drawing, event dialog, app logic |

When the token expires the app asks you to sign in again (one click).

## Tests
```bash
npm test      # 14 tests for the date, layout and event-body logic
```
The earlier n8n-style scheduler (Cloud Functions) was removed from `main` on purpose. It is still in git history, commit `cd087a9`, for when we add auto-scheduling back.
