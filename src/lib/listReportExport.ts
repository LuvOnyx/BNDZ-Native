import type { AppConfig } from '../data/configContext';

/** Resolve Settings → CSV field separator (system / tab / other). */
export function resolveCsvSeparator(config: AppConfig): string {
  const mode = String(config.csvFieldSeparator || 'system').toLowerCase();
  if (mode === 'tab') return '\t';
  if (mode === 'other') {
    const other = String(config.csvOtherSeparator ?? ',');
    return other.length ? other[0] : ',';
  }
  // system — locale list separator where available
  try {
    const sample = (1.1).toLocaleString();
    // Most locales use ',' or '.' for decimals; CSV system sep is often '; ' in EU
    const parts = (1000).toLocaleString().match(/[^\d]/);
    if (parts?.[0] && parts[0] !== '.' && parts[0] !== ',') return parts[0];
  } catch { /* ignore */ }
  return ',';
}

export function formatReportCsvFilename(config: AppConfig, folderName: string): string {
  const base = config.defaultNameToCurrentFolderTxt
    ? (folderName || 'report').replace(/[<>:"/\\|?*]/g, '_')
    : 'report';
  if (!config.dateTimeAsFilenameSuffix) return `${base}.csv`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${base}_${stamp}.csv`;
}

function csvEscape(value: string, sep: string): string {
  const needsQuote = value.includes('"') || value.includes('\n') || value.includes('\r') || value.includes(sep);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export type ListReportEntity = {
  name?: string;
  type?: string;
  size?: number;
  modified?: string;
  path?: string;
  extension?: string;
  isDirectory?: boolean;
};

/** Build a folder listing CSV honoring report export settings. */
export function buildListReportCsv(
  config: AppConfig,
  entities: ListReportEntity[],
  opts?: { folderPath?: string },
): { csv: string; filename: string; separator: string } {
  const sep = resolveCsvSeparator(config);
  const includeFiles = config.includeFiles !== false;
  const includeBasic = config.includeBasicItemData !== false;
  const wrapWidth = Math.max(0, Number(config.tableWidthCharacters) || 0);

  const rows = entities.filter((e) => {
    const isDir = e.type === 'directory' || e.type === 'folder' || e.isDirectory;
    if (!includeFiles && !isDir) return false;
    return true;
  });

  const headers = includeBasic
    ? ['name', 'type', 'size', 'modified', 'path']
    : ['name', 'path'];

  const lines = [headers.join(sep)];
  for (const e of rows) {
    const isDir = e.type === 'directory' || e.type === 'folder' || e.isDirectory;
    let name = String(e.name || '');
    if (wrapWidth > 0 && name.length > wrapWidth) {
      // Soft-break oversized names for report readability (pairs with line-feed setting).
      const parts: string[] = [];
      for (let i = 0; i < name.length; i += wrapWidth) parts.push(name.slice(i, i + wrapWidth));
      name = parts.join(config.lineFeedOnOversizedFilenames ? '\n' : ' ');
    }
    const path = String(e.path || opts?.folderPath || '');
    if (includeBasic) {
      lines.push([
        csvEscape(name, sep),
        csvEscape(isDir ? 'directory' : (e.extension || e.type || 'file'), sep),
        csvEscape(isDir ? '' : String(e.size ?? ''), sep),
        csvEscape(String(e.modified || ''), sep),
        csvEscape(path, sep),
      ].join(sep));
    } else {
      lines.push([csvEscape(name, sep), csvEscape(path, sep)].join(sep));
    }
  }

  const leaf = (opts?.folderPath || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'report';
  return {
    csv: lines.join('\n'),
    filename: formatReportCsvFilename(config, leaf),
    separator: sep,
  };
}

/** Apply web path map (Settings → Preview / Server mappings). */
export function applyWebPathMap(config: AppConfig, filePath: string): string {
  const source = String(config.webPathMapSource || '');
  const target = String(config.webPathMapTarget || '');
  if (!source || !target || !filePath) return filePath;
  const norm = filePath.replace(/\\/g, '/');
  const src = source.replace(/\\/g, '/');
  if (norm.toLowerCase().startsWith(src.toLowerCase())) {
    return target.replace(/\\/g, '/') + norm.slice(src.length);
  }
  return filePath;
}

/** Resolve a pasted / typed path when "Honor relative paths" is on. */
export function resolveHonoredPath(config: AppConfig, path: string, baseFolder: string): string {
  const raw = String(path || '').trim();
  if (!raw) return raw;
  if (!config.honorRelativePaths) return raw;
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/') || raw.startsWith('shell:')) {
    return raw;
  }
  const base = String(baseFolder || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = raw.replace(/\\/g, '/');
  return `${base}/${rel}`.replace(/\/+/g, '/');
}

export function formatCopyNameFromTemplates(config: AppConfig, baseName: string, dated = false): string {
  const suffix = String(config.copyNameSuffixTemplate || '-01');
  const datedTpl = String(config.datedCopyNameTemplate || '*-<date yyyymmdd>');
  if (dated) {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const ymd = `${y}${m}${d}`;
    return datedTpl
      .replace(/\*/g, baseName)
      .replace(/<date\s*yyyymmdd>/gi, ymd)
      .replace(/\{name\}/gi, baseName)
      .replace(/\{yyyy\}/gi, y)
      .replace(/\{MM\}/gi, m)
      .replace(/\{dd\}/gi, d);
  }
  const stem = baseName.replace(/(\.[^.]+)?$/, '');
  const ext = baseName.slice(stem.length);
  return `${stem}${suffix}${ext}`;
}

export function formatMessageSaveName(
  config: AppConfig,
  parts: { from?: string; to?: string; subject?: string },
): string {
  const tpl = String(config.messageSaveNameTemplate || '<from>_<to>_<subject>_<date yyyy-mm-dd_hh-nn-ss>');
  const now = new Date();
  const pad = String(config.messageSaveNamePad ?? '0');
  const padNum = (n: number, w = 2) => String(n).padStart(w, pad === '0' ? '0' : ' ');
  const date =
    `${now.getFullYear()}-${padNum(now.getMonth() + 1)}-${padNum(now.getDate())}`
    + `_${padNum(now.getHours())}-${padNum(now.getMinutes())}-${padNum(now.getSeconds())}`;
  let name = tpl
    .replace(/<from>/gi, parts.from || 'from')
    .replace(/<to>/gi, parts.to || 'to')
    .replace(/<subject>/gi, parts.subject || 'message')
    .replace(/<date\s*yyyy-mm-dd_hh-nn-ss>/gi, date);
  const maxLen = Number(config.messageSaveNameMaxLen);
  if (Number.isFinite(maxLen) && maxLen > 8 && name.length > maxLen) {
    name = name.slice(0, maxLen);
  }
  return name.replace(/[<>:"/\\|?*]/g, '_');
}
