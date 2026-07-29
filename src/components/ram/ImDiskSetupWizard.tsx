import React from 'react';
import { Icons8Icon } from '../Icons8Icon';

type Props = {
  imDiskAvailable?: boolean;
};

export default function ImDiskSetupWizard({ imDiskAvailable }: Props) {
  if (imDiskAvailable) return null;

  return (
    <div className="bndz-ram-imdisk-wizard mx-3 my-2 p-3 rounded-lg border border-violet-400/20 bg-violet-500/5">
      <div className="flex items-start gap-2">
        <Icons8Icon id="hard_drive_ui" size={16} className="shrink-0 mt-0.5 text-violet-300" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-violet-200">Install ImDisk for true RAM disks</p>
          <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
            BNDZ is using fast NVMe staging until ImDisk is installed. Zones still flush back on eject.
          </p>
          <a
            href="https://sourceforge.net/projects/imdisk-toolkit/"
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-2 text-[10px] text-sky-300 hover:text-sky-200 underline"
          >
            Download ImDisk Toolkit
          </a>
        </div>
      </div>
    </div>
  );
}
