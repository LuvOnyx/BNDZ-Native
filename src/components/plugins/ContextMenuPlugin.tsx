import React, { useState, useEffect } from 'react';
import { useAppConfig } from '../../data/configContext';
import {
    Menu, Plus, Trash2, Save, MonitorCheck, Image, Globe, KeyRound,
    Wand2, FileText, Terminal, FolderOpen, Copy, Sparkles, ChevronRight, HelpCircle,
} from 'lucide-react';
import { pushToast } from '../ToastHost';
import { IPC } from '../../lib/ipcBridge';
import PluginPanelShell from './PluginPanelShell';

export const ContextMenuPluginDef = {
    id: 'context-menu-manager',
    name: 'Shell Menus',
    icon: Menu,
};

type ShellTab = 'app' | 'global';
type TargetMode = 'all' | 'directory' | 'background';

interface MenuAction {
    id: string;
    name: string;
    command: string;
    icon?: string;
    targetMode?: TargetMode;
    hasSubmenu?: boolean;
}

const VARIABLE_HELP = [
    { token: '%1', desc: 'Full path of the right-clicked file or folder' },
    { token: '%V', desc: 'Multiple selected items (space-separated)' },
    { token: '%L', desc: 'Parent folder path' },
    { token: '%W', desc: 'Working directory (folder background)' },
];

const GLOBAL_TEMPLATES: Array<{ label: string; desc: string; action: Omit<MenuAction, 'id'> }> = [
    {
        label: 'Open with Notepad',
        desc: 'Opens any file in Notepad',
        action: { name: 'Open with Notepad', command: 'notepad.exe "%1"', targetMode: 'all', icon: '' },
    },
    {
        label: 'Open PowerShell Here',
        desc: 'Launches PowerShell in the folder',
        action: { name: 'Open PowerShell Here', command: 'powershell.exe -NoExit -Command Set-Location -LiteralPath \'%L\'', targetMode: 'directory', icon: '' },
    },
    {
        label: 'Copy Path to Clipboard',
        desc: 'Copies the full path without opening a terminal',
        action: { name: 'Copy Path', command: 'cmd.exe /c echo %1| clip', targetMode: 'all', icon: '' },
    },
    {
        label: 'Open Folder in BNDZ',
        desc: 'Browse the folder inside BNDZ',
        action: { name: 'Open in BNDZ', command: 'bndz-open-path', targetMode: 'directory', icon: '' },
    },
];

const APP_TEMPLATES: Array<{ label: string; desc: string; action: Omit<MenuAction, 'id'> }> = [
    { label: 'Refresh View', desc: 'Reloads the current folder', action: { name: 'Refresh', command: 'refresh' } },
    { label: 'Open Terminal', desc: 'Opens terminal at selection', action: { name: 'Open Terminal', command: 'openTerminal' } },
    { label: 'Copy Path', desc: 'Copies path to clipboard', action: { name: 'Copy Path', command: 'copyPath' } },
];

function targetLabel(mode: TargetMode = 'all'): string {
    if (mode === 'directory') return 'Folders only';
    if (mode === 'background') return 'Folder background';
    return 'Files & folders';
}

export default function ContextMenuPlugin({ selectedItems }: { selectedItems?: string[]; focusedPath?: string }) {
    const { config, updateConfig } = useAppConfig();
    const [tab, setTab] = useState<ShellTab>('global');
    const [appActions, setAppActions] = useState<MenuAction[]>(config.customContextMenuActions || []);
    const [globalActions, setGlobalActions] = useState<MenuAction[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [showHelp, setShowHelp] = useState(false);

    useEffect(() => {
        setGlobalActions((config.globalContextMenuActions as MenuAction[]) ?? []);
    }, [config.globalContextMenuActions]);

    useEffect(() => {
        setAppActions((config.customContextMenuActions as MenuAction[]) ?? []);
    }, [config.customContextMenuActions]);

    const addAppAction = (seed?: Partial<MenuAction>) => {
        const newAction: MenuAction = {
            id: `custom_${Date.now()}`,
            name: seed?.name || 'New Action',
            command: seed?.command || '',
            ...seed,
        };
        setAppActions(prev => [...prev, newAction]);
        setExpandedId(newAction.id);
    };

    const addGlobalAction = (seed?: Partial<MenuAction>) => {
        const stableId = seed?.command === 'bndz-open-path' ? 'bndz-open-path' : (seed?.id ?? `g_custom_${Date.now()}`);
        const newAction: MenuAction = {
            name: seed?.name || 'New Menu Item',
            command: seed?.command || '',
            icon: seed?.icon || '',
            targetMode: seed?.targetMode || 'all',
            hasSubmenu: false,
            ...seed,
            id: stableId,
        };
        setGlobalActions(prev => [...prev, newAction]);
        setExpandedId(newAction.id);
    };

    const saveAppActions = () => {
        updateConfig({ customContextMenuActions: appActions });
    };

    const saveGlobalActions = async () => {
        try {
            updateConfig({ globalContextMenuActions: globalActions, injectGlobalContextMenu: true } as Partial<typeof config>);
            if (!IPC.updateGlobalContextMenu) {
                pushToast({ kind: 'warning', title: 'Native host required', message: 'Shell menu deployment is only available in the BNDZ native app.' });
                return;
            }
            const payload = globalActions.map(a => ({
                id: a.id,
                label: a.name,
                name: a.name,
                command: a.command,
                icon: a.icon,
                targetMode: a.targetMode,
            }));
            const ok = await IPC.updateGlobalContextMenu(payload);
            pushToast(ok
                ? { kind: 'success', title: 'Deployed', message: 'New items appear in File Explorer right-click menus.' }
                : { kind: 'error', title: 'Deploy failed', message: 'Registry write failed. Try running BNDZ as Administrator.' });
        } catch (err: any) {
            pushToast({ kind: 'error', title: 'Deploy error', message: String(err?.message || err) });
        }
    };

    const selectIcon = async (idx: number) => {
        const files = await IPC.openFileDialog('Icons (*.ico;*.png)|*.ico;*.png');
        if (!files?.length) return;
        let path = files[0];
        if (path.endsWith('.png') && (IPC as { convertToIco?: (p: string) => Promise<string> }).convertToIco) {
            path = await (IPC as { convertToIco: (p: string) => Promise<string> }).convertToIco(path) || path;
        }
        setGlobalActions(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], icon: path };
            return next;
        });
    };

    const insertVariable = (idx: number, token: string, field: 'global' | 'app') => {
        const updater = field === 'global' ? setGlobalActions : setAppActions;
        updater(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], command: `${next[idx].command || ''}${token}` };
            return next;
        });
    };

    const renderActionCard = (
        ac: MenuAction,
        i: number,
        mode: ShellTab,
        update: React.Dispatch<React.SetStateAction<MenuAction[]>>,
        remove: () => void,
    ) => {
        const open = expandedId === ac.id;
        return (
            <div key={ac.id} className="bg-[#161616] border border-[#2a2a2a] hover:border-[#3a3a3a] rounded-xl overflow-hidden shadow-sm transition-colors">
                <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : ac.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#1c1c1c] transition-colors"
                >
                    <div className="w-8 h-8 rounded-lg bg-pink-600/15 border border-pink-500/25 flex items-center justify-center shrink-0">
                        {mode === 'global' ? <Globe size={14} className="text-pink-400" /> : <Menu size={14} className="text-sky-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{ac.name || 'Untitled'}</div>
                        <div className="text-[10px] text-gray-500 truncate">
                            {mode === 'global' ? targetLabel(ac.targetMode) : ac.command || 'No command'}
                        </div>
                    </div>
                    <ChevronRight size={14} className={`text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>

                {open && (
                    <div className="px-4 pb-4 pt-1 border-t border-[#252525] space-y-3">
                        <div className="grid md:grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 block">Menu label</label>
                                <input
                                    className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500/50"
                                    value={ac.name}
                                    onChange={e => update(prev => { const n = [...prev]; n[i] = { ...n[i], name: e.target.value }; return n; })}
                                    placeholder="What users see in the menu"
                                />
                            </div>
                            {mode === 'global' && (
                                <div>
                                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 block">Show on</label>
                                    <select
                                        className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500/50"
                                        value={ac.targetMode || 'all'}
                                        onChange={e => update(prev => { const n = [...prev]; n[i] = { ...n[i], targetMode: e.target.value as TargetMode }; return n; })}
                                    >
                                        <option value="all">Files & folders</option>
                                        <option value="directory">Folders only</option>
                                        <option value="background">Empty folder background</option>
                                    </select>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 block">
                                {mode === 'global' ? 'Program to run' : 'BNDZ command'}
                            </label>
                            <input
                                className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-[11px] font-mono text-emerald-400 focus:outline-none focus:border-pink-500/50"
                                value={ac.command}
                                placeholder={mode === 'global' ? 'C:\\Apps\\Tool.exe "%1"' : 'refresh, copyPath, openTerminal...'}
                                onChange={e => update(prev => { const n = [...prev]; n[i] = { ...n[i], command: e.target.value }; return n; })}
                            />
                            {mode === 'global' && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {VARIABLE_HELP.map(v => (
                                        <button
                                            key={v.token}
                                            type="button"
                                            title={v.desc}
                                            onClick={() => insertVariable(i, v.token, 'global')}
                                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#222] border border-[#333] text-pink-300 hover:border-pink-500/40"
                                        >
                                            {v.token}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {mode === 'global' && (
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 block">Menu icon (optional)</label>
                                <div className="flex gap-2">
                                    <input
                                        className="flex-1 bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-xs text-sky-300 focus:outline-none focus:border-pink-500/50"
                                        value={ac.icon || ''}
                                        placeholder="C:\\App\\icon.ico"
                                        onChange={e => update(prev => { const n = [...prev]; n[i] = { ...n[i], icon: e.target.value }; return n; })}
                                    />
                                    <button type="button" onClick={() => selectIcon(i)} className="shrink-0 px-3 py-2 rounded-lg bg-[#222] border border-[#444] hover:bg-[#333] text-xs flex items-center gap-1">
                                        <Image size={12} /> Browse
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end pt-1">
                            <button type="button" onClick={remove} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-red-950/30">
                                <Trash2 size={12} /> Remove
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const templates = tab === 'global' ? GLOBAL_TEMPLATES : APP_TEMPLATES;
    const actions = tab === 'global' ? globalActions : appActions;
    const selectionHint = selectedItems?.length
        ? `${selectedItems.length} item(s) selected in file list — use these when testing commands.`
        : 'Select files or folders in the file list to test your menu actions.';

    return (
        <PluginPanelShell
            title="Shell Menus"
            icon={Menu}
            iconColor="#f472b6"
            variant="embedded"
            subtitle={selectionHint}
            toolbar={
                <>
                    <button
                        type="button"
                        onClick={() => (tab === 'global' ? addGlobalAction() : addAppAction())}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-[#222] hover:bg-[#2a2a2a] border border-[#333] rounded-md text-white"
                    >
                        <Plus size={13} className="text-pink-400" /> Add
                    </button>
                    {tab === 'global' ? (
                        <button type="button" onClick={saveGlobalActions} className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-pink-600/20 hover:bg-pink-600/30 border border-pink-500/40 rounded-md text-pink-300">
                            <MonitorCheck size={13} /> Deploy
                        </button>
                    ) : (
                        <button type="button" onClick={saveAppActions} className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 rounded-md text-sky-400">
                            <Save size={13} /> Save
                        </button>
                    )}
                </>
            }
        >
        <div className="flex w-full h-full bg-[#0a0a0a] text-gray-200 overflow-hidden min-h-0">
            <div className="w-[220px] border-r border-[#222] bg-[#111] flex flex-col shrink-0">
                <div className="flex flex-col gap-1 p-2 pt-3">
                    <button
                        type="button"
                        onClick={() => setTab('global')}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all text-left ${tab === 'global' ? 'bg-gradient-to-r from-pink-900/30 to-purple-900/20 text-white border border-pink-500/30' : 'text-gray-400 hover:bg-[#1a1a1a] border border-transparent'}`}
                    >
                        <Globe size={14} className={tab === 'global' ? 'text-pink-400' : ''} />
                        Windows Explorer
                        <span className="ml-auto text-[9px] text-gray-500">OS-wide</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab('app')}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all text-left ${tab === 'app' ? 'bg-[#222] text-white border border-[#333]' : 'text-gray-400 hover:bg-[#1a1a1a] border border-transparent'}`}
                    >
                        <Menu size={14} className={tab === 'app' ? 'text-sky-400' : ''} />
                        Inside BNDZ
                        <span className="ml-auto text-[9px] text-gray-500">In-app</span>
                    </button>
                </div>

                <div className="mt-auto p-3 border-t border-[#222]">
                    <button type="button" onClick={() => setShowHelp(v => !v)} className="w-full flex items-center gap-2 text-[10px] text-gray-500 hover:text-gray-300 py-1">
                        <HelpCircle size={12} /> How it works
                    </button>
                    {showHelp && (
                        <p className="text-[10px] text-gray-500 leading-relaxed mt-2 p-2 bg-[#0d0d0d] rounded-lg border border-[#222]">
                            Pick a template, customize the label, then save. Windows menus require <strong className="text-pink-300">Deploy to OS</strong> once.
                        </p>
                    )}
                </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 min-h-0">
                <div className="flex-1 overflow-y-auto bndz-scrollbar p-5 space-y-5 min-h-0">
                    {tab === 'global' && (
                        <div className="text-[11px] text-sky-300/90 bg-sky-950/20 p-3 rounded-xl border border-sky-500/20 flex gap-2.5 items-start">
                            <KeyRound size={16} className="shrink-0 mt-0.5 opacity-80" />
                            <span>These entries appear in native File Explorer. Click <strong>Deploy to OS</strong> after editing — admin rights may be required.</span>
                        </div>
                    )}

                    <section>
                        <div className="flex items-center gap-2 mb-3">
                            <Wand2 size={14} className="text-amber-400" />
                            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Quick start templates</h3>
                        </div>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                            {templates.map(t => (
                                <button
                                    key={t.label}
                                    type="button"
                                    onClick={() => (tab === 'global' ? addGlobalAction(t.action) : addAppAction(t.action))}
                                    className="text-left p-3 rounded-xl border border-[#2a2a2a] bg-[#141414] hover:border-pink-500/30 hover:bg-[#1a1a1a] transition-all group"
                                >
                                    <div className="text-xs font-semibold text-white group-hover:text-pink-200">{t.label}</div>
                                    <div className="text-[10px] text-gray-500 mt-1 leading-snug">{t.desc}</div>
                                </button>
                            ))}
                        </div>
                    </section>

                    <section>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Your menu items ({actions.length})</h3>
                        </div>
                        {actions.length === 0 ? (
                            <div className="text-center py-12 text-gray-500 border border-dashed border-[#333] rounded-xl">
                                <Sparkles size={28} className="mx-auto mb-3 opacity-30" />
                                <p className="text-sm">No menu items yet</p>
                                <p className="text-[10px] mt-1">Pick a template above or click Add item</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {tab === 'global'
                                    ? globalActions.map((ac, i) => renderActionCard(ac, i, 'global', setGlobalActions, () => setGlobalActions(globalActions.filter((_, idx) => idx !== i))))
                                    : appActions.map((ac, i) => renderActionCard(ac, i, 'app', setAppActions, () => setAppActions(appActions.filter((_, idx) => idx !== i))))}
                            </div>
                        )}
                    </section>

                    {tab === 'global' && (
                        <section className="bg-[#111] border border-[#222] rounded-xl p-4">
                            <div className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-2">
                                <Terminal size={12} /> Variable reference
                            </div>
                            <div className="grid sm:grid-cols-2 gap-2">
                                {VARIABLE_HELP.map(v => (
                                    <div key={v.token} className="flex gap-2 text-[10px]">
                                        <code className="text-pink-300 font-mono shrink-0">{v.token}</code>
                                        <span className="text-gray-500">{v.desc}</span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
        </PluginPanelShell>
    );
}
