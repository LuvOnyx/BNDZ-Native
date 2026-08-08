/**
 * Legacy ConfigurationDialog / saved-config keys → canonical semantic keys.
 * Applied in normalizeConfig so existing %AppData% configs keep working after renames.
 */
export const SETTINGS_KEY_ALIASES: Record<string, string> = {
  // Column autosize (Styles)
  unwiredConfig3: 'columnAutosizeMinWidth',
  unwiredConfig4: 'columnAutosizeMaxWidth',
  unwiredConfig5: 'columnAutosizeNameMaxWidth',
  unwiredConfig6: 'columnAutosizeNameMinWidth',
  unwiredConfig7: 'columnAutosizeRightMargin',
  unwiredConfig2: 'columnAutosizeExtraPadding',

  // Window / status / shell CLI templates
  unwiredConfig13: 'windowTitleTemplate',
  unwiredConfig14: 'statusBarTemplate',
  unwiredConfig15: 'customShellInterpreter',
  unwiredConfig16: 'customShellArgsTemplate',

  // Filename / date / message templates
  unwiredConfig8: 'copyNameSuffixTemplate',
  unwiredConfig9: 'datedCopyNameTemplate',
  unwiredConfig10: 'messageSaveNameTemplate',
  unwiredConfig11: 'messageSaveNameMaxLen',
  unwiredConfig12: 'messageSaveNamePad',

  // Web path map + compression preview colors
  unwiredConfig1: 'webPathMapSource',
  Config1: 'compressionPreviewBgColor',
  Config2: 'compressionPreviewFgColor',
  Config3: 'webPathMapTarget',

  // Thumbnails
  Config4: 'thumbnailCachePath',
  Config5: 'thumbnailSizePreset1',
  Config6: 'thumbnailSizePreset2',
  Config7: 'thumbnailChromeColor',

  // Preview zoom (orphan selectConfig → real key)
  selectConfig: 'previewZoomPercent',

  // Highlights / Styles (opaque selectConfigN → semantic)
  selectConfig5: 'listZebraStyle',
  selectConfig6: 'listSelectionBorderStyle',
  selectConfig7: 'listSelectionChromeStyle',
  selectConfig8: 'listSelectionFillStyle',
  selectConfig9: 'listHoverFadeSteps',
  selectConfig10: 'listHoverFadeMs',
  selectConfig11: 'listSelectionOpacity',
  selectConfig12: 'listHoverOpacity',
  selectConfig13: 'listInactiveOpacity',
  selectConfig14: 'listGridLineWidth',
  selectConfig15: 'listSortArrowSize',

  // Shell / drag defaults (keep selectConfig1–3 as aliases to clearer names)
  selectConfig1: 'shellIntegrationScope',
  selectConfig2: 'dragDropSameVolumeAction',
  selectConfig3: 'dragDropCrossVolumeAction',
};

/** Copy legacy values onto canonical keys when the new key is still unset/defaulty. */
export function applySettingsKeyAliases(merged: Record<string, any>, raw: Record<string, any>): void {
  for (const [legacy, canonical] of Object.entries(SETTINGS_KEY_ALIASES)) {
    const hasLegacy = legacy in raw || merged[legacy] !== undefined;
    if (!hasLegacy) continue;
    const legacyVal = raw[legacy] !== undefined ? raw[legacy] : merged[legacy];
    const canonicalUnset =
      merged[canonical] === undefined
      || merged[canonical] === false
      || merged[canonical] === ''
      || merged[canonical] === null;
    // Prefer explicit raw write of canonical; else migrate from legacy.
    if (canonical in raw && raw[canonical] !== undefined && raw[canonical] !== false && raw[canonical] !== '') {
      continue;
    }
    if (canonicalUnset || !(canonical in raw)) {
      merged[canonical] = legacyVal;
    }
  }
}
