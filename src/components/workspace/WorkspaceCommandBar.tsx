import React from 'react';

export type WorkspaceCommand = {
  id: string;
  label: string;
  icon?: string;
  iconSrc?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

type Props = {
  variant: 'spatial' | 'automation';
  commands: WorkspaceCommand[];
  hint?: string;
};

export default function WorkspaceCommandBar({ variant, commands, hint }: Props) {
  return (
    <div className={`bndz-ws-commandbar bndz-ws-commandbar--${variant}`} data-bndz-workspace-menu>
      <div className="bndz-ws-commandbar-cluster">
        {commands.map(cmd => (
          <button
            key={cmd.id}
            type="button"
            title={cmd.label}
            aria-label={cmd.label}
            disabled={cmd.disabled}
            className={`bndz-ws-commandbar-btn${cmd.active ? ' is-active' : ''}`}
            onPointerDown={e => {
              if (e.button !== 0 || cmd.disabled) return;
              e.preventDefault();
              e.stopPropagation();
              cmd.onClick();
            }}
            onClick={e => { e.preventDefault(); e.stopPropagation(); }}
          >
            {cmd.iconSrc ? (
              <img src={cmd.iconSrc} alt="" className="bndz-ws-commandbar-icon" draggable={false} />
            ) : null}
            <span className="bndz-ws-commandbar-label">{cmd.label}</span>
          </button>
        ))}
      </div>
      {hint ? <span className="bndz-ws-commandbar-hint">{hint}</span> : null}
    </div>
  );
}
