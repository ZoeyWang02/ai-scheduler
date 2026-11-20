# Deploying PlanTriz to Cloudflare (free plan) at www.plantriz.com

Everything below runs from the `worker/` folder. Steps marked **you** need your accounts or secrets; the rest
are commands to copy. Nothing here costs money on the free plans (Workers, D1, Cloudflare DNS, Resend's free
tier, Groq's free tier), apart from the domain you already own.

## 0. What you need

- The Cloudflare account that holds the `plantriz.com` zone (**you**).
- Node.js 18+ and `npm install` run once in `worker/`.
- A Groq API key for the AI features (the same one the Java backend uses).
- Optional: a Google OAuth client (sign in with Google) and a Resend account (password reset by e-mail).

## 1. Log in (you)

```bash
npx wrangler login      # opens a browser; approve the access request
npx wrangler whoami     # should now list your account
```

## 2. Create the database and apply the schema

```bash
npx wrangler d1 create plantriz
```

It prints a `database_id`. Paste it into `wrangler.jsonc` (replace `00000000-0000-0000-0000-000000000000`), then:

```bash
npx wrangler d1 migrations apply plantriz --remote
```

## 3. Deploy

```bash
npx wrangler deploy
```

This publishes the Worker and the frontend, answers on `https://plantriz.<your-subdomain>.workers.dev`, and
creates the custom domain `www.plantriz.com` (DNS record and certificate are added for you).

If it complains about the domain: a hostname that already has a CNAME record cannot become a custom domain.
Delete the `www` CNAME in the Cloudflare DNS page and deploy again.

## 4. Secrets (you)

Each command asks you to paste the value (it is not shown and not stored in git):

```bash
npx wrangler secret put LLM_API_KEY             # AI chat, translation, document reading
npx wrangler secret put GOOGLE_CLIENT_ID        # only for "Sign in with Google" (step 6)
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY          # only for password reset e-mails (step 7)
```

Check: `curl https://www.plantriz.com/api/ai/status` should answer `{"configured":true,"dailyLimit":40}`.

Everyone without their own key shares this one `LLM_API_KEY`, so each signed-in user gets `AI_DAILY_LIMIT` requests per
day (default 40; set a different number as a plain var in `wrangler.jsonc`, or `"0"` for no limit). Users can bring
their own key in Settings instead; that traffic never touches your key or your quota.

## 5. Make plantriz.com (without www) work

A custom domain matches one exact hostname. To send visitors from `plantriz.com` to `www.plantriz.com`:
in the Cloudflare dashboard open the zone, then **DNS** and add a *proxied* record `A  @  192.0.2.0`, then
**Rules, Redirect Rules** and create "plantriz.com to www": when the hostname equals `plantriz.com`, redirect
(301) to `https://www.plantriz.com${uri}`.

## 6. Sign in with Google (optional, you)

1. Google Cloud Console, **APIs and Services, Credentials, Create credentials, OAuth client ID**, type *Web application*.
2. Authorized JavaScript origin: `https://www.plantriz.com`
3. Authorized redirect URI: `https://www.plantriz.com/api/auth/oauth/google/callback`
4. Put the client id and secret in with `wrangler secret put` (step 4). No redeploy is needed.

While the app is in Google's "Testing" mode only the test users you list can sign in; publish it to allow everyone.

## 7. Password reset e-mails (optional, you)

1. Create a Resend account, **Domains, Add domain** `plantriz.com`, and add the DNS records it shows
   (in the Cloudflare DNS page) until it says *Verified*.
2. **API Keys**, create one with "Sending access" and `wrangler secret put RESEND_API_KEY`.
3. In `wrangler.jsonc` add under `vars`: `"EMAIL_FROM": "PlanTriz <noreply@plantriz.com>"`, then `npx wrangler deploy`.

Resend's free plan allowed about 100 e-mails a day when this was written; check their pricing page.
Until this is set up, "Forgot password" answers that e-mail reset is not set up (it never prints codes).

## 8. Check it, and check the password-hashing cost

```bash
node scripts/smoke.mjs https://www.plantriz.com     # creates a few throw-away test users in the live database
```

Workers Free allows 10 ms of CPU per request, and signing up and signing in hash the password (the one expensive
step). `PBKDF2_ITERATIONS` is 30000, a guess from local timings (about 4 ms). To see the real number, run
`npx wrangler tail --format json` in one terminal, sign in on the site, and read `cpuTime` (milliseconds) in the
`/api/auth/signin` event. The dashboard (**Workers, plantriz, Metrics**) shows CPU time percentiles too. Do not
paste or share the tail output: request URLs in it contain session tokens (the API passes `authToken` in the query
string, which is also why persistent Workers Logs are left off in `wrangler.jsonc`).

- A request that fails with *Error 1102 / Worker exceeded resource limits* means the cost is too high: lower
  `PBKDF2_ITERATIONS` in `wrangler.jsonc` (for example 20000) and redeploy.
- If `cpuTime` is comfortably under 10 ms you may raise it a little. Hashes made earlier keep working, because
  each stored hash records its own iteration count.

## Day to day

| Task | Command |
|---|---|
| Deploy a change | `npx wrangler deploy` |
| Task titles in both languages (`0005_task_i18n.sql`) | apply the migration **before** deploying the new Worker: `npx wrangler d1 migrations apply plantriz --remote` (it adds one nullable column, so the old Worker keeps working meanwhile) |
| Events with a start and an end (`0006_task_end_date.sql`) | same as above: apply it before deploying the new Worker (one nullable column) |
| New database migration | add `migrations/000N_name.sql`, then `npx wrangler d1 migrations apply plantriz --remote` |
| Live logs | `npx wrangler tail` |
| Roll back a bad deploy | `npx wrangler rollback` |
| Back up the database | `npx wrangler d1 export plantriz --remote --output backup.sql` |
| Run it locally | `npm run dev` (see README.md) |

## Limits to keep in mind (free plan)

Workers: 100,000 requests a day, 10 ms CPU per request. D1: 5 million rows read and 100,000 rows written a day,
5 GB, 50 queries per request. Past a daily limit requests fail until 00:00 UTC; nothing is charged. Groq has its
own per-minute limits (the chat falls back to a second model, then answers "try again in a few seconds").

Accounts and tasks in the Java/Postgres database are **not** copied over: this is a new database. (Password hashes
use the same format, so a one-off export could carry users across; not written yet, see `../TODO.md`.)
