import type { VercelRequest, VercelResponse } from "@vercel/node";

const DREAMLO_PUBLIC = process.env.DREAMLO_PUBLIC_CODE as string;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

let cache: { ts: number; payload: any } | null = null;
const TTL_MS = 30_000;

async function fetchText(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "FastTap-Proxy/1.0" } });
  const txt = await r.text();
  return { ok: r.ok, txt, status: r.status };
}

function toPayloadFromDreamlo(json: any) {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });
  if (!DREAMLO_PUBLIC) return res.status(500).json({ error: "Server not configured" });

  try {
    const now = Date.now();
    if (cache && now - cache.ts < TTL_MS) return res.status(200).json(cache.payload);

    // Try HTTPS first
    const httpsUrl = `https://www.dreamlo.com/lb/${DREAMLO_PUBLIC}/json`;
    let { txt } = await fetchText(httpsUrl);

    // If not valid JSON, try HTTP (some leaderboards don't have SSL enabled)
    let json: any;
    try {
      json = JSON.parse(txt);
    } catch {
      const httpUrl = `http://www.dreamlo.com/lb/${DREAMLO_PUBLIC}/json`;
      const r2 = await fetchText(httpUrl);
      try {
        json = JSON.parse(r2.txt);
      } catch {
        return res.status(502).json({
          error: "Dreamlo upstream error",
          detail: r2.txt,
        });
      }
    }

    const payload = toPayloadFromDreamlo(json);
    cache = { ts: Date.now(), payload };
    return res.status(200).json(payload);
  } catch (e: any) {
    return res.status(502).json({ error: "Dreamlo upstream error", detail: e?.message });
  }
}
