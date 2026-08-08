/** Settings → Directional formatting codes protection (strip bidi overlays). */

const BIDI_FORMAT_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function stripDirectionalFormattingCodes(value: string): string {
  return String(value || '').replace(BIDI_FORMAT_RE, '');
}

/** When protection is on, strip hidden bidi marks from names before display/rename. */
export function protectDirectionalFormatting(
  value: string,
  config: { directionalFormattingCodesProtection?: boolean | string },
): string {
  const on = config.directionalFormattingCodesProtection === true
    || config.directionalFormattingCodesProtection === 'true'
    || config.directionalFormattingCodesProtection === '1';
  return on ? stripDirectionalFormattingCodes(value) : value;
}
