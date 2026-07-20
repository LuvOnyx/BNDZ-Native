export type ColorFilterRow = {
  i: number;
  c: boolean;
  t: string;
  style: string;
  /** Optional colored folder icon for matching directories (see folderColorIcons). */
  folderIcon?: string;
};

export function nextColorFilterId(rows: ColorFilterRow[]): number {
  const max = rows.reduce((m, r) => Math.max(m, r.i || 0), 0);
  return max + 1;
}

export function createColorFilterRow(rows: ColorFilterRow[]): ColorFilterRow {
  return { i: nextColorFilterId(rows), c: true, t: '*.txt', style: 'text-[#e0e0e0]' };
}

export function moveColorFilterRow(rows: ColorFilterRow[], index: number, direction: -1 | 1): ColorFilterRow[] {
  const next = [...rows];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  return next;
}

export function updateColorFilterStyle(style: string, part: 'text' | 'bg', color: string | null): string {
  const textMatch = style.match(/text-\[([^\]]+)\]/);
  const bgMatch = style.match(/bg-\[([^\]]+)\]/);
  let text = textMatch?.[1];
  let bg = bgMatch?.[1];
  if (part === 'text') text = color || undefined;
  if (part === 'bg') bg = color || undefined;
  const parts: string[] = [];
  if (text) parts.push(`text-[${text}]`);
  if (bg) parts.push(`bg-[${bg}]`);
  return parts.join(' ') || 'text-[#e0e0e0]';
}

export function colorFilterDrawClasses(config: Record<string, unknown>): string {
  const classes: string[] = [];
  if (config.drawBackgroundColorsAsRoundedRectangles) classes.push('bndz-filter-bg-rounded');
  if (config.drawBackgroundColorsInDistinctiveShapes) classes.push('bndz-filter-bg-shape');
  if (config.drawBackgroundColorsAsWideAsTheColumn) classes.push('bndz-filter-bg-wide');
  return classes.join(' ');
}
