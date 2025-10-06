import type { VercelRequest, VercelResponse } from "@vercel/node";

const DREAMLO_PUBLIC = process.env.DREAMLO_PUBLIC_CODE as string;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// Cache + throttling (in-memory per server instance)
let lastPayload: any | null = null;
let lastOkAt = 0;
let inflight: Promise<any> | null = null;
let lastFetchStarted = 0;
const COOLDOWN_MS = 1500; // Dreamlo tolererar inte samma request inom ~1s

function payloadFromDreamlo(json: any) {
  const entries = json?.dreamlo?.leaderboard?.entry ?? [];
  return {
    updatedAt: new Date().toISOString(),
    entries: entries.map((e: any) => ({
      name: e.name,
      score: Number(e.score),
      seconds: Number(e.seconds ?? 0),
      date: e.date,
      text: e.text,
    })),
  };
}

async function fetchDreamlo() {
  try {
    // Cooldown: vänta om senaste start var nyss
    const now = Date.now();
    const wait = Math.max(0, COOLDOWN_MS - (now - lastFetchStarted));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetchStarted = Date.now();

    // Försök HTTPS, annars HTTP (vissa leaderboards har ej SSL)
    const httpsUrl = `https://www.dreamlo.com/lb/${DREAMLO_PUBLIC}/json`;
    let r = await fetch(httpsUrl, { headers: { "User-Agent": "FastTap-Proxy/1.0" } });
    let txt = await r.text();
    let json: any;
    try {
      json = JSON.parse(txt);
    } catch {
      const httpUrl = `http://www.dreamlo.com/lb/${DREAMLO_PUBLIC}/json`;
      r = await fetch(httpUrl, { headers: { "User-Agent": "FastTap-Proxy/1.0" } });
      txt = await r.text();
      json = JSON.parse(txt);
    }

    const payload = payloadFromDreamlo(json);
    lastPayload = payload;
    lastOkAt = Date.now();
    return { ok: true, payload };
  } catch (e: any) {
    return { ok: false, msg: String(e?.message || e) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });
  if (!DREAMLO_PUBLIC) return res.status(200).json({ error: "Server not configured", entries: [] });

  // Servera cache om den är färsk (undvik att hamra Dreamlo)
  const now = Date.now();
  if (lastPayload && now - lastOkAt < COOLDOWN_MS) {
    return res.status(200).json(lastPayload);
  }

  try {
    // Coalesce: om det redan pågår en hämtning, vänta på samma promise
    if (!inflight) inflight = fetchDreamlo();
    const result = await inflight;
    inflight = null;

    if (result.ok) return res.status(200).json(result.payload);

    // Soft-fail: ge senaste godkända payload, eller 200 med felinfo
    if (lastPayload) return res.status(200).json(lastPayload);
    return res.status(200).json({ error: "Dreamlo upstream error", detail: result.msg, entries: [] });
  } catch (e: any) {
    inflight = null;
    if (lastPayload) return res.status(200).json(lastPayload);
    return res.status(200).json({ error: "Unexpected error", detail: String(e?.message || e), entries: [] });
  }
}
