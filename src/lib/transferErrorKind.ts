/** Classify transfer / FS failure text (and optional host codes) into ops-dialog kinds. */

export type TransferErrorKind =
  | 'diskFull'
  | 'sharingViolation'
  | 'pathTooLong'
  | 'accessDenied'
  | 'other';

export type ClassifiedTransferError = {
  kind: TransferErrorKind;
  title: string;
  summary: string;
  /** Prefer host message when present. */
  detail: string;
};

const DISK_FULL_RE =
  /not enough free space|disk full|insufficient disk|ERROR_DISK_FULL|\b112\b|0x80070070/i;
const SHARING_RE =
  /being used by another process|sharing violation|ERROR_SHARING_VIOLATION|\b32\b|locked|in use/i;
const PATH_LONG_RE =
  /path too long|filename.*long|ERROR_FILENAME_EXCED_RANGE|\b206\b|MAX_PATH|247 characters/i;
const ACCESS_RE =
  /access is denied|access denied|unauthorized|requires administrator|elevation|E_ACCESSDENIED|ERROR_ACCESS_DENIED|0x80070005/i;

export function classifyTransferError(
  message: string | null | undefined,
  code?: string | null,
): ClassifiedTransferError {
  const detail = (message || '').trim() || 'The file operation failed.';
  const blob = `${code || ''} ${detail}`;

  if (DISK_FULL_RE.test(blob) || code === 'diskFull' || code === '112') {
    return {
      kind: 'diskFull',
      title: 'Not enough disk space',
      summary: 'The destination volume does not have enough free space for this transfer.',
      detail,
    };
  }
  if (SHARING_RE.test(blob) || code === 'sharingViolation' || code === '32') {
    return {
      kind: 'sharingViolation',
      title: 'File in use',
      summary: 'Windows reports the file is locked by another program.',
      detail,
    };
  }
  if (PATH_LONG_RE.test(blob) || code === 'pathTooLong' || code === '206') {
    return {
      kind: 'pathTooLong',
      title: 'Path too long',
      summary: 'The destination path exceeds Windows limits. Shorten folder names or enable long-path support.',
      detail,
    };
  }
  if (ACCESS_RE.test(blob) || code === 'accessDenied' || code === '5') {
    return {
      kind: 'accessDenied',
      title: 'Permission required',
      summary: 'This location needs administrator approval or different permissions.',
      detail,
    };
  }
  return {
    kind: 'other',
    title: 'Operation failed',
    summary: detail,
    detail,
  };
}

export const PENDING_ELEVATION_TRANSFER_KEY = 'bndz-pending-elevated-transfer';

export type PendingElevatedTransfer = {
  action: 'copy' | 'move';
  sources: string[];
  destDir: string;
  savedAt: number;
};

export function stashPendingElevatedTransfer(op: PendingElevatedTransfer): void {
  try {
    sessionStorage.setItem(PENDING_ELEVATION_TRANSFER_KEY, JSON.stringify(op));
  } catch { /* ignore */ }
}

export function consumePendingElevatedTransfer(): PendingElevatedTransfer | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ELEVATION_TRANSFER_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_ELEVATION_TRANSFER_KEY);
    const parsed = JSON.parse(raw) as PendingElevatedTransfer;
    if (!parsed?.sources?.length || !parsed.destDir) return null;
    if (Date.now() - (parsed.savedAt || 0) > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}
