import assert from 'node:assert/strict';

type Rule = {
  enabled: boolean;
  sourceRoots: string;
  pathGlob: string;
  extensions: string;
  minSizeBytes: number;
  idleDays: number;
  coldStorageRoot: string;
};

function matchesGhostRule(rule: Rule, filePath: string, sizeBytes: number, lastAccessUtc: Date, now = new Date()): boolean {
  if (!rule.enabled || !rule.coldStorageRoot.trim()) return false;
  const roots = rule.sourceRoots.split(';').map(s => s.trim()).filter(Boolean);
  const root = roots.find(r => filePath.toLowerCase().startsWith(r.toLowerCase()));
  if (!root) return false;
  if (sizeBytes < rule.minSizeBytes) return false;
  const exts = rule.extensions.split(',').map(e => e.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
  if (exts.length) {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    if (!exts.includes(ext)) return false;
  }
  const rel = filePath.slice(root.length).replace(/^\\/, '').replace(/\\/g, '/');
  const glob = rule.pathGlob.replace(/\*\*/g, '§').replace(/\*/g, '[^\\\\/]*').replace(/§/g, '.*');
  if (!new RegExp(`^${glob}$`, 'i').test(rel)) return false;
  const cutoff = new Date(now.getTime() - rule.idleDays * 86400000);
  return lastAccessUtc <= cutoff;
}

const rule: Rule = {
  enabled: true,
  sourceRoots: 'D:\\Samples',
  pathGlob: '**/*808*',
  extensions: 'wav,mp3',
  minSizeBytes: 5 * 1024 * 1024,
  idleDays: 30,
  coldStorageRoot: 'E:\\Cold',
};

const old = new Date('2020-01-01');
const recent = new Date();

assert.equal(matchesGhostRule(rule, 'D:\\Samples\\kits\\808-kick.wav', 6 * 1024 * 1024, old), true);
assert.equal(matchesGhostRule(rule, 'D:\\Samples\\kits\\808-kick.wav', 1024, old), false);
assert.equal(matchesGhostRule(rule, 'D:\\Samples\\kits\\snare.wav', 6 * 1024 * 1024, old), false);
assert.equal(matchesGhostRule(rule, 'D:\\Samples\\kits\\808-kick.wav', 6 * 1024 * 1024, recent), false);

console.log('test-ghost-link-rules: ok');
