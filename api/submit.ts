import type { VercelRequest, VercelResponse } from "@vercel/node";

const DREAMLO_PRIVATE = process.env.DREAMLO_PRIVATE_CODE as string;
const MAX_SCORE = Number(process.env.MAX_SCORE || 1000000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// Profanitets-kontroller (ställ in i Vercel → Environment Variables)
const PROHIBITED_SUBSTRINGS = (process.env.PROHIBITED_SUBSTRINGS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const PROHIBITED_REGEX = process.env.PROHIBITED_REGEX
  ? new RegExp(process.env.PROHIBITED_REGEX, "i")
  : null;
// Om true → ersätt fult namn med Anonymous####; annars 400 name_not_allowed
const REPLACE_PROFANITY =
  (process.env.REPLACE_PROFANITY || "false").toLowerCase() === "true";

// Enkel rate-limit per IP (in-memory)
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

// Lite “leet”-normalisering för att hitta fula ord skrivet med 0/1/@ etc.
function foldLeet(s: string) {
  return s
    .toLowerCase()
    .replace(/[@]/g, "a")
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t");
}

function stripNonWordSpacesDotDash(s: string) {
  // Tillåt bara a–ö/0–9/underscore, mellanslag, bindestreck, punkt
  return s.replace(/[^\w\s\-\.]/g, "");
}

function isProfane(name: string) {
  const clean = stripNonWordSpacesDotDash(name).trim();
  const folded = foldLeet(clean).replace(/\s+/g, " ");

  if (PROHIBITED_REGEX && PROHIBITED_REGEX.test(folded)) return true;
  for (const sub of PROHIBITED_SUBSTRINGS) {
    if (sub && folded.includes(sub)) return true;
  }
  // Blocka URL/annonser
  if (/https?:\/\/|www\.|\.com\b|\.net\b|\.org\b/.test(folded)) return true;
  // Blocka överdriven upprepning (t.ex. "!!!!" eller "xxxx")
  if (/(.)\1{3,}/.test(folded)) return true;

  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });
  if (!DREAMLO_PRIVATE)
    return res.status(500).json({ error: "Server not configured" });

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) return res.status(429).json({ error: "Too Many Requests" });

  try {
    const { name, score, seconds } = (req.body || {}) as {
      name?: string;
      score?: number;
      seconds?: number;
    };

    if (typeof name !== "string" || !name.trim())
      return res.status(400).json({ error: "Bad name" });

    // Städa och begränsa längd (max 20 tecken)
    const rawName = name.trim().slice(0, 20);
    const cleanName = stripNonWordSpacesDotDash(rawName);

    // Profanitetsbeslut
    let finalName = cleanName;
    if (isProfane(cleanName)) {
      if (REPLACE_PROFANITY) {
        const rand = Math.floor(1000 + Math.random() * 9000);
        finalName = `Anonymous${rand}`;
      } else {
        return res.status(400).json({ error: "name_not_allowed" });
      }
    }

    const nScore = Number(score);
    if (!Number.isFinite(nScore) || nScore < 0 || nScore > MAX_SCORE) {
      return res.status(400).json({ error: "Bad score" });
    }

    const hasSeconds =
      seconds !== undefined &&
      Number.isFinite(Number(seconds)) &&
      Number(seconds) >= 0;

    const encodedName = encodeURIComponent(finalName);

    // Viktigt: många Dreamlo-boards saknar SSL → använd HTTP
    const url =
      `http://www.dreamlo.com/lb/${DREAMLO_PRIVATE}/add/${encodedName}/${nScore}` +
      (hasSeconds ? `/${Number(seconds)}` : "");

    const r = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "FastTap-Proxy/1.0" },
    });
    const text = await r.text();

    if (!r.ok)
      return res
        .status(502)
        .json({ error: "Dreamlo upstream error", status: r.status, body: text });

    return res.status(200).json({ ok: true, name: finalName });
  } catch (e: any) {
    return res.status(500).json({ error: "Server error", detail: e?.message });
  }
}
