#!/usr/bin/env node
/**
 * Admin helpers for BNDZ license API.
 * Usage:
 *   LICENSE_API_URL=https://... ADMIN_API_KEY=... node scripts/admin.mjs issue [email] [name]
 *   LICENSE_API_URL=https://... ADMIN_API_KEY=... node scripts/admin.mjs revoke BNDZ-XXXX-XXXX-XXXX
 */
const base = (process.env.LICENSE_API_URL || '').replace(/\/$/, '');
const key = process.env.ADMIN_API_KEY || '';

if (!base || !key) {
  console.error('Set LICENSE_API_URL and ADMIN_API_KEY');
  process.exit(1);
}

const [cmd, a, b] = process.argv.slice(2);

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    console.error(res.status, json);
    process.exit(1);
  }
  console.log(JSON.stringify(json, null, 2));
}

if (cmd === 'issue') {
  const note = [a, b].filter(Boolean).join(' ').trim() || 'admin-issued';
  await post('/v1/admin/issue', { count: 1, note });
} else if (cmd === 'revoke') {
  if (!a) {
    console.error('revoke requires serial');
    process.exit(1);
  }
  await post('/v1/admin/revoke', { serial: a });
} else {
  console.error('Usage: admin.mjs issue [email] [name] | revoke <serial>');
  process.exit(1);
}
