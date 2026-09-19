/**
 * Shell menu dedupe — FE filter must drop builtins BNDZ already paints
 * (Share / Give access / Open / Properties / Copy path), including WinRT
 * namespaced verbs (Windows.ModernShare) and label aliases.
 */
import assert from 'node:assert/strict';
import {
  bareShellVerb,
  canonicalBuiltinVerb,
  filterSupplementalNativeItems,
  type NativeContextMenuItem,
} from '../src/lib/contextMenuActions.ts';

assert.equal(bareShellVerb('Windows.ModernShare'), 'modernshare');
assert.equal(bareShellVerb('share'), 'share');
assert.equal(canonicalBuiltinVerb('Windows.ModernShare'), 'share');
assert.equal(canonicalBuiltinVerb('openas'), 'openwith');
assert.equal(canonicalBuiltinVerb('copyaspath'), 'copypath');
assert.equal(canonicalBuiltinVerb('grantaccess'), 'grantaccess');
assert.equal(canonicalBuiltinVerb('7z:Extract'), null);

const sample: NativeContextMenuItem[] = [
  { id: 'open', label: 'Open', verb: 'open', kind: 'builtin' },
  { id: 'share', label: 'Share', verb: 'Windows.ModernShare', kind: 'shell', commandId: 42 },
  { id: 'grant', label: 'Give access to…', verb: 'grantaccess', kind: 'shell', commandId: 43 },
  { id: 'props', label: 'Properties', verb: 'properties', kind: 'builtin' },
  { separator: true },
  { id: 'scan', label: 'Scan with Defender', verb: 'defender:scan', kind: 'shell', commandId: 99 },
  { id: 'zip', label: '7-Zip', verb: '', kind: 'shell', children: [
    { id: 'zip-open', label: 'Open archive', verb: 'open', kind: 'shell', commandId: 100 },
    { id: 'zip-ext', label: 'Extract here', verb: '7z:extract', kind: 'shell', commandId: 101 },
  ]},
];

const filtered = filterSupplementalNativeItems(sample);
const labels = filtered.map(i => (i.label || i.id || '').toLowerCase());

assert.ok(!labels.some(l => l === 'open' || l === 'share' || l === 'give access to…' || l === 'properties'),
  `builtins should be stripped, got: ${labels.join(' | ')}`);
assert.ok(labels.some(l => l.includes('scan with defender')), 'third-party leaf kept');
assert.ok(labels.some(l => l === '7-zip'), 'cascade parent kept');

const zip = filtered.find(i => (i.label || '').toLowerCase() === '7-zip');
assert.ok(zip?.children?.length === 1, 'cascade Open child stripped; Extract kept');
assert.equal((zip!.children![0].label || '').toLowerCase(), 'extract here');

// Adjacent separators collapse after builtin strip
const seps: NativeContextMenuItem[] = [
  { id: 'open', label: 'Open', verb: 'open' },
  { separator: true },
  { separator: true },
  { id: 'scan', label: 'Vendor Tool', verb: 'vendor:x', kind: 'shell', commandId: 1 },
  { separator: true },
];
const cleaned = filterSupplementalNativeItems(seps);
assert.equal(cleaned.length, 1);
assert.equal(cleaned[0].label, 'Vendor Tool');

console.log('shell menu dedupe: ok');
