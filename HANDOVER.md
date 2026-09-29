# HANDOVER – swimlane-editor (AMISTA Charts)

## Purpose / business context
Internal AMISTA tool: a browser-based **swimlane process diagram editor** (BPMN-flavoured). Users create lanes (actors/departments) and optional columns (phases), place task/gateway/doc/event boxes, connect them with orthogonal arrows (labels, dashed lines), colour boxes, export SVG, and save/share diagrams by link. Used for process documentation in consulting work; no specific client.

## Tech stack
- Front end: a single self-contained `public/index.html` (HTML + CSS + vanilla JS, SVG-native editor, no build step, no dependencies)
- Back end: Cloudflare Worker (`worker/index.js`) – small JSON API on `/api/*`
- Storage: Cloudflare KV namespace bound as `DIAGRAMS`; rate limiting via Workers rate-limit binding `WRITE_LIMITER`
- Tooling: `wrangler` v4 (only devDependency)

## Repository layout
| Path | Purpose |
|---|---|
| `public/index.html` | Entire editor (state, `render()`, drag/link/resize, serialize/deserialize v4, export, save/share) |
| `public/_headers` | Static asset headers (security headers) |
| `worker/index.js` | API: `POST /api/diagrams` (create/update with owner token), `GET /api/diagrams/:id`, `DELETE /api/diagrams/:id` |
| `wrangler.toml` | Worker, assets, route, KV + rate-limit bindings |
| `CLAUDE.md` | Detailed architecture, API contract and data model – **read first** |
| `DEPLOY.md` | Step-by-step deploy runbook |
| `README.md` | User-facing overview |
| `docs/superpowers/specs/` | Design spec for the SVG-native rework (2026-06-16) |
| `*.png`, `.playwright-mcp/` | Local screenshots (gitignored) |

## Setup & running locally
```bash
npm install
npm run dev        # wrangler dev -> http://localhost:8787, simulated KV
```

## Configuration
- Bindings (in `wrangler.toml`): `DIAGRAMS` (KV namespace id is in the file – not a secret), `WRITE_LIMITER` (20 POSTs / 60 s per IP), `ASSETS`.
- No secrets required. If any are added, use `wrangler secret put` / `.dev.vars` (gitignored).

## Deployment
- Cloudflare Workers, worker name `swimlane-editor`, custom domain **https://charts.amista-consulting.com** (zone `amista-consulting.com` must be on the Cloudflare account).
- `npm run deploy` (`wrangler deploy`); logs via `npm run tail`. See `DEPLOY.md`.
- GitHub repo: `AmistaUS-AVA/AVA-CHARTS`.

## Current status & open items
- Working and deployed; latest features (2026): v3 matrix lanes/columns, box colours, dashed lines; v4 line labels (Yes/No/True/False); drag right edge to set diagram width; delete saved diagram.
- Ideas listed in `CLAUDE.md`: "my diagrams" list (client-side from `localStorage` tokens), private read (Cloudflare Access or token on GET), version history (`d:<id>:v<n>`).
- `CLAUDE.md` still lists rate limiting as unaddressed (M1), but `WRITE_LIMITER` is now configured – that note is stale.

## Known gotchas
- Reads are open to anyone with the link; only the owner token (in the creator's `localStorage`, `swim:token:<id>`) allows overwrite/delete. Losing the browser storage means losing edit rights (Save makes a copy).
- `serialize`/`deserialize` must change together; bump `v` and add migrations for new fields.
- `render()` rebuilds the SVG and re-binds handlers each time – don't hold element references across renders.
- Max diagram size 256 KB; empty diagrams rejected (422).
- `[[unsafe.bindings]]` rate limiter uses the "unsafe" config section; may need updating when Wrangler promotes it to a stable key.

## Related projects
- None directly. Other AMISTA Cloudflare-hosted tools may exist under `D:\_projects`.
