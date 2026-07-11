import React, { useState, useEffect } from 'react';
import { useAppConfig } from '../../data/configContext';
import { Icons8Icon } from '../Icons8Icon';
import { pushToast } from '../ToastHost';
import { IPC } from '../../lib/ipcBridge';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginSidebar,
  PluginSectionTitle,
  PluginCard,
  PluginFieldLabel,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PLUGIN_INPUT_CLASS,
  PLUGIN_SELECT_CLASS,
} from './PluginPanelPrimitives';

export const ContextMenuPluginDef = {
    id: 'context-menu-manager',
    name: 'Shell Menus',
    icon: 'shell_menus',
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
            <PluginCard key={ac.id} className="!p-0 overflow-hidden">
                <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : ac.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                >
                    <div className="w-8 h-8 rounded-lg bg-pink-600/15 border border-pink-500/25 flex items-center justify-center shrink-0">
                        <Icons8Icon id={mode === 'global' ? 'go_network' : 'shell_menus'} size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{ac.name || 'Untitled'}</div>
                        <div className="text-xs bndz-panel-muted truncate">
                            {mode === 'global' ? targetLabel(ac.targetMode) : ac.command || 'No command'}
                        </div>
                    </div>
                    <Icons8Icon id="chevron_right" size={12} className={`transition-transform text-gray-500 ${open ? 'rotate-90' : ''}`} />
                </button>

                {open && (
                    <div className="px-4 pb-4 pt-1 border-t border-white/[0.06] space-y-3">
                        <div className="grid md:grid-cols-2 gap-3">
                            <div>
                                <PluginFieldLabel>Menu label</PluginFieldLabel>
                                <input
                                    className={PLUGIN_INPUT_CLASS}
                                    value={ac.name}
                                    onChange={e => update(prev => { const n = [...prev]; n[i] = { ...n[i], name: e.target.value }; return n; })}
                                    placeholder="What users see in the menu"
                                />
                            </div>
                            {mode === 'global' && (
                                <div>
                                    <PluginFieldLabel>Show on</PluginFieldLabel>
                                    <select
                                        className={`${PLUGIN_SELECT_CLASS} w-full`}
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
                            <PluginFieldLabel>{mode === 'global' ? 'Program to run' : 'BNDZ command'}</PluginFieldLabel>
                            <input
                                className={`${PLUGIN_INPUT_CLASS} bndz-mono text-emerald-300`}
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
                                            className="text-xs bndz-mono px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-pink-300 hover:border-pink-500/40"
                                        >
                                            {v.token}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {mode === 'global' && (
                            <div>
                                <PluginFieldLabel>Menu icon (optional)</PluginFieldLabel>
                                <div className="flex gap-2">
                                    <input
                                        className={`${PLUGIN_INPUT_CLASS} flex-1 text-[#99c9f0]`}
                                        value={ac.icon || ''}
                                        placeholder="C:\\App\\icon.ico"
                                        onChange={e => update(prev => { const n = [...prev]; n[i] = { ...n[i], icon: e.target.value }; return n; })}
                                    />
                                    <PluginToolbarButton icon="picture_ui" onClick={() => selectIcon(i)}>Browse</PluginToolbarButton>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end pt-1">
                            <PluginToolbarButton icon="delete" onClick={remove}>Remove</PluginToolbarButton>
                        </div>
                    </div>
                )}
            </PluginCard>
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
            icon="shell_menus"
            iconColor="#f472b6"
            variant="embedded"
            subtitle={selectionHint}
        >
        <div className="flex flex-col h-full min-h-0 overflow-hidden">
            <PluginHeroStrip
                icon={<Icons8Icon id="shell_menus" size={52} className="opacity-90" />}
                name={tab === 'global' ? 'Windows Explorer menus' : 'BNDZ context menus'}
                typeLabel={tab === 'global' ? 'OS-wide shell' : 'In-app only'}
                meta={<span className="bndz-panel-muted text-xs">{actions.length} action(s) · {selectionHint}</span>}
                actions={
                    tab === 'global' ? (
                        <>
                            <PluginHeroActionButton icon="plus_ui" onClick={() => addGlobalAction()}>Add</PluginHeroActionButton>
                            <PluginHeroActionButton icon="check" variant="primary" onClick={saveGlobalActions}>Deploy</PluginHeroActionButton>
                        </>
                    ) : (
                        <>
                            <PluginHeroActionButton icon="plus_ui" onClick={() => addAppAction()}>Add</PluginHeroActionButton>
                            <PluginHeroActionButton icon="check" variant="primary" onClick={saveAppActions}>Save</PluginHeroActionButton>
                        </>
                    )
                }
            />
        <div className="flex w-full flex-1 overflow-hidden min-h-0">
            <PluginSidebar className="!w-[200px] !min-w-[176px] p-2">
                <button
                    type="button"
                    onClick={() => setTab('global')}
                    className={`bndz-plugin-tab w-full !rounded-md !justify-start !px-3 !py-2 ${tab === 'global' ? 'bndz-plugin-tab-active' : ''}`}
                >
                    <span className="inline-flex items-center gap-2 w-full">
                        <Icons8Icon id="go_network" size={14} />
                        Windows Explorer
                        <span className="ml-auto bndz-plugin-kind-pill !text-[10px]">OS-wide</span>
                    </span>
                </button>
                <button
                    type="button"
                    onClick={() => setTab('app')}
                    className={`bndz-plugin-tab w-full !rounded-md !justify-start !px-3 !py-2 ${tab === 'app' ? 'bndz-plugin-tab-active' : ''}`}
                >
                    <span className="inline-flex items-center gap-2 w-full">
                        <Icons8Icon id="shell_menus" size={14} />
                        Inside BNDZ
                        <span className="ml-auto bndz-plugin-kind-pill !text-[10px]">In-app</span>
                    </span>
                </button>

                <div className="mt-auto pt-2 border-t border-white/[0.06]">
                    <button type="button" onClick={() => setShowHelp(v => !v)} className="w-full flex items-center gap-2 text-xs bndz-panel-muted hover:text-gray-300 py-1.5 px-1">
                        <Icons8Icon id="help_ui" size={12} /> How it works
                    </button>
                    {showHelp && (
                        <p className="text-xs bndz-panel-muted leading-relaxed mt-2 p-2 rounded-md border border-white/[0.06] bg-black/20">
                            Pick a template, customize the label, then save. Windows menus require <strong className="text-pink-300">Deploy</strong> once.
                        </p>
                    )}
                </div>
            </PluginSidebar>

            <div className="flex-1 flex flex-col min-w-0 min-h-0">
                <div className="flex-1 overflow-y-auto bndz-scrollbar p-4 space-y-4 min-h-0">
                    {tab === 'global' && (
                        <PluginCard className="flex gap-2.5 items-start border-[#0078d4]/25 bg-[#094771]/15 !py-3">
                            <Icons8Icon id="key_ui" size={16} className="shrink-0 mt-0.5 opacity-80 text-[#99c9f0]" />
                            <span className="text-xs text-[#cce4f7]/90">These entries appear in native File Explorer. Click <strong>Deploy</strong> after editing — admin rights may be required.</span>
                        </PluginCard>
                    )}

                    <section>
                        <PluginSectionTitle icon="sparkles_ui">Quick start templates</PluginSectionTitle>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                            {templates.map(t => (
                                <button
                                    key={t.label}
                                    type="button"
                                    onClick={() => (tab === 'global' ? addGlobalAction(t.action) : addAppAction(t.action))}
                                    className="bndz-plugin-card text-left !p-3 hover:border-pink-500/30 hover:bg-white/[0.03] transition-colors group"
                                >
                                    <div className="text-xs font-semibold text-white group-hover:text-pink-200">{t.label}</div>
                                    <div className="text-xs bndz-panel-muted mt-1 leading-snug">{t.desc}</div>
                                </button>
                            ))}
                        </div>
                    </section>

                    <section>
                        <PluginSectionTitle>Your menu items ({actions.length})</PluginSectionTitle>
                        {actions.length === 0 ? (
                            <PluginEmptyState icon="sparkles_ui" title="No menu items yet" description="Pick a template above or click Add." />
                        ) : (
                            <div className="space-y-2">
                                {tab === 'global'
                                    ? globalActions.map((ac, i) => renderActionCard(ac, i, 'global', setGlobalActions, () => setGlobalActions(globalActions.filter((_, idx) => idx !== i))))
                                    : appActions.map((ac, i) => renderActionCard(ac, i, 'app', setAppActions, () => setAppActions(appActions.filter((_, idx) => idx !== i))))}
                            </div>
                        )}
                    </section>

                    {tab === 'global' && (
                        <PluginCard>
                            <PluginSectionTitle icon="terminal">Variable reference</PluginSectionTitle>
                            <div className="grid sm:grid-cols-2 gap-2">
                                {VARIABLE_HELP.map(v => (
                                    <div key={v.token} className="flex gap-2 text-xs">
                                        <code className="text-pink-300 bndz-mono shrink-0">{v.token}</code>
                                        <span className="bndz-panel-muted">{v.desc}</span>
                                    </div>
                                ))}
                            </div>
                        </PluginCard>
                    )}
                </div>
            </div>
        </div>
        </div>
        </PluginPanelShell>
    );
}
