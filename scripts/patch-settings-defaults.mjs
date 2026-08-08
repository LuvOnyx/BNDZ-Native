import fs from 'fs';

const p = 'src/lib/settingsDefaults.ts';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('compressionPreviewBgColor')) {
  console.log('already patched');
  process.exit(0);
}

const inserts = `
  // Semantic settings keys (legacy ConfigN/unwiredConfig* aliased in settingsKeyAliases)
  compressionPreviewBgColor: 'FFFFFF',
  compressionPreviewFgColor: 'E8E8E8',
  webPathMapSource: '',
  webPathMapTarget: 'http://localhost/',
  thumbnailCachePath: 'Thumbnails\\\\',
  thumbnailSizePreset1: '64',
  thumbnailSizePreset2: '192',
  thumbnailChromeColor: 'F9F9F9',
  columnAutosizeMinWidth: '175',
  columnAutosizeMaxWidth: '0',
  columnAutosizeNameMaxWidth: '1000',
  columnAutosizeNameMinWidth: '200',
  columnAutosizeRightMargin: '0',
  columnAutosizeExtraPadding: '',
  windowTitleTemplate: '<path> - <app> <ver>',
  statusBarTemplate: '<items> item(s)',
  customShellInterpreter: '',
  customShellArgsTemplate: '',
  copyNameSuffixTemplate: '-01',
  datedCopyNameTemplate: '*-<date yyyymmdd>',
  messageSaveNameTemplate: '<from>_<to>_<subject>_<date yyyy-mm-dd_hh-nn-ss>',
  messageSaveNameMaxLen: '',
  messageSaveNamePad: '0',
  previewZoomPercent: '100%',
  listZebraStyle: 'Zebra Stripes: Alternate Rows (1)',
  listSelectionBorderStyle: 'No border',
  listSelectionChromeStyle: 'BNDZ Style (Rounded)',
  listSelectionFillStyle: 'Solid',
  listHoverFadeSteps: '1',
  listHoverFadeMs: '12',
  listSelectionOpacity: '60',
  listHoverOpacity: '30',
  listInactiveOpacity: '0',
  listGridLineWidth: '2',
  listSortArrowSize: '6',
  shellIntegrationScope: 'Only for the current user',
  dragDropSameVolumeAction: 'Move (Windows Standard)',
  dragDropCrossVolumeAction: 'Copy (Windows Standard)',
`;

s = s.replace(
  'export const SETTINGS_DEFAULTS: Record<string, any> = {',
  `export const SETTINGS_DEFAULTS: Record<string, any> = {${inserts}`,
);
fs.writeFileSync(p, s);
console.log('defaults patched');
