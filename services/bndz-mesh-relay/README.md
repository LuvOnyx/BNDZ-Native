# BNDZ Mesh Drop Relay

Lightweight signaling relay for Mesh Drop auto-answer exchange.

## Deploy (Cloudflare Workers)

```bash
cd services/bndz-mesh-relay
npm install
npx wrangler deploy
```

Copy the worker URL into BNDZ **Configuration → Workspace Tools → Mesh Drop signaling relay URL**.

Example: `https://bndz-mesh-relay.your-subdomain.workers.dev`

## API

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/room` | `{ offer, label? }` | `{ roomId, joinUrl, pollUrl }` |
| GET | `/api/room/:id` | — | `{ offer, label, answer? }` |
| POST | `/api/room/:id/answer` | `{ answer }` | `{ ok: true }` |
| GET | `/api/room/:id/answer` | — | `{ answer }` or 204 |

Rooms expire after `RELAY_TTL_SECONDS` (default 1 hour).
