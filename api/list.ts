import type { VercelRequest, VercelResponse } from "@vercel/node";

const DREAMLO_PUBLIC = process.env.DREAMLO_PUBLIC_CODE as string;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const CACHE_TTL_MS = Number(process.env.LIST_CACHE_TTL_MS || 30_000);

type Cache = { ts: number; payload: any };
let cache: Cache | null = null;

async function fetchDreamloJSON(): Promise<any> {
  if (!DREAMLO_PUBLIC) throw new Error("DREAMLO_PUBLIC_CODE missing");
  const url = `http://www.dreamlo.com/lb/${DREAMLO_PUBLIC}/json`; // HTTP med flit
  const headers = { "User-Agent": "FastTap-Proxy/1.0" };

  // två försök, kort paus emellan
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers });
      const text = await r.text();
      if (!r.ok) throw new Error(`Upstream ${r.status}: ${text}`);
      return JSON.parse(text);
    } catch (e) {
      if (i === 0) await new Promise((res) => setTimeout(res, 250));
      else throw e;
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const now = Date.now();

  // färsk cache?
  if (cache && now - cache.ts < CACHE_TTL_MS) {
    return res.status(200).json({ ...cache.payload, cached: true });
  }

  try {
    const json = await fetchDreamloJSON();
    // normalisera -> { entries: [...] }
    const entries = Array.isArray(json?.dreamlo?.leaderboard?.entry)
      ? json.dreamlo.leaderboard.entry
      : Array.isArray(json?.entries)
      ? json.entries
      : [];

    const payload = { updatedAt: new Date().toISOString(), entries };
    cache = { ts: now, payload };
    return res.status(200).json({ ...payload, cached: false });
  } catch (e: any) {
    if (cache) {
      // fallback till senaste lyckade
      return res.status(200).json({ ...cache.payload, cached: true, note: "stale" });
    }
    return res.status(502).json({ error: "Dreamlo upstream error", detail: e?.message || String(e) });
  }
}
