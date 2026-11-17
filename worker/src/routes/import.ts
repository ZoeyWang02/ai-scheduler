import { Hono } from "hono";

import { AuthError, numberOrNull, requireUser } from "../auth";
import type { Env } from "../env";
import { confirmImport, createPreview, ImportExpiredError, previewForClient } from "../importService";
import { documentMessages, parseDocumentText, parsedFromDocumentReply, parseStructuredFile } from "../importers";
import { isLlmConfigured, LlmError } from "../llm";
import { quotaMessage, takeAiAllowance } from "../quota";

export const importRoutes = new Hono<{ Bindings: Env }>();

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;
const DEFAULT_TZ = "America/Chicago";

const fail = (c: { json: (b: unknown, s: 400 | 401 | 413 | 429 | 502 | 503) => Response }, status: 400 | 401 | 413 | 429 | 502 | 503, message: string, code?: string) =>
  c.json(code ? { message, code } : { message }, status);

/** A .ics / Canvas / Coursera / JSON file, uploaded as multipart form data. */
importRoutes.post("/preview", async (c) => {
  let userId: number;
  try {
    userId = (await requireUser(c.env.DB, numberOrNull(c.req.query("userId")), c.req.query("authToken"))).id;
  } catch (e) {
    if (e instanceof AuthError) return fail(c, 401, e.message);
    throw e;
  }
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return fail(c, 400, "Please select a file to import.");
    if (file.size === 0) return fail(c, 400, "Please select a file to import.");
    if (file.size > MAX_FILE_BYTES) return fail(c, 413, "This file is too large to import (the limit is 2 MB).");
    if (/\.(pdf|docx?|pptx?|xlsx?)$/i.test(file.name)) {
      return fail(c, 400, "PDF and Word files are read in the browser and sent as text to /api/import/preview-text.");
    }
    const parsed = await parseStructuredFile(c.env, file.name || "upload", await file.text(), c.req.query("timezone") || DEFAULT_TZ);
    return c.json(previewForClient(await createPreview(c.env.DB, userId, file.name || "upload", parsed)));
  } catch (e) {
    return fail(c, 400, `Import preview failed: ${(e as Error).message}`);
  }
});

/** The text of a PDF / Word / plain-text document, read by the AI. The browser extracts the text:
 *  parsing PDFs and DOCX inside a free-plan Worker would blow its 10 ms CPU budget. */
importRoutes.post("/preview-text", async (c) => {
  let userId: number;
  try {
    userId = (await requireUser(c.env.DB, numberOrNull(c.req.query("userId")), c.req.query("authToken"))).id;
  } catch (e) {
    if (e instanceof AuthError) return fail(c, 401, e.message);
    throw e;
  }
  const body = (await c.req.json().catch(() => ({}))) as { fileName?: unknown; text?: unknown };
  const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : "document";
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return fail(c, 400, "The document has no text to read.");
  if (text.length > MAX_TEXT_CHARS) return fail(c, 413, "This document is too large to read.");
  if (!isLlmConfigured(c.env)) return fail(c, 503, "The AI service is not configured, so documents cannot be read.");

  try {
    const allowance = await takeAiAllowance(c.env, userId);
    if (!allowance.ok) return fail(c, 429, quotaMessage(allowance.limit), "ai_quota");
    const parsed = await parseDocumentText(c.env, fileName, text, c.req.query("timezone") || DEFAULT_TZ);
    return c.json(previewForClient(await createPreview(c.env.DB, userId, fileName, parsed)));
  } catch (e) {
    if (e instanceof LlmError) {
      return e.status === 429
        ? fail(c, 429, "The AI service is busy. Please try again in a few seconds.")
        : fail(c, 502, "The AI service could not read this document. Please try again.");
    }
    return fail(c, 400, `Import preview failed: ${(e as Error).message}`);
  }
});

/** For people who bring their own API key: the messages the browser sends to its provider to read a document.
 *  Nothing is sent to any AI from here. */
importRoutes.post("/document-prompt", async (c) => {
  try {
    await requireUser(c.env.DB, numberOrNull(c.req.query("userId")), c.req.query("authToken"));
  } catch (e) {
    if (e instanceof AuthError) return fail(c, 401, e.message);
    throw e;
  }
  const body = (await c.req.json().catch(() => ({}))) as { fileName?: unknown; text?: unknown };
  const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : "document";
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return fail(c, 400, "The document has no text to read.");
  if (text.length > MAX_TEXT_CHARS) return fail(c, 413, "This document is too large to read.");
  try {
    return c.json(documentMessages(fileName, text, c.req.query("timezone") || DEFAULT_TZ));
  } catch (e) {
    return fail(c, 400, `Import preview failed: ${(e as Error).message}`);
  }
});

/** The provider's reply to /document-prompt, turned into a preview exactly as for a document read with the built-in AI. */
importRoutes.post("/preview-reply", async (c) => {
  let userId: number;
  try {
    userId = (await requireUser(c.env.DB, numberOrNull(c.req.query("userId")), c.req.query("authToken"))).id;
  } catch (e) {
    if (e instanceof AuthError) return fail(c, 401, e.message);
    throw e;
  }
  const body = (await c.req.json().catch(() => ({}))) as { fileName?: unknown; reply?: unknown; truncated?: unknown };
  const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : "document";
  const reply = typeof body.reply === "string" ? body.reply : "";
  if (!reply.trim()) return fail(c, 400, "The AI reply is empty.");
  if (reply.length > MAX_TEXT_CHARS) return fail(c, 413, "The AI reply is too large.");
  try {
    const parsed = parsedFromDocumentReply(reply, fileName, c.req.query("timezone") || DEFAULT_TZ, body.truncated === true);
    return c.json(previewForClient(await createPreview(c.env.DB, userId, fileName, parsed)));
  } catch (e) {
    return fail(c, 400, `Import preview failed: ${(e as Error).message}`);
  }
});

importRoutes.post("/confirm", async (c) => {
  let userId: number;
  try {
    userId = (await requireUser(c.env.DB, numberOrNull(c.req.query("userId")), c.req.query("authToken"))).id;
  } catch (e) {
    if (e instanceof AuthError) return fail(c, 401, e.message);
    throw e;
  }
  const body = (await c.req.json().catch(() => ({}))) as { importId?: unknown; itemIds?: unknown };
  if (typeof body.importId !== "string") return fail(c, 400, "importId is required.");
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((v): v is string => typeof v === "string") : null;
  try {
    return c.json(await confirmImport(c.env.DB, userId, body.importId, itemIds));
  } catch (e) {
    return fail(c, 400, e instanceof ImportExpiredError ? e.message : `Import failed: ${(e as Error).message}`);
  }
});
