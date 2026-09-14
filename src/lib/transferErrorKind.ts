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
  neededBytes?: number;
  freeBytes?: number;
  /** Ready-to-show capacity line when bytes are known. */
  capacityLine?: string;
};

const DISK_FULL_RE =
  /not enough free space|disk full|insufficient disk|ERROR_DISK_FULL|\b112\b|0x80070070/i;
const SHARING_RE =
  /being used by another process|sharing violation|ERROR_SHARING_VIOLATION|\b32\b|locked|in use/i;
const PATH_LONG_RE =
  /path too long|filename.*long|ERROR_FILENAME_EXCED_RANGE|\b206\b|MAX_PATH|247 characters/i;
const ACCESS_RE =
  /access is denied|access denied|unauthorized|requires administrator|elevation|E_ACCESSDENIED|ERROR_ACCESS_DENIED|0x80070005/i;

/** Host emits e.g. "Need 1.5 GB, have 420 MB" (FileOperationPathPlanner). */
const NEED_HAVE_RE =
  /Need\s+([\d.,]+)\s*([KMGT]?B)\s*,\s*have\s+([\d.,]+)\s*([KMGT]?B)/i;

const UNIT_MULT: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

export function parseByteSizeToken(value: string, unit: string): number | undefined {
  const n = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return undefined;
  const mult = UNIT_MULT[unit.toUpperCase()] ?? 1;
  return Math.round(n * mult);
}

export function formatTransferBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function parseNeedHaveFromMessage(message: string): { neededBytes?: number; freeBytes?: number } {
  const m = NEED_HAVE_RE.exec(message || '');
  if (!m) return {};
  return {
    neededBytes: parseByteSizeToken(m[1], m[2]),
    freeBytes: parseByteSizeToken(m[3], m[4]),
  };
}

export function buildCapacityLine(neededBytes?: number, freeBytes?: number): string | undefined {
  if (neededBytes == null && freeBytes == null) return undefined;
  if (neededBytes != null && freeBytes != null) {
    const shortfall = Math.max(0, neededBytes - freeBytes);
    return shortfall > 0
      ? `Need ${formatTransferBytes(neededBytes)} · free ${formatTransferBytes(freeBytes)} · short ${formatTransferBytes(shortfall)}`
      : `Need ${formatTransferBytes(neededBytes)} · free ${formatTransferBytes(freeBytes)}`;
  }
  if (neededBytes != null) return `Need ${formatTransferBytes(neededBytes)}`;
  return `Free ${formatTransferBytes(freeBytes!)}`;
}

/** Match a Windows drive root from a destination path against annotated drives. */
export function freeBytesForDestination(
  destPath: string | null | undefined,
  drives: Array<{ name?: string; letter?: string; freeSpace?: number }>,
): number | undefined {
  if (!destPath || !drives?.length) return undefined;
  const win = destPath.replace(/\//g, '\\');
  const letter = /^([A-Za-z]:)/.exec(win)?.[1]?.toUpperCase();
  if (!letter) return undefined;
  const hit = drives.find(d => {
    const n = String(d.name || d.letter || '').replace(/\//g, '\\').toUpperCase();
    return n === letter || n === `${letter}\\` || n.startsWith(`${letter}\\`);
  });
  const free = hit?.freeSpace;
  return typeof free === 'number' && Number.isFinite(free) ? free : undefined;
}

export function classifyTransferError(
  message: string | null | undefined,
  code?: string | null,
  extras?: { neededBytes?: number; freeBytes?: number },
): ClassifiedTransferError {
  const detail = (message || '').trim() || 'The file operation failed.';
  const blob = `${code || ''} ${detail}`;
  const parsed = parseNeedHaveFromMessage(detail);
  const neededBytes = extras?.neededBytes ?? parsed.neededBytes;
  const freeBytes = extras?.freeBytes ?? parsed.freeBytes;
  const capacityLine = buildCapacityLine(neededBytes, freeBytes);

  if (DISK_FULL_RE.test(blob) || code === 'diskFull' || code === '112' || parsed.neededBytes != null) {
    return {
      kind: 'diskFull',
      title: 'Not enough disk space',
      summary: capacityLine
        ? `The destination volume does not have enough free space (${capacityLine}).`
        : 'The destination volume does not have enough free space for this transfer.',
      detail,
      neededBytes,
      freeBytes,
      capacityLine,
    };
  }
  if (SHARING_RE.test(blob) || code === 'sharingViolation' || code === '32') {
    return {
      kind: 'sharingViolation',
      title: 'File in use',
      summary: 'Windows reports the file is locked by another program. Close the app using it, then Retry — or Skip to dismiss.',
      detail,
    };
  }
  if (PATH_LONG_RE.test(blob) || code === 'pathTooLong' || code === '206') {
    return {
      kind: 'pathTooLong',
      title: 'Path too long',
      summary:
        'The destination path exceeds Windows limits. Shorten folder or file names under the destination (or move closer to the drive root), then Retry. Skip dismisses this failure.',
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
