# TODO

Things that were asked for or found but are not done yet. Newest first within each section.

## Requested, not done

### Read scanned PDFs, screenshots and photos (OCR)
Today a PDF with no selectable text (a scan) is rejected with "No text was found", and image files are not
accepted at all. Students will often have a screenshot of a timetable or a photo of a printed syllabus.

Two free options were looked at:

- **A. OCR in the browser with Tesseract.js (recommended first step).** Free, no quota, nothing uploaded.
  Run it only when a PDF yields no text, or when the file is `.png` / `.jpg` / `.webp`; render PDF pages to
  canvases with pdf.js (already loaded for PDFs), OCR the first ~5 pages, then send the text through the
  existing `/api/import/preview-text` path. Load Tesseract lazily. English data is ~2 MB, Chinese is much
  larger (first use downloads it, then it is cached); accuracy on Chinese and tables is only fair, so the
  preview card matters. Needs: UI text for "recognising text in the image...", a page limit, tests with a
  generated scanned PDF and a timetable screenshot.
- **B. A vision model (optional upgrade).** Render pages to images and ask a vision-capable model for the
  JSON directly (better layout and Chinese). Groq's Llama 4 Scout takes up to 5 images per request, but its
  current free limits could not be confirmed and one source suggested it may be retired; Cloudflare Workers
  AI has a shared free pool of 10,000 neurons per day, with the vision models' cost not yet checked.
  Verify availability and limits before building on either.

Acceptance: a scanned syllabus PDF and a PNG of a timetable each produce a preview with sensible items.

### Document import on the Java backend
`POST /api/import/preview-text` (PDF / Word / text read by the AI) exists only in the Worker. With the Java
backend the dialog and the chat button still work for `.ics` / `.json` but fail for documents. Port
`parseDocumentText` (prompt in `worker/src/importers.ts`) to `UnifiedImportService` / `AiService`.

## Cloudflare Worker (branch `cloudflare-worker`)

- [ ] Phase 4: Google sign-in (OAuth with a signed `state`, since a Worker is stateless).
- [ ] Phase 4: password reset by e-mail (needs an outgoing e-mail service; the Java backend only logs the code).
- [ ] Deploy: `wrangler login`, `wrangler d1 create plantriz` (paste the id into `wrangler.jsonc`),
      `wrangler d1 migrations apply plantriz --remote`, `wrangler secret put LLM_API_KEY`,
      `wrangler deploy`, then attach `www.plantriz.com` as a custom domain.
- [ ] Measure password hashing on the deployed Worker and tune `PBKDF2_ITERATIONS` (30000 is a guess from
      local timings; Workers Free allows 10 ms CPU per request).
- [ ] Mention the Worker build in the root README and in DEPLOY.md.
- [ ] The old direct-upload endpoints (`/api/tasks/upload/*`, `/api/courses/upload/ics`) are not ported
      (the UI uses `/api/import/*`); remove them from the Java backend too or port them.
- [ ] Word `.doc` (old binary format), PowerPoint and Excel files are not read; say so in the UI (it does)
      or add support.

## Known problems

- **Java:** `LifestyleAnalysisService.buildRecommendation` compares the focus style with `"长块深度专注"`, but
  the label it produces is `"长时间深度专注"`, so Chinese users never get the deep-focus advice. (Fixed in the
  Worker; fix it in Java too.)
- **Java:** `AiService.chat` builds the busy-time context with the Chinese default ("暂无课程表数据。") even
  for English chats.
- **Frontend:** `loadTasks` stores a non-array when the API answers with an error (for example an expired
  token) and `todayBand.computeMetrics` then throws `tasks.forEach is not a function`.
- **Frontend:** chat history lives in `localStorage` only (no sync between devices).
- **Frontend:** the native `datetime-local` control shows the browser's own locale text.
- **Frontend:** pixel art is only crisp at devicePixelRatio 1 and 2.
- **Frontend:** unused legacy styles remain in `components.css`.
- **Naming:** storage keys and events still use the old name (`nexusUser`, `nexusChats:*`,
  `nexus:today-refresh`); renaming them would log everyone out and drop saved chats unless migrated.
