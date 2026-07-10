import React, { useEffect, useState } from 'react';
import { parseCustomColumnListId } from '../lib/customColumns';
import { getExtendedMetadataCached } from '../lib/extendedMetadataCache';
import { toWindowsPath, joinPanePath } from '../lib/pathUtils';

export default function CustomColumnCell({
  colId,
  entity,
  panePath,
  propertyKey,
}: {
  colId: string;
  entity: any;
  panePath: string;
  propertyKey: string;
}) {
  const customId = parseCustomColumnListId(colId);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!customId || entity.type === 'directory') {
      setValue('');
      return;
    }
    const path = toWindowsPath(entity.path || joinPanePath(panePath, entity));
    let active = true;
    setValue('…');
    void getExtendedMetadataCached(path, { includeMd5: propertyKey === 'md5' }).then(entry => {
      if (!active) return;
      const v = propertyKey === 'md5' ? (entry.md5 || '') : (entry.meta[propertyKey] || '');
      setValue(v);
    }).catch(() => {
      if (active) setValue('');
    });
    return () => { active = false; };
  }, [colId, customId, entity.id, entity.path, panePath, propertyKey, entity.type]);

  return (
    <div className="bndz-list-select-cell px-2 bndz-detail-col-muted whitespace-nowrap overflow-hidden text-ellipsis text-[11px] font-mono" title={value}>
      {value}
    </div>
  );
}
