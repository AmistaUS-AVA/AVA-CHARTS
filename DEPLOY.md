# DEPLOY.md — Publish the Swimlane Editor on Cloudflare

A step-by-step runbook to get this app live on Cloudflare Workers (with static assets + KV storage). It's written so you can run it yourself, or hand it to Claude Code and say "follow DEPLOY.md."

Total time: ~10 minutes the first time. After that, deploying an update is one command.

## Prerequisites

- **Node.js 18+** installed (`node -v` to check).
- A **Cloudflare account** (the free plan is enough). Sign up at dash.cloudflare.com if needed.
- This project folder on your machine.

You do **not** need to install Wrangler globally — the commands below use `npx`, which runs the version pinned in `package.json`.

## Step 1 — Install dependencies

From the project root (`swimlane-editor/`):

```bash
npm install
```

This installs Wrangler (the Cloudflare CLI), the only dependency.

## Step 2 — Log in to Cloudflare

```bash
npx wrangler login
```

A browser window opens; authorize Wrangler for your account. If you're on a headless machine, use `npx wrangler login` and follow the printed URL, or set a `CLOUDFLARE_API_TOKEN` env var instead.

## Step 3 — Create the KV namespace

This is where saved diagrams live.

```bash
npx wrangler kv namespace create DIAGRAMS
```

It prints something like:

```
🌀 Creating namespace with title "swimlane-editor-DIAGRAMS"
✅ Add the following to your configuration file:
[[kv_namespaces]]
binding = "DIAGRAMS"
id = "abc123def456..."
```

Copy that `id` value.

## Step 4 — Put the KV id into wrangler.toml

Open `wrangler.toml` and replace the placeholder:

```toml
[[kv_namespaces]]
binding = "DIAGRAMS"
id = "REPLACE_WITH_KV_NAMESPACE_ID"   # ← paste the id from step 3 here
```

(If Claude Code is doing this, edit the file directly.)

## Step 5 — Test locally first

```bash
npm run dev
```

Wrangler serves the app at `http://localhost:8787` (it prints the URL). It runs the Worker and simulates KV locally, so Save / Share link / reopening a `?id=...` URL all work without touching production. Open it, generate a process, drag boxes, hit **Save**, copy the share link, paste it in a new tab — you should see the saved diagram reload. Press `Ctrl+C` to stop.

## Step 6 — Deploy

```bash
npm run deploy
```

Wrangler uploads the Worker and the static `public/` files and prints your live URL, e.g.:

```
https://swimlane-editor.<your-subdomain>.workers.dev
```

That URL is the live app. Saved diagrams persist in KV; share links work for anyone who opens them.

## Step 7 (optional) — Custom domain

To serve it at, say, `process.amistausa.com`:

1. Add the domain (or its zone) to your Cloudflare account if it isn't already.
2. In the Cloudflare dashboard: **Workers & Pages → swimlane-editor → Settings → Domains & Routes → Add custom domain**, and enter the hostname. Cloudflare provisions the DNS record and TLS automatically.

Or add a `routes` entry to `wrangler.toml` and redeploy — see the Wrangler docs for the exact syntax for your zone.

## Updating later

After any code change, just:

```bash
npm run deploy
```

No need to recreate the KV namespace or re-login. Existing saved diagrams are untouched.

## Watching logs / debugging

```bash
npm run tail
```

Streams live logs from the deployed Worker (useful if Save returns an error — you'll see the API request and any thrown error).

## Notes on access & data

- **Anyone with a diagram's link can open it (read is open by design, for sharing), but only the creator can overwrite it.** Each diagram gets a secret owner token on creation (held in the creator's browser `localStorage`); overwriting requires it, so a viewer who follows a share link can't clobber the original — Save just makes them their own copy. To also gate *viewing* to AMISTA staff, put the Worker behind **Cloudflare Access** (SSO at the edge, no app code changes).
- Diagrams are capped at 256 KB each (enforced in the Worker). KV free tier covers far more diagrams than this tool will produce.
- The KV namespace and the Worker are independent resources in your Cloudflare account; deleting the Worker does not delete saved diagrams, and vice versa.

## Troubleshooting

- **`KV namespace 'DIAGRAMS' is not valid`** → the `id` in `wrangler.toml` is still the placeholder or wrong; redo steps 3–4.
- **Save returns 500 locally** → make sure you're running through `npm run dev` (which provides the KV binding), not opening `index.html` as a file.
- **`wrangler: command not found`** → use the `npm run` / `npx wrangler` forms above; don't call bare `wrangler` unless it's globally installed.
- **Static page loads but `/api/...` 404s** → confirm `run_worker_first = ["/api/*"]` and `main = "worker/index.js"` are present in `wrangler.toml`.
