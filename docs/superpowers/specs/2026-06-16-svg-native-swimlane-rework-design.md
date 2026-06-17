# SVG-native swimlane editor — rework design

Date: 2026-06-16
Status: approved (build straight through to deploy)

## Goal

Rebuild the swimlane editor as an **extremely simple, SVG-native** tool — "a massively
simplified Lucidchart." Stay a single static `public/index.html` (vanilla JS, no build,
no dependencies) plus a tiny Cloudflare Worker JSON API backed by KV.

## Decisions (locked)

- **Backend stays, secured.** Shareable view links remain, but writes are gated by a
  per-diagram **owner token**. The server always mints the id (no client-chosen ids).
  Byte-accurate size cap. CSP via `public/_headers`.
- **Keep:** arrows between boxes (side-aware orthogonal routing), multiple shape types
  (start / task / gateway / doc / end), cross-lane drag.
- **Cut:** the natural-language generator and its input bar.
- **Sizing:** boxes are resizable via a corner handle in the editor. **One global font
  size** for the whole diagram (toolbar control). The Export SVG dialog adds scale +
  font-size overrides on top.
- **Rendering:** the editor canvas **is** one `<svg>`. Lanes, boxes, arrows, and labels
  are real SVG elements. Export = serialize the same scene with overrides. One coordinate
  system (`getScreenCTM().inverse()` for pointer → SVG-space). This collapses the old
  three representations (DOM divs + overlay-wire SVG + export-SVG string) into one.

## Data model (v2)

`serialize()` is the source of truth.

```js
{
  v: 2,
  canvasWidth: Number,
  fontSize: Number,                                  // NEW: one global font size
  lanes: [{ id, name, height }],
  nodes: [{ id, type, text, laneId, lx, ly, w, h }], // NEW: per-node w/h (resizable)
  links: [{ id, from, to, fromSide, toSide }]        // sides 'n'|'s'|'e'|'w'
}
```

Node `type`: `task | gateway | doc | event-start | event-end`. `lx/ly` are lane-local.

### Migration (v1 → v2)

`deserialize(data)` branches on `data.v`:
- Missing `fontSize` → default `13`.
- Nodes missing `w`/`h` → fall back to the type's default geometry (`DEF`).
- Unknown `type` → coerce to `task` (prevents the old crash, finding L1).
- ids are remapped on load (unchanged behaviour) so re-saving never collides.

## Security model (owner tokens)

Fixes findings H1, H2, M2, M3 from the security review.

- `POST /api/diagrams` body `{ diagram }` (no id) → **create**: mint id + mint a random
  `token`; store `{ diagram, updatedAt, tokenHash }` where `tokenHash = SHA-256(token)` hex.
  Return `{ id, token, updatedAt }`. Token is returned **only** on create.
- `POST /api/diagrams` body `{ id, token, diagram }` → **update**: id must match
  `/^[a-z0-9]{6,24}$/i`, record must exist, and `SHA-256(token)` must equal stored
  `tokenHash`. Otherwise `403`. Server never honours a client-supplied **new** id (kills
  squatting, H2).
- Legacy records (no `tokenHash`) are **read-only** via the API: update returns `409`.
  The client handles this by transparently creating a new diagram (new id + token).
- `GET /api/diagrams/:id` → open read (anyone with the link can view). Never returns the
  token. Strict id regex on the route.
- Size cap: `new TextEncoder().encode(JSON.stringify(diagram)).byteLength > MAX_BYTES`
  (256 KB) → `413` (byte-accurate, fixes M2).

### Client token handling

- On create, store the returned token in `localStorage` under `swim:token:<id>`.
- On load via `?id=`, look up the token. If present → owner (Save updates in place). If
  absent → viewer (Save transparently creates a personal copy). The share link contains
  only the id, so viewers can never overwrite the owner's diagram.

### Static headers (`public/_headers`)

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
```

`'unsafe-inline'` is accepted because the app is intentionally one self-contained file;
the primary XSS defence is correct output escaping. SVG labels are set via `textContent`
(no HTML parsing); the export string-builder escapes via `escapeXml` (covers quotes,
fixing L2).

## Editor interactions

- **Shapes:** palette buttons add a node to the middle lane.
- **Drag:** move a box anywhere; lane membership decided by the box's vertical centre
  (cross-lane drag).
- **Select:** click a box/arrow. Selected box shows resize handle (corner), connect anchors,
  and delete affordance. `Delete`/`Backspace` removes selection (unless editing text).
- **Resize:** drag the corner handle. Circles/gateways stay square.
- **Rename:** double-click a box or lane label → a floating HTML `<input>` overlaid on the
  element; commit on Enter/blur.
- **Connect:** drag from a box anchor (n/s/e/w) to another box; routed orthogonally with
  side-aware entry/exit. Double-click or select+Delete removes an arrow.
- **Lanes:** add / rename / reorder (↑↓) / resize (drag bottom edge) / remove (≥1 kept).
- **Font:** one toolbar number/slider sets the global font size; all labels update live.
- **Export SVG:** dialog with scale (0.5–3×) and optional font-size override; downloads a
  standalone SVG of the current scene.
- **Persistence:** Save (Ctrl/Cmd-S), Share link (copies `/?id=`), Clear, auto-load on
  `?id=`.

## Out of scope (YAGNI)

Natural-language generation, multi-select, undo/redo, zoom/pan, real-time collaboration,
per-box fonts, private (auth-gated) read access.
