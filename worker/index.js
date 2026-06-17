import { WorkerEntrypoint } from "cloudflare:workers";

// Short, URL-safe random id (no ambiguous chars). Used for diagram ids.
function makeId(len = 10) {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  return randomFrom(alphabet, len);
}

// Longer secret owner token. Returned once on create; required to overwrite.
function makeToken(len = 32) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  return randomFrom(alphabet, len);
}

function randomFrom(alphabet, len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time-ish string compare (both are hex of equal length).
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

const MAX_BYTES = 256 * 1024; // 256 KB safety cap per diagram (measured in bytes)
const ID_RE = /^[a-z0-9]{6,24}$/i;

export default class extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/diagrams" && request.method === "POST") {
      return this.createOrUpdate(request);
    }

    const getMatch = pathname.match(/^\/api\/diagrams\/([a-z0-9]{6,24})$/i);
    if (getMatch && request.method === "GET") {
      return this.getDiagram(getMatch[1]);
    }

    return new Response("Not found", { status: 404 });
  }

  async createOrUpdate(request) {
    // Per-IP write throttle (Workers rate-limiting binding). Protects against
    // scripted create/overwrite floods (storage growth / cost) — finding M1.
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    const { success } = await this.env.WRITE_LIMITER.limit({ key: ip });
    if (!success) {
      return json({ error: "Too many requests, slow down" }, 429);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const diagram = payload && payload.diagram;
    if (!diagram || typeof diagram !== "object") {
      return json({ error: "Missing diagram" }, 400);
    }

    const serialized = JSON.stringify(diagram);
    if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) {
      return json({ error: "Diagram too large" }, 413);
    }

    const now = new Date().toISOString();

    // ---- Update path: a valid id was supplied ----
    if (payload.id && ID_RE.test(payload.id)) {
      const raw = await this.env.DIAGRAMS.get(`d:${payload.id}`);
      if (!raw) {
        // Don't let a client claim an arbitrary id (anti-squatting).
        return json({ error: "Unknown diagram id" }, 404);
      }
      let record;
      try {
        record = JSON.parse(raw);
      } catch {
        return json({ error: "Corrupt record" }, 500);
      }
      // Legacy records created before ownership existed are read-only.
      if (!record.tokenHash) {
        return json({ error: "Diagram is read-only; save as a new copy" }, 409);
      }
      const supplied = payload.token || request.headers.get("X-Owner-Token");
      const suppliedHash = supplied ? await sha256Hex(supplied) : "";
      if (!safeEqual(suppliedHash, record.tokenHash)) {
        return json({ error: "Not authorized to overwrite this diagram" }, 403);
      }
      record.diagram = diagram;
      record.updatedAt = now;
      await this.env.DIAGRAMS.put(`d:${payload.id}`, JSON.stringify(record));
      return json({ id: payload.id, updatedAt: now });
    }

    // ---- Create path: server mints id + owner token ----
    // Pick an id that isn't already taken so a random collision can't clobber
    // (and lock out) someone else's diagram. KV is eventually consistent, so
    // this is best-effort, but it removes the realistic collision risk.
    let id = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = makeId();
      if (!(await this.env.DIAGRAMS.get(`d:${candidate}`))) { id = candidate; break; }
    }
    if (!id) return json({ error: "Could not allocate id, please retry" }, 503);

    const token = makeToken();
    const tokenHash = await sha256Hex(token);
    await this.env.DIAGRAMS.put(
      `d:${id}`,
      JSON.stringify({ diagram, updatedAt: now, tokenHash })
    );
    return json({ id, token, updatedAt: now });
  }

  async getDiagram(id) {
    const raw = await this.env.DIAGRAMS.get(`d:${id}`);
    if (!raw) return json({ error: "Not found" }, 404);
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      return json({ error: "Corrupt record" }, 500);
    }
    // Read is open (share-by-link); never expose the owner token/hash.
    return json({ id, diagram: record.diagram, updatedAt: record.updatedAt });
  }
}
