import React from 'react';
import { NativeDialogShell } from '../native/NativeDialogShell';
import { Checkbox } from '../ui/checkbox';

export type FieldPickerItem = { id: string; label: string; group?: string };

export default function FieldPickerDialog({
  open,
  title,
  items,
  selected,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  items: FieldPickerItem[];
  selected: string[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [draft, setDraft] = React.useState<string[]>(selected);

  React.useEffect(() => {
    if (open) setDraft(selected);
  }, [open, selected]);

  const toggle = (id: string, checked: boolean) => {
    setDraft(prev => {
      const set = new Set(prev);
      if (checked) set.add(id);
      else set.delete(id);
      return [...set];
    });
  };

  return (
    <NativeDialogShell
      open={open}
      title={title}
      onClose={onClose}
      size="md"
      zIndexClass="z-[120]"
      footerButtons={[
        { label: 'Cancel', onClick: onClose },
        { label: 'OK', style: 'primary', onClick: () => { onSave(draft); onClose(); } },
      ]}
    >
      <div className="max-h-[360px] overflow-y-auto styled-scrollbar space-y-1 pr-1">
        {items.map(item => (
          <label key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer text-[12px] text-[#e0e0e0]">
            <Checkbox
              label=""
              checked={draft.includes(item.id)}
              onChange={e => toggle(item.id, e.target.checked)}
            />
            <span>{item.label}</span>
            {item.group && <span className="text-[10px] text-[#888] ml-auto">{item.group}</span>}
          </label>
        ))}
      </div>
    </NativeDialogShell>
  );
}
