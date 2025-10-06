import type { VercelRequest, VercelResponse } from "@vercel/node";

const DREAMLO_PUBLIC = process.env.DREAMLO_PUBLIC_CODE as string;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

let cache: { ts: number; payload: any } | null = null;
const TTL_MS = 30_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });
  if (!DREAMLO_PUBLIC) return res.status(500).json({ error: "Server not configured" });

  try {
    const now = Date.now();
    if (cache && now - cache.ts < TTL_MS) {
      return res.status(200).json(cache.payload);
    }

    const url = `https://www.dreamlo.com/lb/${DREAMLO_PUBLIC}/json`;
    const r = await fetch(url, { headers: { "User-Agent": "FastTap-Proxy/1.0" } });
    const json = await r.json();

    const entries = json?.dreamlo?.leaderboard?.entry ?? [];
    const payload = {
      updatedAt: new Date().toISOString(),
      entries: entries.map((e: any) => ({
        name: e.name,
        score: Number(e.score),
        seconds: Number(e.seconds ?? 0),
        date: e.date,
        text: e.text
      }))
    };

    cache = { ts: now, payload };
    return res.status(200).json(payload);
  } catch (e: any) {
    return res.status(502).json({ error: "Dreamlo upstream error", detail: e?.message });
  }
}
