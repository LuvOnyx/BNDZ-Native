import assert from 'node:assert/strict';
import { resolvePanelFont, buildPanelTypographyCssVars } from '../src/lib/panelTypography.ts';

const baseConfig = {
  uiFontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  uiFontWeight: 500,
  fontSize: 12,
  uiFontFamilyMono: '"Cascadia Code", Consolas, monospace',
  treeFontSize: 0,
  listFontSize: 0,
  previewFontSize: 0,
  bottomFontSize: 0,
  statusFontSize: 0,
  chromeFontSize: 0,
  treeFontFamily: '',
  listFontFamily: '',
  previewFontFamily: '',
  bottomFontFamily: '',
  statusFontFamily: '',
  chromeFontFamily: '',
};

const tree = resolvePanelFont(baseConfig, 'tree');
assert.equal(tree.size, 12);
assert.equal(tree.weight, 500);
assert.ok(tree.family.includes('Segoe UI Variable'));

const overridden = resolvePanelFont({
  ...baseConfig,
  previewFontFamily: 'Inter, sans-serif',
  previewFontSize: 14,
}, 'preview');
assert.equal(overridden.family, 'Inter, sans-serif');
assert.equal(overridden.size, 14);

const vars = buildPanelTypographyCssVars(baseConfig);
assert.equal(vars['--bndz-font-preview-size'], '12px');
assert.ok(vars['--bndz-font-family-mono'].includes('Cascadia Code'));

console.log('panelTypography: ok');
