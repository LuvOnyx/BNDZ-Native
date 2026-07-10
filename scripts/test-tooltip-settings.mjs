/**
 * Unit tests for tooltip list gating and media classification.
 * Run: tsx scripts/test-tooltip-settings.mjs
 */
import assert from 'assert';
import { shouldShowTooltipForEntity } from '../src/lib/tooltipSettings.ts';
import { classifyTooltipMedia } from '../src/lib/tooltipMedia.ts';

const baseConfig = {
  showFileInfoTips: true,
  listHoverTooltipsEnabled: true,
  whenHoveringOverTheFilename: true,
};

assert.strictEqual(shouldShowTooltipForEntity({ extension: 'txt', type: 'file' }, baseConfig, 'list'), true);
assert.strictEqual(
  shouldShowTooltipForEntity({ extension: 'txt', type: 'file' }, { ...baseConfig, listHoverTooltipsEnabled: false }, 'list'),
  false,
);
assert.strictEqual(
  shouldShowTooltipForEntity({ extension: 'txt', type: 'file' }, { ...baseConfig, listHoverTooltipsEnabled: false }, 'tree'),
  true,
);

assert.strictEqual(classifyTooltipMedia('jpg'), 'image');
assert.strictEqual(classifyTooltipMedia('svg'), 'svg');
assert.strictEqual(classifyTooltipMedia('mp3'), 'audio');
assert.strictEqual(classifyTooltipMedia('txt'), null);

console.log('tooltip settings tests passed');
