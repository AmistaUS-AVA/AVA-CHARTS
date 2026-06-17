# CLAUDE.md — Swimlane Process Editor

Guidance for Claude Code working in this repository. Read this before editing.

## What this is

A single-page **swimlane process diagram editor** (BPMN-flavored) deployed on **Cloudflare Workers**. Users lay out horizontal lanes (one per actor/department), generate a draft of boxes from a plain-language description, then drag boxes (including across lanes), connect them with orthogonal sequence-flow arrows, rename boxes and lanes, save the diagram, and share it by link.

It is intentionally dependency-free on the front end: `public/index.html` is one self-contained file (HTML + CSS + vanilla JS, no build step, no framework). Keep it that way unless there's a strong reason not to — the simplicity is the point.

## Architecture

```
swimlane-editor/
├── public/
│   └── index.html        # the entire editor: markup, styles, and logic in one file
├── worker/
│   └── index.js          # Cloudflare Worker: /api/* JSON endpoints, backed by KV
├── wrangler.toml         # Worker + static-assets + KV binding config
├── package.json          # dev/deploy scripts; only devDep is wrangler
└── DEPLOY.md             # step-by-step deploy runbook
```

**Request routing** (configured in `wrangler.toml`): `run_worker_first = ["/api/*"]` means only `/api/*` requests hit the Worker; every other path is served straight from `public/` as a static asset. So the editor HTML is static hosting, and the Worker is just a small JSON API.

**Storage**: a single KV namespace bound as `DIAGRAMS`. Each diagram is stored under key `d:<id>` as `{ diagram, updatedAt, tokenHash }`, where `tokenHash` is `SHA-256(ownerToken)` (hex). KV is eventually consistent and fine for this use; it is not a relational store — don't try to query across diagrams.

## The API contract

The front end and Worker agree on exactly two endpoints, gated by a per-diagram **owner token**. If you change one side, change the other and this section.

- `POST /api/diagrams`:
  - **Create** — body `{ diagram }` (no id). Server mints both the id **and** a secret `token`, stores `tokenHash`, and returns `{ id, token, updatedAt }`. The token is returned **only** here.
  - **Update** — body `{ id, token, diagram }`. The id must already exist and `SHA-256(token)` must match the stored `tokenHash`, else `403`. The server never honours a client-supplied **new** id (anti-squatting): an unknown id returns `404`; a legacy record with no `tokenHash` returns `409` (read-only).
  - Rejects diagrams whose serialized bytes exceed `MAX_BYTES` (256 KB) with `413` (byte-accurate, via `TextEncoder`).
- `GET /api/diagrams/:id` — open read (share-by-link). Returns `{ id, diagram, updatedAt }` or 404. **Never** returns the token/hash.

IDs are short random strings from a no-ambiguous-characters alphabet (`makeId` in the Worker), validated against `/^[a-z0-9]{6,24}$/i`. The client keeps its token in `localStorage` under `swim:token:<id>`; viewers without the token can still load, and Save transparently creates their own copy.

## The diagram data model (front end ↔ Worker)

`serialize()` in `index.html` is the source of truth for the saved shape. Current `v: 2`:

```js
{
  v: 2,
  canvasWidth: Number,
  fontSize: Number,                                    // global font size for all labels
  lanes: [{ id, name, height }],
  nodes: [{ id, type, text, laneId, lx, ly, w, h }],   // lx/ly lane-local; w/h per-node (resizable)
  links: [{ id, from, to, fromSide, toSide }]          // sides are 'n'|'s'|'e'|'w'
}
```

`deserialize(data)` rebuilds the editor from this. It **remaps ids** on load (old id → freshly minted id) so re-saving never collides, and **migrates v1**: missing `fontSize` → 13, missing node `w`/`h` → the type's `DEF` geometry, unknown `type` → `task`. If you add fields to a node/lane/link, update **both** `serialize` and `deserialize`, and bump `v`. When loading an older `v`, migrate rather than assuming current shape.

Node `type` is one of: `task`, `gateway`, `doc`, `event-start`, `event-end`. Geometry per type lives in the `DEF` object in `index.html` — change sizes there, not inline.

## How the editor internals fit together (in `index.html`)

The script is one IIFE. **The editor is SVG-native**: a single root `<svg id="canvas">` is both the editor and the export source — lanes, boxes, arrows, and labels are all real SVG elements. There is **no** DOM-node / overlay-wire split and **no** natural-language generator (both removed in the v2 rework). Key pieces, in rough order:

- **State arrays**: `lanes`, `nodes`, `links`, plus `fontSize`, `uid`/`nid()`. Everything keys off these.
- **Rendering**: `render()` is the single source of truth — it clears the `<svg>` and rebuilds defs, lanes, links, nodes (and the empty tip) from state. Call it after any change. `drawLane`/`drawLink`/`drawNode` build one element group each and attach that element's handlers (so handlers are re-bound every render; references go stale across renders).
- **Coordinates**: one system. `toSvg(evt)` maps pointer → SVG user-space via `getScreenCTM().inverse()`. `absX`/`absY`/`center`/`anchorPoint` derive geometry; lane tops come from `computeTops()`.
- **Lanes**: `addLane`, `removeLane`, `moveLane`, `startLaneResize`, `editLane`.
- **Nodes**: `addNode`, `removeNode`, `startDrag` (lane membership decided by the node's **vertical center** via `laneAtY` — that's what lets a box cross lanes), `startResize` (corner handle; circles/gateways stay square via `SQUARE`), `editNode` (double-click → floating `<input>` overlay), `clampNode`.
- **Linking**: `startLink` (drag from an anchor dot), `addLink`, `removeLink`. `elbow()` → orthogonal path; `anchorPoint`/`nearestSide`/`guessSide` decide attachment.
- **Font**: one global `fontSize` (toolbar input) applied to every label on render; event shapes render one step smaller.
- **Export SVG**: `openExport()` shows a dialog (scale + optional font override) → `buildSvg(scale, fontOverride)` emits a standalone SVG with the **same** geometry/`wrap()` the editor uses, escaped via `escapeXml`. WYSIWYG by construction.
- **Persistence**: `serialize`/`deserialize`/`save`/`load`/`share` (+ `postDiagram`), and the `init()` IIFE that auto-loads when the URL has `?id=`. `save()` sends `{id, token}` when it owns the diagram and falls back to creating a copy on 403/404/409.

## Conventions and guardrails

- **No build step, no front-end dependencies.** If a change seems to need a framework or bundler, stop and reconsider — this app's value is being one static file plus a tiny Worker.
- **Don't restructure drag / link / coordinate / render functions casually.** They're interdependent and `render()` is called from many places. Add features alongside them rather than rewriting them. Remember handlers are re-bound on every `render()`, so don't hold element references across a render.
- **Keep the visual style** plain grey/white BPMN (the CSS `:root` variables drive everything). AMISTA's house style is deliberate, not a placeholder.
- **Validate on the Worker, not just the client.** The size cap and id-format check live server-side on purpose; keep server-side validation when extending the API.
- **No secrets in `wrangler.toml`.** Use `wrangler secret put` / `.dev.vars`. The KV id in the file is not a secret, but anything sensitive must not be committed.

## Likely next features (and where they go)

- **List "my diagrams"** → the client already holds owner tokens in `localStorage` (`swim:token:*`); a "my diagrams" view can be purely client-side from those keys, no new endpoint needed.
- **Private read** → reads are currently open (share-by-link). To gate viewing too, put the Worker behind Cloudflare Access, or require the owner token on `GET` for non-shared diagrams.
- **Rate limiting** → still unaddressed (review finding M1). Add a Cloudflare Rate Limiting rule on `POST /api/*`, or a KV/Durable-Object counter, before exposing this widely.
- **Versioning / history** → store `d:<id>:v<n>` records instead of overwriting.
- **Custom domain** → deferred; add a `routes` entry with `custom_domain = true` (or attach in the dashboard) and redeploy.

## Testing locally

`npm run dev` starts `wrangler dev`, which serves the static assets and runs the Worker with a local KV simulation. Save/share/load all work locally against that simulated KV. See `DEPLOY.md` for first-time setup (creating the real KV namespace and putting its id in `wrangler.toml`).
