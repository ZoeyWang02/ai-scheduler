# TODO

What is not done yet, grouped by when it matters. Everything below was checked against the code on branch
`cloudflare-worker` (the Worker backend in `worker/`, all four phases written and tested). Items marked
**(you)** need your accounts or a decision.

## 1. To get it online (blocking) — see `worker/DEPLOY.md`

- [ ] **(you)** `npx wrangler login`, then create the D1 database, apply the migrations, `wrangler deploy`, add
      the secrets.
- [ ] **(you)** Attach `www.plantriz.com` (already in `wrangler.jsonc`) and redirect the apex `plantriz.com` to it.
- [ ] **(you)** Google OAuth client (Google sign-in) and a Resend domain (password-reset e-mails). Both are optional;
      without them the buttons answer "not configured".
- [ ] Measure the password-hashing cost on the deployed Worker and tune `PBKDF2_ITERATIONS`. 30000 is a guess from
      local timings (~4 ms); Workers Free allows 10 ms of CPU per request, and an overrun is an Error 1102.
      An alternative is `wrangler deploy --temporary` (a throw-away preview account, no login) to measure first;
      not done because it publishes the code at a temporary public address.
- [ ] Copy existing users, tasks and course sessions from the Java/Postgres database into D1. Password hashes use the
      same format, so a one-off export script would do. Nothing is carried over today.
- [ ] Re-record the demo video against the deployed site and update the README (it predates the chat import
      button, document reading and the Worker).
- [ ] Mention the Worker build in the root `README.md` and in the Railway guide `DEPLOY.md`.

## 2. Before inviting other people (security and abuse)

The site will be public and every AI call spends your Groq quota, so these matter more than new features.

- [ ] **Nothing limits requests.** Chat works for guests (no sign-in), sign-up is open, and AI calls use one shared key
      (Groq's free tier counts tokens per minute per model, for everyone together). Anyone can exhaust it. Add:
      require sign-in for chat, a per-user daily AI allowance, Cloudflare rate-limiting / WAF rules on `/api/*`,
      and Turnstile (free) on sign-up.
- [ ] **No brute-force protection on sign-in**, and the password policy is only "at least 6 characters". Add attempt
      limits and consider a stronger minimum.
- [ ] **Session tokens are in the URL** (`?authToken=...`): they end up in browser history, proxy and CDN logs and
      `wrangler tail`. Move them to an `Authorization` header (frontend plus both backends). This is also why
      persistent Workers Logs are switched off.
- [ ] **Sessions never expire** and signing out only clears the browser (the token stays valid until the next
      sign-in). Add an expiry and a server-side sign-out.
- [x] ~~No security headers; libraries loaded from public CDNs.~~ Done: libraries are vendored (pinned versions, licences),
      inline handlers replaced by delegated `data-click` actions, and `frontend/_headers` sets a strict CSP (scripts from
      this site only). The Java backend does not send these headers yet (add a filter, or serve through the Worker).
- [ ] Privacy basics for a public site: a way to delete an account and export its data, and a short privacy note
      (the AI provider receives chat text and document text).

## 3. Requested, not done

### Read scanned PDFs, screenshots and photos (OCR)
Today a PDF with no selectable text (a scan) is rejected with "No text was found", and image files are not accepted
at all. Students will often have a screenshot of a timetable or a photo of a printed syllabus.

- **A. OCR in the browser with Tesseract.js (recommended first step).** Free, no quota, nothing uploaded. Run it only
  when a PDF yields no text, or for `.png` / `.jpg` / `.webp`; render PDF pages to canvases with pdf.js (already
  used), OCR the first ~5 pages, then send the text through the existing `/api/import/preview-text` path. Load
  Tesseract lazily. English data is ~2 MB, Chinese is much larger (downloaded on first use, then cached); accuracy
  on Chinese and tables is only fair, so the preview card matters. Needs: UI text for "recognising text...", a page
  limit, tests with a generated scanned PDF and a timetable screenshot.
- **B. A vision model (optional upgrade).** Render pages to images and ask a vision-capable model for the JSON directly
  (better layout and Chinese). Groq's Llama 4 Scout takes up to 5 images per request, but its current free limits
  could not be confirmed and one source suggested it may be retired; Workers AI has a shared free pool of 10,000
  neurons a day, with the vision models' cost not yet checked. Verify before building on either.

Acceptance: a scanned syllabus PDF and a PNG of a timetable each produce a preview with sensible items.

### Java backend parity
- [ ] `POST /api/import/preview-text` (PDF / Word / text read by the AI) exists only in the Worker. With the Java backend
      the dialog and the chat button work for `.ics` / `.json` but fail for documents. Port `parseDocumentText` (prompt
      in `worker/src/importers.ts`) to `UnifiedImportService` / `AiService`.
- [ ] Treat an empty `timezone` parameter as the default (the Worker does; the page asks with `timezone=` for a moment
      after a Google sign-in).

## 4. Improvements noticed

- [ ] **Long documents:** only the first ~14,000 characters go to the model (it says so). Read a long syllabus in
      pieces and merge the results.
- [ ] **Recurring classes from documents:** a weekly lecture comes back as one preview row per meeting for the next
      14 days. One recurring row (like the `.ics` path) would be shorter to review.
- [ ] Titles from documents sometimes mix languages ("概率论 Lecture"); the prompt asks for one language but the model
      does not always comply.
- [ ] Upgrade stored password hashes to the current iteration count when a user signs in (Java does this for legacy
      hashes), once `PBKDF2_ITERATIONS` is tuned.
- [ ] **Tests and CI:** no CI runs anything. Add a GitHub Actions workflow for `npm run typecheck`, `npm test` and
      `npm run smoke:ai` in `worker/`. The browser checks I ran (chat import, Google sign-in, rhythm panel) live
      outside the repo; turn them into committed Playwright tests (`tools/record_demo.py` already drives the app).
- [ ] Java: three integration tests (`Phase1PreferencesAndTaskCompletionTests`) fail without a database password in the
      shell; make them independent of local configuration.
- [ ] Old direct-upload endpoints (`/api/tasks/upload/*`, `/api/courses/upload/ics`) are not used by the UI and not ported
      to the Worker; remove them from the Java backend too.
- [ ] Word `.doc` (old binary format), PowerPoint and Excel files are not read; the UI says so.
- [ ] Workers Free and D1 Free limits are generous for this app but real (100,000 requests/day, 5 M row reads and
      100 k row writes/day); watch usage once other people use it.

## 5. Known problems (already there)

- **Java:** `LifestyleAnalysisService.buildRecommendation` compares the focus style with `"长块深度专注"`, but the label it
  produces is `"长时间深度专注"`, so Chinese users never get the deep-focus advice. (Fixed in the Worker.)
- **Java:** `AiService.chat` builds the busy-time context with the Chinese default ("暂无课程表数据。") even for English
  chats, prints task deadlines in UTC next to a local "current time", and its hours pattern is case-sensitive and misses
  "Estimated: 2 h". (All three fixed in the Worker.)
- **Frontend:** `loadTasks` stores a non-array when the API answers with an error (for example an expired token) and
  `todayBand.computeMetrics` then throws `tasks.forEach is not a function`.
- **Frontend:** chat history lives in `localStorage` only (no sync between devices).
- **Frontend:** the native `datetime-local` control shows the browser's own locale text.
- **Frontend:** pixel art is only crisp at devicePixelRatio 1 and 2.
- **Frontend:** unused legacy styles remain in `components.css`.
- **Naming:** storage keys and events still use the old name (`nexusUser`, `nexusChats:*`, `nexus:today-refresh`); renaming
  them would log everyone out and drop saved chats unless migrated.
