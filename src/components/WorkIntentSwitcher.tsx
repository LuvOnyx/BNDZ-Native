import React from 'react';
import { WORK_INTENT_PACKS, applyWorkIntentPack } from '../lib/workIntentPacks';
import type { WorkIntentId } from '../lib/workIntentPacks';
import { useAppConfig } from '../data/configContext';

const INTENT_ICONS: Record<WorkIntentId, string> = {
  browse: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5z',
  ingest: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  archive: 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27z',
  fix: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  ship: 'M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2z',
  review: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
};

interface Props {
  openBottomPlugin: (id: string) => void;
}

export default function WorkIntentSwitcher({ openBottomPlugin }: Props) {
  const { config, updateConfig } = useAppConfig();
  const activeId = (config.workIntentId as WorkIntentId) || 'browse';

  const handleChange = (id: WorkIntentId) => {
    applyWorkIntentPack(id, { openBottomPlugin, updateConfig });
  };

  return (
    <div className="bndz-work-intent-switcher inline-flex items-center bg-black/25 rounded-lg border border-white/[0.06] p-[2px] gap-[1px]">
      {WORK_INTENT_PACKS.map(pack => {
        const isActive = pack.id === activeId;
        return (
          <button
            key={pack.id}
            type="button"
            onClick={() => handleChange(pack.id)}
            title={pack.description}
            className={`
              bndz-work-intent-btn relative flex items-center gap-1 px-2 py-[3px] rounded-md text-[10px] font-semibold uppercase tracking-wider transition-all duration-150
              ${isActive
                ? 'bg-[#094771]/50 text-sky-300 border border-sky-500/30 shadow-[0_0_6px_rgba(56,189,248,0.12)]'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] border border-transparent'
              }
            `}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 opacity-70">
              <path d={INTENT_ICONS[pack.id]} />
            </svg>
            {pack.label}
          </button>
        );
      })}
    </div>
  );
}
