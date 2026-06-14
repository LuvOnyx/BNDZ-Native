import React, { useState, useEffect } from 'react';
import { Menu, Plus, Trash2, Save, GripVertical } from 'lucide-react';
import { useAppConfig } from '../../data/configContext';
import { IPC } from '../../lib/ipcBridge';

export const MenuArchitectPluginDef = {
    id: 'menu-architect',
    name: 'Menu Architect',
    icon: Menu,
    description: 'Design and deploy custom Windows shell context menu entries via Registry.',
    isNative: true,
    targetPanel: 'bottom' as const,
};

type MenuAction = { id: string; label: string; command?: string; verb?: string };

export default function MenuArchitectPlugin() {
    const { config, updateConfig } = useAppConfig();
    const [actions, setActions] = useState<MenuAction[]>([]);
    const [deploying, setDeploying] = useState(false);
    const [status, setStatus] = useState<string | null>(null);

    useEffect(() => {
        const saved = config.globalContextMenuActions;
        if (saved?.length) {
            setActions(saved.map((a: any) => ({
                id: a.id || `action_${Date.now()}`,
                label: a.name || a.label || 'Unnamed',
                command: a.command || '',
                verb: a.verb,
            })));
        } else {
            setActions([
                { id: 'open_bndz', label: 'Open with BNDZ', command: '"%ProgramFiles%\\BNDZ\\BNDZ.exe" "%1"' },
                { id: 'copy_path', label: 'Copy Path to Clipboard', verb: 'copy' },
            ]);
        }
    }, []);

    const addAction = () => {
        setActions(prev => [...prev, { id: `action_${Date.now()}`, label: 'New Action', command: '' }]);
    };

    const updateAction = (id: string, field: keyof MenuAction, value: string) => {
        setActions(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
    };

    const removeAction = (id: string) => {
        setActions(prev => prev.filter(a => a.id !== id));
    };

    const saveToConfig = () => {
        // OS-level registry menus persist separately from BNDZ's in-app menu items
        updateConfig({
            globalContextMenuActions: actions.map(a => ({
                id: a.id,
                name: a.label,
                label: a.label,
                command: a.command || '',
                targetMode: 'all',
            })),
        });
        setStatus('Saved to application config.');
    };

    const deployToShell = async () => {
        setDeploying(true);
        setStatus(null);
        try {
            const payload = actions.map(a => ({
                id: a.id,
                label: a.label,
                command: a.command || (a.verb === 'copy'
                    ? 'cmd /c echo %1| clip'
                    : ''),
            }));
            const ok = await IPC.updateGlobalContextMenu(payload);
            if (ok) {
                saveToConfig();
                setStatus('Successfully deployed to Windows Registry. Changes are live in File Explorer.');
            } else {
                setStatus('Deployment failed. Try running BNDZ as Administrator.');
            }
        } catch {
            setStatus('Deployment error. Administrator privileges may be required.');
        }
        setDeploying(false);
    };

    return (
        <div className="w-full h-full flex flex-col bg-[#0d0d0d] text-gray-300 min-h-0">
            <div className="px-4 py-3 border-b border-[#222] bg-[#111] shrink-0 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Menu size={14} className="text-purple-400" />
                    <span className="font-bold text-sm text-white">Menu Architect</span>
                </div>
                <div className="flex gap-2">
                    <button onClick={addAction} className="flex items-center gap-1 px-3 py-1.5 bg-[#222] hover:bg-[#333] border border-[#333] rounded text-xs transition-colors">
                        <Plus size={12} /> Add Entry
                    </button>
                    <button onClick={saveToConfig} className="flex items-center gap-1 px-3 py-1.5 bg-[#222] hover:bg-[#333] border border-[#333] rounded text-xs transition-colors">
                        <Save size={12} /> Save
                    </button>
                    <button onClick={deployToShell} disabled={deploying} className="flex items-center gap-1 px-3 py-1.5 bg-[#007acc] hover:bg-[#005c99] text-white rounded text-xs font-semibold transition-colors disabled:opacity-50">
                        <Save size={12} /> Deploy to Windows
                    </button>
                </div>
            </div>

            {status && (
                <div className="px-4 py-2 bg-[#1a2a1a] border-b border-[#2a4a2a] text-xs text-emerald-400 shrink-0">{status}</div>
            )}

            <div className="flex-1 overflow-y-auto bndz-scrollbar p-4 space-y-2 min-h-0">
                {actions.map((action, i) => (
                    <div key={action.id} className="flex items-center gap-3 p-3 bg-[#111] border border-[#222] rounded-lg group">
                        <GripVertical size={14} className="text-gray-600 shrink-0" />
                        <span className="text-[10px] text-gray-600 font-mono w-4">{i + 1}</span>
                        <input
                            value={action.label}
                            onChange={e => updateAction(action.id, 'label', e.target.value)}
                            className="w-40 bg-[#0a0a0a] border border-[#333] rounded px-2 py-1 text-white text-xs outline-none focus:border-[#007acc]"
                            placeholder="Menu label"
                        />
                        <input
                            value={action.command || ''}
                            onChange={e => updateAction(action.id, 'command', e.target.value)}
                            className="flex-1 bg-[#0a0a0a] border border-[#333] rounded px-2 py-1 text-white text-xs font-mono outline-none focus:border-[#007acc]"
                            placeholder='Command (e.g. "C:\path\app.exe" "%1")'
                        />
                        <button onClick={() => removeAction(action.id)} className="p-1.5 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all">
                            <Trash2 size={12} />
                        </button>
                    </div>
                ))}
                {actions.length === 0 && (
                    <div className="text-center text-gray-600 py-8 text-xs">No menu entries. Add one to build your custom context menu.</div>
                )}
            </div>
        </div>
    );
}
