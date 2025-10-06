# FastTap Dreamlo Proxy (Vercel)

Endpoints:
- `POST /api/submit` { name, score, seconds? }
- `GET /api/list`

## Deploy
1. Import this repo into Vercel.
2. Set Env Vars:
   - `DREAMLO_PRIVATE_CODE` (secret)
   - `DREAMLO_PUBLIC_CODE`
   - Optional: `CORS_ORIGIN`, `MAX_SCORE`
3. Deploy.

## Test
curl -X POST $URL/api/submit -H "Content-Type: application/json" -d '{"name":"Player","score":123}'
curl $URL/api/list
