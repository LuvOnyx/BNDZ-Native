import React, { useEffect, useRef, useState } from 'react';
import { matchesColumnPattern, parseCustomColumnListId } from '../lib/customColumns';
import { getExtendedMetadataCached, peekExtendedMetadata } from '../lib/extendedMetadataCache';
import { toWindowsPath, joinPanePath } from '../lib/pathUtils';

export default function CustomColumnCell({
  colId,
  entity,
  panePath,
  propertyKey,
  pattern,
}: {
  colId: string;
  entity: any;
  panePath: string;
  propertyKey: string;
  pattern?: string;
}) {
  const customId = parseCustomColumnListId(colId);
  const cellRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState('');

  useEffect(() => {
    const el = cellRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: null, rootMargin: '80px 0px', threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!customId || entity.type === 'directory' || (pattern && !matchesColumnPattern(pattern, entity))) {
      setValue('');
      return;
    }
    if (!visible) return;

    const path = toWindowsPath(entity.path || joinPanePath(panePath, entity));
    const peek = peekExtendedMetadata(path);
    if (peek) {
      const v = propertyKey === 'md5' ? (peek.md5 || '') : (peek.meta[propertyKey] || '');
      setValue(v);
      if (propertyKey !== 'md5' || peek.md5) return;
    }

    let active = true;
    if (!peek) setValue('…');

    void getExtendedMetadataCached(path, {
      includeMd5: propertyKey === 'md5',
      priority: 550,
    }).then(entry => {
      if (!active) return;
      const v = propertyKey === 'md5' ? (entry.md5 || '') : (entry.meta[propertyKey] || '');
      setValue(v);
    }).catch(() => {
      if (active) setValue('');
    });

    return () => { active = false; };
  }, [colId, customId, entity.id, entity.path, panePath, propertyKey, entity.type, pattern, entity.extension, visible]);

  return (
    <div
      ref={cellRef}
      className="bndz-list-select-cell px-2 bndz-detail-col-muted whitespace-nowrap overflow-hidden text-ellipsis text-[11px] font-mono"
      title={value}
    >
      {value}
    </div>
  );
}
