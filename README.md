# Swimlane Process Editor

An interactive, BPMN-flavored **swimlane process diagram editor** that runs on Cloudflare Workers. Lay out horizontal lanes per actor, generate a draft from a plain-language description, drag boxes across lanes, connect them with auto-routing arrows, rename everything, then **save** and **share by link**. Export any diagram to a standalone SVG.

No front-end framework, no build step: the whole editor is one `public/index.html`. A small Worker (`worker/index.js`) provides a two-endpoint JSON API backed by KV for persistence.

## Quick start

```bash
npm install
npx wrangler login
npx wrangler kv namespace create DIAGRAMS   # paste the printed id into wrangler.toml
npm run dev                                 # try it locally at http://localhost:8787
npm run deploy                              # go live
```

Full step-by-step instructions: see **[DEPLOY.md](./DEPLOY.md)**.

## Working on the code

If you (or Claude Code) are editing this project, start with **[CLAUDE.md](./CLAUDE.md)** — it explains the architecture, the front-end internals, the diagram data model, the API contract, and where to add features.

## What's where

| Path | What |
|---|---|
| `public/index.html` | The entire editor (markup + CSS + vanilla JS). |
| `worker/index.js` | Worker API: `POST /api/diagrams`, `GET /api/diagrams/:id`, KV-backed. |
| `wrangler.toml` | Worker + static-assets + KV binding config. |
| `CLAUDE.md` | Developer/architecture guide. |
| `DEPLOY.md` | Deploy runbook. |
