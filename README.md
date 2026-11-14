# YTailor

A distraction-free YouTube subscriptions page: the last *N* videos from your favourite channels on top, then every recent video from your subscriptions. Shorts are hidden, live streams are kept. Each video has a **+** button to add it to the top or bottom of one of your playlists, and a clock icon on its thumbnail that saves it to your Watch Later playlist in one tap.

Static site, no backend. It uses the official YouTube Data API with your own Google sign-in.

## Try it without any setup

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:5180/?demo> for sample data.

## One-time Google setup (about 15 minutes)

1. Go to <https://console.cloud.google.com/> and create a project.
2. **APIs & Services → Library**: enable **YouTube Data API v3** and **Google Drive API** (Drive is only used to sync your settings).
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): user type **External**, fill in the app name and your email. Under **Audience → Test users**, add your own Google account. Leave the app in *Testing*; no verification is needed for personal use.
4. **Data access → Add scopes**: add `https://www.googleapis.com/auth/youtube` and `https://www.googleapis.com/auth/drive.appdata`.
5. **Clients → Create client**: type **Web application**. Under **Authorised JavaScript origins** add:
   - `http://localhost:5180`
   - your hosted origin, e.g. `https://<user>.github.io` (origin only, no path)
6. Copy the client ID into `.env`:

   ```
   VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   ```

   The client ID is not a secret. There is no client secret in this app.

The first sign-in shows a "Google hasn't verified this app" warning; choose *Continue*. That is expected for a personal, unverified app.

## Use on your phone (GitHub Pages)

1. Push this repo to GitHub (branch `main`).
2. **Settings → Pages → Source**: *GitHub Actions*.
3. **Settings → Secrets and variables → Actions → Variables**: add `GOOGLE_CLIENT_ID` with your client ID.
4. The included workflow builds and deploys on every push. Add the Pages origin to the OAuth client (step 5 above).

Favourites and rules sync between devices automatically (see *Settings sync* below).

## Playlist rules

**Settings → Rules** lets you say "new videos from this channel whose title starts with X go to the top (or bottom) of that playlist". Rules run in the browser after every feed refresh while you are signed in, or on demand with **Run rules now**; nothing runs while the page is closed.

- A new rule starts with videos from the last 24 hours, then picks up everything new since its last run.
- Catch-up is limited to what the feed holds: the latest 10 videos per channel, up to 30 days back.
- A video is never added twice: each rule remembers what it handled and checks the playlist first.
- Each add costs 50 quota units; one run adds at most 20 videos and leaves the rest for the next run.
- Rules sync between devices together with favourites.

## Settings sync

Favourites, rules and the per-channel count are saved to a hidden app-data folder in your Google Drive, so PC and phone share them. The app cannot see any of your other Drive files, and the file does not appear in your Drive.

- Sync runs at start-up, after sign-in, a couple of seconds after any change, and when you return to an open tab. **Settings** shows the status and a *Sync now* link.
- The most recently changed copy wins as a whole. Videos a rule already handled are merged from both sides, so nothing is added twice.
- If you set the app up before sync existed: enable the Drive API and add the scope (steps 2 and 4 above), then sign out and sign in again and leave the Drive box ticked.
- Unticking the Drive box at sign-in simply turns sync off; everything else keeps working, and export/import still exists.

## Limits worth knowing

- **YouTube's own Watch Later cannot be used.** YouTube blocks it for all third-party apps. The clock icon therefore adds to a normal playlist of your choice: it asks which one on first use, and **Settings → Favourites** changes it. A video already in that playlist is not added twice.
- **Quota:** 10,000 units a day. A full refresh costs about 2 units per subscribed channel; each playlist add costs 50. The footer shows today's estimate. The feed is cached and auto-refreshes at most every 30 minutes.
- **Adding to the top** only works on playlists with manual ordering (the default).
- **Sign-in lasts about an hour**; after that, tap *Sign in* again (no consent screen the second time). The cached feed stays visible while signed out.
- **Shorts filtering** relies on YouTube's per-channel `UULF…` (videos) and `UULV…` (live) playlists. They work reliably but are not officially documented.

## Terms

This app only uses the official API, links to youtube.com for playback, and keeps cached data for at most 30 days, in line with the YouTube API Services Terms. If you ever share it publicly, avoid "YouTube"/"YT" in its name and get the OAuth app verified.

## Scripts

- `npm run dev` – local dev server
- `npm test` – unit tests
- `npm run build` – type-check and build to `dist/`
