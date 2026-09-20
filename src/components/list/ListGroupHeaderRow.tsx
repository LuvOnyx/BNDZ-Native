import React from 'react';

export type ListGroupHeaderRowProps = {
  label: string;
  count: number;
  rowHeight: number;
  sticky: boolean;
};

/**
 * In-list type/date group strip (FOLDERS / IMAGES / â€¦).
 * Uses the same chrome as the sticky overlay (`.bndz-list-sticky-group-header`)
 * row stays flush (uniform height); strip air via content-box clip so labels stay centered. Was: â€” no top margin / top border gap.
 */
function ListGroupHeaderRow({ label, count, rowHeight, sticky }: ListGroupHeaderRowProps) {
  return (
    <div
      className={`bndz-list-group-header bndz-list-sticky-group-header z-10 flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-wider ${
        sticky ? 'sticky top-0' : ''
      }`}
      style={{ height: rowHeight, boxSizing: 'border-box', margin: 0 }}
    >
      <span>{label}</span>
      <span className="bndz-list-group-header-count text-gray-500 font-normal normal-case">({count})</span>
    </div>
  );
}

export default React.memo(ListGroupHeaderRow);
