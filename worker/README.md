# PlanTriz on Cloudflare Workers (free tier)

The Spring Boot backend rewritten as a Cloudflare Worker + D1 (SQLite), so the whole app can run on
Cloudflare's free plan. The Worker serves the existing frontend (`../frontend`) as static assets and
answers `/api/*`, so the browser talks to one origin exactly as it does with the Java jar.
The Java backend is unchanged and remains the reference for local development.

## Status

| Phase | Area | State |
|---|---|---|
| 1 | Sign-up / sign-in, preferences, time zone, tasks (create, edit, colour, complete, delete), course list/delete, Study Buddy state, time-zone list, static frontend | done, tested |
| 2 | Import: Canvas / Coursera JSON, `.ics` timetable (recurrence expansion), preview + confirm | not started |
| 3 | AI chat + translate, lifestyle analysis | not started |
| 4 | Google sign-in, password reset by e-mail, custom domain, deploy | not started |

Endpoints that are not ported yet answer `501 {"message": "...not available in the Worker build yet."}`.

## Run locally (no Cloudflare account needed)

```bash
cd worker
npm install
npm run migrate:local     # creates the local D1 database from migrations/
npm run dev               # http://localhost:8787  (frontend + API)
npm test                  # unit tests (time zones, buddy XP, password hashing)
npm run typecheck
npm run smoke             # end-to-end API checks against the running dev server
```

## Differences from the Java backend (on purpose)

- **Password hashing is cheaper.** Workers Free gives 10 ms of CPU per request. The Java backend uses
  210,000 PBKDF2 iterations (~28 ms on a laptop); the Worker defaults to 30,000 (~4 ms), set by
  `PBKDF2_ITERATIONS` in `wrangler.jsonc`. The stored format is the same (`pbkdf2$iterations$salt$hash`)
  and every hash records its own count, so raising it later does not lock anyone out. Measure on the
  deployed Worker before raising it; the Paid plan removes the 10 ms limit.
- **No password reset by e-mail yet.** The Java backend only printed the code to its log.
- **Same API contract.** Status codes, plain-text vs JSON bodies and date formats follow the Java
  controllers, so the frontend needs no changes (its only change: `config.js` now uses same-origin
  URLs everywhere except the `:8099` static preview).

## Free-tier limits worth knowing

Workers Free: 100,000 requests/day, 10 ms CPU/request, 50 subrequests. D1 Free: 5 M rows read and
100 k rows written per day, 5 GB. Past a daily limit the API returns errors until 00:00 UTC (no charge).
