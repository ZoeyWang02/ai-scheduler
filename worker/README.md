# PlanTriz on Cloudflare Workers (free tier)

The Spring Boot backend rewritten as a Cloudflare Worker + D1 (SQLite), so the whole app can run on
Cloudflare's free plan. The Worker serves the existing frontend (`../frontend`) as static assets and
answers `/api/*`, so the browser talks to one origin exactly as it does with the Java jar.
The Java backend is unchanged and remains the reference for local development.

## Status

| Phase | Area | State |
|---|---|---|
| 1 | Sign-up / sign-in, preferences, time zone, tasks (create, edit, colour, complete, delete), course list/delete, Study Buddy state, time-zone list, static frontend | done, tested |
| 2 | Import: `.ics` timetables, Canvas / Coursera JSON, unknown JSON, **PDF / Word / text documents read by the AI**, preview + confirm, and an **import button in the chat** | done, tested |
| 3 | AI chat (with the conversation so far), translate, study-rhythm analysis | done, tested (also with the real model) |
| 4 | Sign in with Google, password reset by e-mail, custom domain `www.plantriz.com`, deploy guide | code done and tested; the deploy itself needs your Cloudflare login, see [DEPLOY.md](DEPLOY.md) |

Only the old direct-upload endpoints (`/api/tasks/upload/*`, `/api/courses/upload/ics`; the UI no longer uses them) answer
`501`. See [`../TODO.md`](../TODO.md) for what is left.

## Run locally (no Cloudflare account needed)

```bash
cd worker
npm install
npm run migrate:local     # creates the local D1 database from migrations/
npm run dev               # http://localhost:8787  (frontend + API)
                          # (--host localhost:8787 keeps the Worker from believing it is at www.plantriz.com,
                          #  the route in wrangler.jsonc, which would break the Google sign-in redirect locally)
```

Tests:

```bash
npm test                  # unit tests: time zones, ICS, import, documents, chat prompt, rhythm analysis, buddy XP, hashing
npm run typecheck
npm run smoke             # end-to-end API checks against the running dev server (no API key needed)
npm run smoke:ai          # document import, chat and translate end to end with a fake LLM and a throw-away database
node scripts/mock-stack.mjs   # keep that fake-LLM stack running (http://127.0.0.1:8790) for browser testing
```

To use the real AI locally, put `LLM_API_KEY=...` in `worker/.dev.vars` (git-ignored). Optional:
`LLM_MODEL`, `LLM_FALLBACK_MODEL`, `LLM_API_URL` (defaults match the Java backend: Groq, `openai/gpt-oss-120b`,
falling back to `openai/gpt-oss-20b` on HTTP 429).

## Importing

`POST /api/import/preview` takes a file (multipart) and `POST /api/import/preview-text` takes the text of a
document (JSON `{fileName, text}`); both return the same preview, and `POST /api/import/confirm` writes the
items the user ticked. A preview is stored in D1 between the two calls (the Java backend kept it in memory)
and deleted after confirming or after an hour.

| File | How it is read | Result |
|---|---|---|
| `.ics` | parsed on the Worker; weekly rules expanded (UNTIL, COUNT, INTERVAL, EXDATE, BYDAY) in the event's own zone | class sessions |
| Canvas / Coursera `.json` | parsed on the Worker; stable keys, so a moved deadline is an *update*, not a duplicate | tasks |
| other `.json` | AI cleanup, or a heuristic when there is no AI | tasks |
| `.pdf`, `.docx`, `.txt`, `.md` | **text is extracted in the browser** (pdf.js from a CDN, a small built-in DOCX reader), then the AI picks out tasks and sessions | tasks and sessions |

Why documents are read in the browser: parsing a PDF or DOCX would blow Workers Free's 10 ms CPU limit, and
only text then leaves the machine. The model sees at most ~14,000 characters and is told today's date, the
user's time zone and a 14-day calendar; each item keeps a short quote from the document so it can be checked.
A scanned PDF (an image of text) has no text to read and is reported as such.

The preview marks every item as new / already added / deadline changed, and past items are left unticked.
Matching works on the user's existing data read in two queries (D1 Free allows 50 queries per request, and
a `batch()` counts as one), and confirming writes in batches.

In the chat, the paperclip next to the message box takes any of these files, shows what it found as a card
with checkboxes, and adds nothing to the calendar until **Import selected** is pressed.

## Differences from the Java backend (on purpose)

- **Password hashing is cheaper.** Workers Free gives 10 ms of CPU per request. The Java backend uses
  210,000 PBKDF2 iterations (~28 ms on a laptop); the Worker defaults to 30,000 (~4 ms), set by
  `PBKDF2_ITERATIONS` in `wrangler.jsonc`. The stored format is the same (`pbkdf2$iterations$salt$hash`)
  and every hash records its own count, so raising it later does not lock anyone out. Measure on the
  deployed Worker before raising it; the Paid plan removes the 10 ms limit.
- **Password reset sends a real e-mail** (Resend's HTTP API; the Java backend only printed the code to its log).
  Codes are 6 digits, valid 10 minutes, one a minute per address, at most 5 wrong guesses; only a hash is stored;
  the answer is the same for unknown addresses; a successful reset signs the account out everywhere. Without
  e-mail settings the request answers 501 (set `PASSWORD_RESET_DEV_LOG=true` in `.dev.vars` to print codes locally).
- **Sign in with Google is stateless.** The OAuth `state` is a signed, expiring token and a nonce cookie ties the
  callback to the browser that started it; an address Google has not verified is refused. Needs `GOOGLE_CLIENT_ID`
  and `GOOGLE_CLIENT_SECRET`.
- **A better `.ics` reader.** Folded lines, escaped text, COUNT, INTERVAL and EXDATE are handled; the Java
  version ignored them. Occurrences are computed in the event's own time zone.
- **Chat and analysis follow the Java prompt word for word**, with these differences: tasks in the prompt are
  shown in the user's own time zone (Java printed UTC next to a local "current time"); the busy-time line is
  in the chat's language (Java always used Chinese); the rhythm analysis also reads "Estimated: 2 h" and
  "Estimated time: 1.5 hours" from descriptions (Java's pattern was case-sensitive and missed them) and
  gives the deep-focus advice in Chinese (Java compared against a label it never produces).
- **Document import (PDF / Word / text) exists only here.** The Java backend has no `/api/import/preview-text`,
  so with it the dialog and the chat button still work for `.ics` / `.json` but report an error for documents.
- **Same API contract otherwise.** Status codes, plain-text vs JSON bodies and date formats follow the Java
  controllers, so the frontend needs almost no changes (`config.js` now uses same-origin URLs everywhere
  except the `:8099` static preview).

## Free-tier limits worth knowing

Workers Free: 100,000 requests/day, 10 ms CPU/request, 50 subrequests. D1 Free: 5 M rows read and
100 k rows written per day, 5 GB, 50 queries per request. Past a daily limit the API returns errors until
00:00 UTC (no charge). The AI provider has its own limits (Groq's free tier counts tokens per minute per model).
