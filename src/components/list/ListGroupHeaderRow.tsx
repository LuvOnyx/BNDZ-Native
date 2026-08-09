import React from 'react';

export type ListGroupHeaderRowProps = {
  label: string;
  count: number;
  rowHeight: number;
  sticky: boolean;
};

function ListGroupHeaderRow({ label, count, rowHeight, sticky }: ListGroupHeaderRowProps) {
  return (
    <div
      className={`z-10 flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-wider text-[#99c9f0] bg-[#252526] border-y border-[#454545] ${
        sticky ? 'sticky top-0' : ''
      }`}
      style={{ height: rowHeight, boxSizing: 'border-box' }}
    >
      <span>{label}</span>
      <span className="text-gray-500 font-normal normal-case">({count})</span>
    </div>
  );
}

export default React.memo(ListGroupHeaderRow);
