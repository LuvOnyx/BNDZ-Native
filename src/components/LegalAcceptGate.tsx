import React, { useState } from 'react';
import { IPC } from '../lib/ipcBridge';
import { BndzNativeDialog } from './BndzNativeDialog';

function alreadyAccepted(): boolean {
  try {
    return localStorage.getItem('bndz-legal-accepted') === '1';
  } catch {
    return false;
  }
}

/** First-run EULA + Privacy acceptance gate. */
export default function LegalAcceptGate({ children }: { children: React.ReactNode }) {
  const [accepted, setAccepted] = useState(alreadyAccepted);

  if (accepted) return <>{children}</>;

  const accept = () => {
    try { localStorage.setItem('bndz-legal-accepted', '1'); } catch { /* ignore */ }
    setAccepted(true);
  };

  const openDoc = async (doc: 'eula' | 'privacy') => {
    try {
      if (typeof IPC.openLegalDoc === 'function') {
        await IPC.openLegalDoc(doc);
      }
    } catch { /* ignore */ }
  };

  return (
    <>
      {children}
      <BndzNativeDialog
        open
        title="Welcome to BNDZ"
        subtitle="Please review the license and privacy terms before continuing."
        tone="info"
        variant="sheet"
        size="md"
        onClose={() => { /* must accept */ }}
        buttons={[
          { label: 'View EULA', style: 'secondary', onClick: () => void openDoc('eula') },
          { label: 'View Privacy', style: 'secondary', onClick: () => void openDoc('privacy') },
          { label: 'I Agree', style: 'primary', onClick: accept },
        ]}
      >
        <div className="space-y-2 text-[12px] text-[#c4c9d0] leading-relaxed">
          <p>
            BNDZ is a local Windows file manager. By continuing you agree to the End User License Agreement
            and acknowledge the Privacy Policy.
          </p>
          <p className="text-[11px] text-[#8b919a]">
            You can reopen these documents anytime from Help → About.
          </p>
        </div>
      </BndzNativeDialog>
    </>
  );
}
