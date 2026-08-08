/**
 * Bulk-rename legacy settings keys in ConfigurationDialog + key consumers.
 * Safe string replacements for Wave 1 of settings wiring overhaul.
 */
import fs from 'fs';

const replacements = [
  // UI + consumers: ConfigN / unwiredConfig*
  ['Config4', 'thumbnailCachePath'],
  ['Config5', 'thumbnailSizePreset1'],
  ['Config6', 'thumbnailSizePreset2'],
  ['Config7', 'thumbnailChromeColor'],
  ['Config1', 'compressionPreviewBgColor'],
  ['Config2', 'compressionPreviewFgColor'],
  ['Config3', 'webPathMapTarget'],
  ['unwiredConfig1', 'webPathMapSource'],
  ['unwiredConfig2', 'columnAutosizeExtraPadding'],
  ['unwiredConfig3', 'columnAutosizeMinWidth'],
  ['unwiredConfig4', 'columnAutosizeMaxWidth'],
  ['unwiredConfig5', 'columnAutosizeNameMaxWidth'],
  ['unwiredConfig6', 'columnAutosizeNameMinWidth'],
  ['unwiredConfig7', 'columnAutosizeRightMargin'],
  ['unwiredConfig8', 'copyNameSuffixTemplate'],
  ['unwiredConfig9', 'datedCopyNameTemplate'],
  ['unwiredConfig10', 'messageSaveNameTemplate'],
  ['unwiredConfig11', 'messageSaveNameMaxLen'],
  ['unwiredConfig12', 'messageSaveNamePad'],
  ['unwiredConfig13', 'windowTitleTemplate'],
  ['unwiredConfig14', 'statusBarTemplate'],
  ['unwiredConfig15', 'customShellInterpreter'],
  ['unwiredConfig16', 'customShellArgsTemplate'],
  ['selectConfig1', 'shellIntegrationScope'],
  ['selectConfig2', 'dragDropSameVolumeAction'],
  ['selectConfig3', 'dragDropCrossVolumeAction'],
  ['selectConfig5', 'listZebraStyle'],
  ['selectConfig6', 'listSelectionBorderStyle'],
  ['selectConfig7', 'listSelectionChromeStyle'],
  ['selectConfig8', 'listSelectionFillStyle'],
  ['selectConfig9', 'listHoverFadeSteps'],
  ['selectConfig10', 'listHoverFadeMs'],
  ['selectConfig11', 'listSelectionOpacity'],
  ['selectConfig12', 'listHoverOpacity'],
  ['selectConfig13', 'listInactiveOpacity'],
  ['selectConfig14', 'listGridLineWidth'],
  ['selectConfig15', 'listSortArrowSize'],
];

// Order matters: replace longer/more-specific first (already ordered Config4 before Config1 etc for digits;
// but selectConfig15 before selectConfig1)
replacements.sort((a, b) => b[0].length - a[0].length);

const files = [
  'src/components/ConfigurationDialog.tsx',
  'src/lib/columnAutosize.ts',
  'src/lib/shellExecuteRuntime.ts',
  'src/components/BNDZUI.tsx',
  'src/components/RightPreviewPanel.tsx',
  'src/lib/jumpToSettingIndex.ts',
  'src/lib/jumpToSettingIndex.data.ts',
  'src/lib/settingsRuntime.ts',
  'src/lib/settingsWiring.ts',
];

function replaceKeysInText(text) {
  let out = text;
  for (const [from, to] of replacements) {
    // word-boundary-ish replacements for identifier uses
    const re = new RegExp(`\\b${from}\\b`, 'g');
    out = out.replace(re, to);
  }
  return out;
}

for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log('skip missing', f);
    continue;
  }
  const before = fs.readFileSync(f, 'utf8');
  let after = replaceKeysInText(before);
  // Preview zoom: selectConfig → previewZoomPercent (orphan key)
  if (f.includes('RightPreviewPanel')) {
    after = after.replace(/config\.selectConfig\b/g, 'config.previewZoomPercent');
    after = after.replace(/config\.previewZoomPercent \|\| "100%"/g, 'config.previewZoomPercent || "100%"');
  }
  if (after !== before) {
    fs.writeFileSync(f, after);
    console.log('updated', f);
  } else {
    console.log('unchanged', f);
  }
}

console.log('done');
