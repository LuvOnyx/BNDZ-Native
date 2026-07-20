const fs = require('fs');
const src = fs.readFileSync('src/components/ConfigurationDialog.tsx', 'utf8');

const parts = src.split(/<TabsContent\s+value="/);
const entries = [];

function camelToWords(key) {
  return String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

for (let i = 1; i < parts.length; i++) {
  const tabEnd = parts[i].indexOf('"');
  const tab = parts[i].slice(0, tabEnd);
  const body = parts[i];
  const loose = /<Checkbox\s+label=\{<span>([\s\S]*?)<\/span>\}/g;
  let m;
  while ((m = loose.exec(body))) {
    let label = m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label || label.length < 3) continue;
    const after = body.slice(m.index, m.index + 600);
    const keyMatch = after.match(/updateLocalConfig\(\{\s*([a-zA-Z0-9_]+):/);
    const key = keyMatch ? keyMatch[1] : '';
    entries.push({ tab, label, key });
  }
}

const seen = new Set();
const unique = [];
for (const e of entries) {
  const k = `${e.tab}::${e.label}`;
  if (seen.has(k)) continue;
  seen.add(k);
  unique.push(e);
}

// Intent synonym packs — applied when label/key hits a concept
const INTENT_PACKS = [
  { test: /delete|recycle|trash|bin/i, words: ['delete', 'remove', 'trash', 'recycle', 'confirm delete', 'ask before delete', 'permanently'] },
  { test: /tooltip|hover|info tip/i, words: ['tooltip', 'hover', 'popup', 'info tip', 'mouse over', 'preview tip'] },
  { test: /thumbnail|thumb/i, words: ['thumbnail', 'preview icon', 'image preview', 'thumb'] },
  { test: /dual.?pane|split/i, words: ['dual pane', 'split view', 'two panes', 'side by side'] },
  { test: /hidden|system folder/i, words: ['hidden', 'system files', 'show hidden', 'dotfiles'] },
  { test: /extension/i, words: ['extension', 'file type', 'show extensions', '.txt'] },
  { test: /folder size/i, words: ['folder size', 'directory size', 'calculate size', 'disk usage'] },
  { test: /theme|dark|light|nord|color/i, words: ['theme', 'dark mode', 'light mode', 'appearance', 'colors'] },
  { test: /context menu|shell/i, words: ['context menu', 'right click', 'shell', 'explorer menu'] },
  { test: /startup|launch|exit|quit/i, words: ['startup', 'launch', 'on start', 'exit', 'quit', 'close'] },
  { test: /tab/i, words: ['tabs', 'tab bar', 'close tab', 'new tab'] },
  { test: /preview/i, words: ['preview', 'preview pane', 'right panel', 'viewer'] },
  { test: /tag/i, words: ['tags', 'label', 'color tag', 'tagging'] },
  { test: /confirm|prompt|ask/i, words: ['confirm', 'ask', 'prompt', 'warning', 'are you sure'] },
  { test: /undo|action log/i, words: ['undo', 'redo', 'history', 'action log'] },
  { test: /drag|drop/i, words: ['drag', 'drop', 'drag and drop', 'dnd'] },
  { test: /search|everything|find|filter/i, words: ['search', 'find', 'filter', 'everything', 'fuzzy'] },
  { test: /icon/i, words: ['icons', 'icon library', 'custom icons'] },
  { test: /font|toolbar|compact/i, words: ['font', 'toolbar', 'compact', 'density'] },
  { test: /network|unc|share/i, words: ['network', 'unc', 'share', 'remote'] },
  { test: /sort|rename/i, words: ['sort', 'rename', 'order', 'natural sort'] },
  { test: /refresh|auto.?refresh/i, words: ['refresh', 'auto refresh', 'reload', 'watch'] },
  { test: /selection|select/i, words: ['selection', 'select', 'highlight', 'marquee'] },
  { test: /wrap|list/i, words: ['wrap', 'list view', 'details'] },
  { test: /tree|sidebar|mini tree/i, words: ['tree', 'sidebar', 'navigation', 'folder tree', 'mini tree'] },
  { test: /default file manager|default manager/i, words: ['default', 'file manager', 'associate', 'open with'] },
  { test: /notification|toast/i, words: ['notification', 'toast', 'popup message', 'alert'] },
  { test: /rapid access|favorite|pin/i, words: ['rapid access', 'favorites', 'pin', 'bookmarks'] },
];

function buildKeywords(label, key, tab) {
  const words = new Set();
  const add = (s) => {
    String(s || '')
      .toLowerCase()
      .split(/[^a-z0-9+]+/i)
      .filter(w => w.length > 1)
      .forEach(w => words.add(w));
  };
  add(label);
  add(camelToWords(key));
  add(tab);
  const blob = `${label} ${key} ${tab}`;
  for (const pack of INTENT_PACKS) {
    if (pack.test.test(blob)) pack.words.forEach(w => add(w));
  }
  return [...words];
}

const out = unique.map(e => ({
  tab: e.tab,
  label: e.label,
  key: e.key || undefined,
  keywords: buildKeywords(e.label, e.key, e.tab),
  description: e.key ? `Controls ${camelToWords(e.key)}` : undefined,
}));

const file = `/** Auto-generated searchable settings index for Jump to Setting.
 * Source: ConfigurationDialog checkbox labels.
 * Regenerate: node scripts/generateJumpSettingIndex.cjs
 */
export const JUMP_SETTING_INDEX: Array<{
  tab: string;
  label: string;
  key?: string;
  description?: string;
  keywords: string[];
}> = ${JSON.stringify(out, null, 2)};
`;

fs.writeFileSync('src/lib/jumpToSettingIndex.data.ts', file);
console.log('Wrote', out.length, 'entries');
