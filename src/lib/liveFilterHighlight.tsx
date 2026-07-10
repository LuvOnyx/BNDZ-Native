import React from 'react';

/** Highlight live-filter matches in file names (substring or /regex/). */
export function highlightNameMatch(name: string, filter: string): React.ReactNode {
  const f = filter.trim();
  if (!f || f.startsWith('> ')) return name;

  if (f.startsWith('/') && f.endsWith('/') && f.length > 2) {
    try {
      const re = new RegExp(f.slice(1, -1), 'i');
      const m = name.match(re);
      if (!m || m.index === undefined) return name;
      return (
        <>
          {name.slice(0, m.index)}
          <mark className="bg-amber-500/35 text-inherit rounded-sm px-0.5">{m[0]}</mark>
          {name.slice(m.index + m[0].length)}
        </>
      );
    } catch {
      return name;
    }
  }

  const idx = name.toLowerCase().indexOf(f.toLowerCase());
  if (idx < 0) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="bg-[#0078d4]/30 text-inherit rounded-sm px-0.5">{name.slice(idx, idx + f.length)}</mark>
      {name.slice(idx + f.length)}
    </>
  );
}
