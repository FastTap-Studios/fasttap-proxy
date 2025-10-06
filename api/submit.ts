import type { VercelRequest, VercelResponse } from "@vercel/node";

const DREAMLO_PRIVATE = process.env.DREAMLO_PRIVATE_CODE as string;
const MAX_SCORE = Number(process.env.MAX_SCORE || 1000000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const BUCKET = new Map<string, { ts: number; count: number }>();
const WINDOW_MS = 15_000;
const MAX_REQ = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = BUCKET.get(ip);
  if (!entry || now - entry.ts > WINDOW_MS) {
    BUCKET.set(ip, { ts: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQ;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  if (!DREAMLO_PRIVATE) return res.status(500).json({ error: "Server not configured" });

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) return res.status(429).json({ error: "Too Many Requests" });

  try {
    const { name, score, seconds } = (req.body || {}) as { name?: string; score?: number; seconds?: number };
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Bad name" });

    const cleanName = name.trim().slice(0, 20).replace(/[^\w\s\-\.]/g, "");
    const nScore = Number(score);
    if (!Number.isFinite(nScore) || nScore < 0 || nScore > MAX_SCORE) {
      return res.status(400).json({ error: "Bad score" });
    }

    const hasSeconds = seconds !== undefined && Number.isFinite(Number(seconds)) && Number(seconds) >= 0;
    const encodedName = encodeURIComponent(cleanName);

    const url = `https://www.dreamlo.com/lb/${DREAMLO_PRIVATE}/add/${encodedName}/${nScore}` + (hasSeconds ? `/${Number(seconds)}` : "");

    const r = await fetch(url, { method: "GET", headers: { "User-Agent": "FastTap-Proxy/1.0" } });
    const text = await r.text();

    if (!r.ok) return res.status(502).json({ error: "Dreamlo upstream error", status: r.status, body: text });
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: "Server error", detail: e?.message });
  }
}
