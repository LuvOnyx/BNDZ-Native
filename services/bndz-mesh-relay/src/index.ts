/**
 * BNDZ Mesh Drop signaling relay — exchanges SDP answer codes without manual paste.
 *
 * POST /api/room              { offer, label? }  → { roomId, joinUrl, pollUrl }
 * GET  /api/room/:id                         → { offer, label, answer? }
 * POST /api/room/:id/answer   { answer }       → { ok: true }
 * GET  /api/room/:id/answer                  → { answer } | 204
 * GET  /health
 */

export interface Env {
  RELAY_TTL_SECONDS?: string;
}

type Room = {
  offer: string;
  label: string;
  answer?: string;
  createdAt: number;
};

const rooms = new Map<string, Room>();

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
  });
}

function cors(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
  });
}

function roomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function ttlMs(env: Env): number {
  const sec = Number(env.RELAY_TTL_SECONDS || '3600');
  return Math.max(300, sec) * 1000;
}

function prune(env: Env) {
  const cutoff = Date.now() - ttlMs(env);
  for (const [id, room] of rooms) {
    if (room.createdAt < cutoff) rooms.delete(id);
  }
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return cors();
    prune(env);

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && path === '/health') {
      return json({ ok: true, rooms: rooms.size });
    }

    if (req.method === 'POST' && path === '/api/room') {
      const body = await readJson(req);
      const offer = String(body?.offer ?? '').trim();
      if (!offer) return json({ ok: false, error: 'offer required' }, 400);
      const id = roomId();
      const label = String(body?.label ?? 'BNDZ Mesh Drop');
      rooms.set(id, { offer, label, createdAt: Date.now() });
      const base = `${url.origin}`;
      return json({
        roomId: id,
        joinUrl: `${base}/join/${id}`,
        pollUrl: `${base}/api/room/${id}/answer`,
      });
    }

    const roomMatch = path.match(/^\/api\/room\/([^/]+)$/);
    if (req.method === 'GET' && roomMatch) {
      const room = rooms.get(roomMatch[1]!);
      if (!room) return json({ ok: false, error: 'not found' }, 404);
      return json({ offer: room.offer, label: room.label, answer: room.answer ?? null });
    }

    const answerMatch = path.match(/^\/api\/room\/([^/]+)\/answer$/);
    if (answerMatch) {
      const id = answerMatch[1]!;
      const room = rooms.get(id);
      if (!room) return json({ ok: false, error: 'not found' }, 404);

      if (req.method === 'GET') {
        if (!room.answer) return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
        return json({ answer: room.answer });
      }

      if (req.method === 'POST') {
        const body = await readJson(req);
        const answer = String(body?.answer ?? '').trim();
        if (!answer) return json({ ok: false, error: 'answer required' }, 400);
        room.answer = answer;
        return json({ ok: true });
      }
    }

    if (req.method === 'GET' && path.startsWith('/join/')) {
      const id = path.slice('/join/'.length);
      const room = rooms.get(id);
      if (!room) return new Response('Room not found', { status: 404 });
      return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>BNDZ Mesh Drop</title></head><body style="font-family:system-ui;background:#0a0e14;color:#e2e8f0;padding:2rem"><h1>Mesh Drop relay</h1><p>Room <code>${id}</code></p><p>Paste your answer code in BNDZ Mesh Drop → Relay receive.</p></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }

    return json({ ok: false, error: 'not found' }, 404);
  },
};
