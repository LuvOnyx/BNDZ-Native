/** DNS names this router is allowed to create or delete. The live site is off limits. */

import { pathToFileURL } from 'node:url';

export const WEBSITE_A = '15.204.218.94';
export const ZONE_ID = '1ac81c686fa2d4e3f175cd90afed08cc';
export const ACCOUNT_ID = '43aa82716ea9acc4c2e89fdd9843e182';

const PROTECTED = new Set(['bndz.org', 'www.bndz.org', 'www', '@', '']);

export function normalizeDnsName(name) {
  return String(name || '').trim().toLowerCase().replace(/\.$/, '');
}

export function assertMutableName(name) {
  const host = normalizeDnsName(name);
  if (PROTECTED.has(host)) {
    throw new Error('Refusing to change the live website DNS for ' + (host || '(empty)'));
  }
  if (host === 'cloud.bndz.org') return host;
  if (/^d-[a-z0-9](?:[a-z0-9-]{0,59}[a-z0-9])?\.bndz\.org$/.test(host)) return host;
  throw new Error('Refusing DNS name ' + host);
}

export function assertDeletable(record) {
  const host = assertMutableName(record && record.name);
  const content = String((record && record.content) || '').trim();
  if (content === WEBSITE_A) {
    throw new Error('Refusing to delete a record that points at the live website');
  }
  return host;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const cmd = process.argv[2];
  const name = process.argv[3];
  if (cmd === 'check') {
    process.stdout.write(assertMutableName(name) + '\n');
  } else if (cmd === 'delete-ok') {
    process.stdout.write(assertDeletable({ name, content: process.argv[4] || '' }) + '\n');
  } else {
    process.stderr.write('usage: dns-guard.js check <name> | delete-ok <name> <content>\n');
    process.exit(2);
  }
}
