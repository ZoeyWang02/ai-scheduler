import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static checks on the shipped frontend: it must keep working under the Content-Security-Policy in
// frontend/_headers, which allows scripts from this site only and no inline handlers.

const FRONTEND = join(__dirname, "../../frontend");
const read = (file: string) => readFileSync(join(FRONTEND, file), "utf8");
const html = read("index.html");
const headers = read("_headers");
const jsFiles = readdirSync(join(FRONTEND, "js")).filter((f) => f.endsWith(".js"));

const directive = (name: string) => {
  // the header line itself (indented), not the "# Content-Security-Policy: ..." comment above it
  const csp = /^[ \t]+Content-Security-Policy:\s*(.+)$/m.exec(headers)![1];
  const found = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ") || d === name);
  return found ? found.slice(name.length).trim().split(/\s+/).filter(Boolean) : null;
};

describe("index.html", () => {
  it("has no inline event handlers and no inline scripts", () => {
    expect(html.match(/\son[a-z]+\s*=/gi) ?? []).toEqual([]);
    expect(html.match(/<script(?![^>]*\ssrc=)[^>]*>/gi) ?? []).toEqual([]);
    expect(html).not.toMatch(/javascript:/i);
  });

  it("loads every script and stylesheet from this site", () => {
    const urls = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/gi)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(10);
    for (const url of urls) expect(url, url).not.toMatch(/^(https?:)?\/\//i);
  });

  it("only references files that exist (vendored libraries, styles, scripts)", () => {
    const local = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/gi)].map((m) => m[1]).filter((u) => !u.startsWith("#"));
    for (const url of local) expect(existsSync(join(FRONTEND, url)), url).toBe(true);
  });

  it("ships a licence for every vendored library", () => {
    for (const dir of readdirSync(join(FRONTEND, "vendor"))) {
      const name = dir.replace(/-[\d.]+$/, "").replace(/^popper$/, "popperjs").replace(/^tippy$/, "tippyjs");
      expect(existsSync(join(FRONTEND, "licenses", `${name}-LICENSE.txt`)), `licenses/${name}-LICENSE.txt`).toBe(true);
    }
  });
});

describe("delegated actions", () => {
  const registry = new Set([...read("js/app.js").matchAll(/^const actions = \{([\s\S]*?)^\};/gm)].flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean)));
  const used = new Set([html, ...jsFiles.map((f) => read(`js/${f}`))].flatMap((text) => [...text.matchAll(/data-(?:click|change|enter)="([A-Za-z]+)"/g)].map((m) => m[1])));

  it("registers more than a handful of actions", () => {
    expect(registry.size).toBeGreaterThan(30);
    expect(used.size).toBeGreaterThan(30);
  });

  it("registers every action the markup (and the markup JavaScript generates) uses", () => {
    expect([...used].filter((name) => !registry.has(name))).toEqual([]);
  });

  it("no script writes inline handlers into the page", () => {
    for (const file of jsFiles) expect(read(`js/${file}`).replace(/\/\/.*$/gm, "").match(/\son(click|change|input|keydown|keyup|submit|load|error)\s*=\s*["'`]/g) ?? [], file).toEqual([]);
  });
});

describe("Content-Security-Policy in _headers", () => {
  it("allows scripts from this site only", () => {
    expect(directive("script-src")).toEqual(["'self'"]);
    expect(directive("default-src")).toEqual(["'none'"]);
    expect(directive("worker-src")).toEqual(["'self'"]);
  });

  it("forbids framing, plugins and a changed <base>", () => {
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
    expect(directive("base-uri")).toEqual(["'none'"]);
  });

  it("lets the page talk only to itself and the AI providers a user can choose", () => {
    expect(directive("connect-src")!.sort()).toEqual([
      "'self'", "https://api.deepseek.com", "https://api.groq.com", "https://api.openai.com", "https://generativelanguage.googleapis.com", "https://openrouter.ai",
    ].sort());
  });

  it("sends the other protective headers", () => {
    for (const h of ["X-Content-Type-Options: nosniff", "X-Frame-Options: DENY", "Referrer-Policy: no-referrer", "Cross-Origin-Opener-Policy: same-origin"]) expect(headers).toContain(h);
    expect(headers).toMatch(/\/vendor\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
  });

  it("does not weaken script rules anywhere", () => {
    const scriptSrc = (directive("script-src") ?? []).join(" ");
    expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
  });
});

describe("AI key settings", () => {
  const i18n = read("js/i18n.js");
  const keysUsed = new Set([
    ...[...html.matchAll(/data-i18n(?:-placeholder|-title)?="(ai[A-Za-z]+|statusOwnKey)"/g)].map((m) => m[1]),
    ...["js/llmClient.js", "js/aiSettings.js"].flatMap((f) => [...read(f).matchAll(/dict(?:ionary\(\))?\.(ai[A-Za-z]+|statusOwnKey)\b/g)].map((m) => m[1])),
  ]);

  it("every text it shows exists in both languages", () => {
    expect(keysUsed.size).toBeGreaterThan(20);
    for (const key of keysUsed) expect(i18n.split(`${key}:`).length - 1, key).toBe(2);
  });

  it("only talks to providers the policy allows, and never puts the key in a URL", () => {
    const client = read("js/llmClient.js");
    expect(client).not.toMatch(/\?key=|[?&]api[_-]?key=|apiKey\s*\}\s*@/i);
    expect(client).toMatch(/Authorization: `Bearer \$\{apiKey\}`/);
    for (const m of client.matchAll(/url: '(https:\/\/[^']+)'/g)) expect(headers).toContain(new URL(m[1]).origin);
  });

  it("the settings page has the fields the script reads", () => {
    for (const id of ["aiProviderSelect", "aiKeyInput", "aiModelInput", "aiRememberCheck", "aiTestBtn", "aiKeyStatus", "aiKeyLink"]) expect(html, id).toContain(`id="${id}"`);
    expect(html).toMatch(/id="aiKeyInput"[^>]*type="password"|type="password"[^>]*id="aiKeyInput"/);
  });
});
