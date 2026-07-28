import React from 'react';

type Props = {
  rows?: number;
  label?: string;
};

/** Shimmer skeleton rows while the streaming dir engine paints the first chunk. */
export default function ListPaneSkeleton({ rows = 14, label }: Props) {
  return (
    <div className="bndz-list-skeleton flex flex-col h-full min-h-[200px]">
      <div className="bndz-list-skeleton-head">
        <span className="bndz-list-skeleton-pulse" />
        {label ? <span className="bndz-list-skeleton-label">{label}</span> : null}
      </div>
      <div className="bndz-list-skeleton-body flex-1 overflow-hidden px-2 py-1">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="bndz-list-skeleton-row"
            style={{ animationDelay: `${(i % 8) * 45}ms` }}
          >
            <span className="bndz-list-skeleton-icon" />
            <span className="bndz-list-skeleton-line" style={{ width: `${48 + (i % 5) * 9}%` }} />
            <span className="bndz-list-skeleton-meta" />
          </div>
        ))}
      </div>
    </div>
  );
}
