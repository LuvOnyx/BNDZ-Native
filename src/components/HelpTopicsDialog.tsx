import React from 'react';
import { BndzNativeDialog } from './BndzNativeDialog';

const TOPICS = [
  { title: 'Navigation', body: 'Use the tree, breadcrumbs, and address bar to move between folders. Dual pane mode lets you compare two locations side by side.' },
  { title: 'File operations', body: 'Cut, copy, paste, and delete work like Explorer. Hold Ctrl or Alt while dropping to copy instead of move.' },
  { title: 'Drag and drop', body: 'Drag files between list panes and the navigation tree. Hold Alt while dragging to start a native OS drag to other applications.' },
  { title: 'Search & filter', body: 'Press / to fuzzy-filter the current folder. Use Everything integration from the Search menu when enabled.' },
  { title: 'Customization', body: 'Open Configuration from the Tools menu to adjust themes, toolbars, previews, and behavior. Use Jump to Setting to find options quickly.' },
  { title: 'Support', body: 'Register your license from Help → Register Product. For assistance, contact support with your order email and serial number.' },
];

export default function HelpTopicsDialog({ onClose }: { onClose: () => void }) {
  return (
    <BndzNativeDialog
      open
      title="Help Topics"
      subtitle="Quick guide to BNDZ"
      tone="info"
      iconId="bookopen_ui"
      onClose={onClose}
      buttons={[{ label: 'Close', style: 'primary', onClick: onClose }]}
      zIndexClass="z-[520]"
    >
      <div className="space-y-2 max-h-[50vh] overflow-y-auto bndz-scrollbar -mt-1">
        {TOPICS.map(t => (
          <div key={t.title} className="bndz-native-dialog-panel px-4 py-3">
            <div className="text-[12px] font-semibold mb-1">{t.title}</div>
            <p className="text-[11px] bndz-native-dialog-muted leading-relaxed">{t.body}</p>
          </div>
        ))}
      </div>
    </BndzNativeDialog>
  );
}
