import React from 'react';
import { Icons8Icon } from '../../Icons8Icon';
import { IconStudioProvider } from './IconStudioContext';
import styles from './IconStudio.module.css';
import LibraryManager from './LibraryManager';
import IconGrid from './IconGrid';
import PreviewPane from './PreviewPane';
import { useAppConfig } from '../../../data/configContext';
import PluginPanelShell from '../PluginPanelShell';

export const IconStudioPluginDef = {
    id: "icon-studio",
    name: "Icon Studio",
    icon: 'icon_studio'
};

const STEPS = [
    { n: 1, label: 'Pick library' },
    { n: 2, label: 'Choose icon' },
    { n: 3, label: 'Apply to selection' },
] as const;

export default function IconStudioPlugin({
    selectedItems,
    selectedTargetTypes,
    focusedPath,
    isPluginTabActive,
}: {
    selectedItems?: string[];
    selectedTargetTypes?: string[];
    focusedPath?: string;
    isPluginTabActive?: boolean;
}) {
    const targetCount = selectedItems?.length || 0;
    const activeStep = targetCount > 0 ? 3 : 2;

    return (
        <IconStudioProvider nativeSyncEnabled={isPluginTabActive !== false}>
            <PluginPanelShell title="Icon Studio" icon="icon_studio" iconColor="#94a3b8" variant="embedded">
                <IconStudioInner
                    selectedItems={selectedItems}
                    selectedTargetTypes={selectedTargetTypes}
                    focusedPath={focusedPath}
                    targetCount={targetCount}
                    activeStep={activeStep}
                />
            </PluginPanelShell>
        </IconStudioProvider>
    );
}

function IconStudioInner({
    selectedItems,
    selectedTargetTypes,
    focusedPath,
    targetCount,
    activeStep,
}: {
    selectedItems?: string[];
    selectedTargetTypes?: string[];
    focusedPath?: string;
    targetCount: number;
    activeStep: number;
}) {
    const { config, updateConfig } = useAppConfig();

    return (
        <div className={`${styles.container} flex-col`} data-icon-studio>
            <div className={`${styles.workflowBar} shrink-0 flex items-center justify-between px-4 h-9 gap-3`}>
                <div className="flex items-center gap-1 min-w-0">
                    {STEPS.map((step, i) => (
                        <React.Fragment key={step.n}>
                            <div className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-md ${
                                activeStep >= step.n ? 'text-gray-200' : 'bndz-panel-muted'
                            }`}>
                                <span className={`w-5 h-5 rounded-md text-xs font-semibold flex items-center justify-center ${
                                    activeStep >= step.n
                                        ? 'bg-[#094771]/30 text-[#cce4f7] border border-[#0078d4]/30'
                                        : 'bg-white/[0.04] text-gray-500 border border-white/[0.06]'
                                }`}>{step.n}</span>
                                <span className="text-xs font-medium hidden sm:inline">{step.label}</span>
                            </div>
                            {i < STEPS.length - 1 && <div className="w-3 h-px bg-white/[0.08]" />}
                        </React.Fragment>
                    ))}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {targetCount > 0 ? (
                        <span className="bndz-plugin-kind-pill inline-flex items-center gap-1 text-emerald-300/90 border border-emerald-500/20 bg-emerald-500/8">
                            {targetCount} target{targetCount !== 1 ? 's' : ''}
                        </span>
                    ) : (
                        <span className="text-xs bndz-panel-muted hidden sm:inline">Select items in the file list</span>
                    )}
                    <label className="flex items-center gap-1.5 text-xs bndz-panel-muted cursor-pointer shrink-0" title="Allow overwriting read-only or system-protected icons">
                        <input
                            type="checkbox"
                            checked={config.allowGlobalIconOverwrite ?? false}
                            onChange={e => updateConfig({ allowGlobalIconOverwrite: e.target.checked })}
                            className="accent-[#0078d4]"
                        />
                        <Icons8Icon id="shield_ui" size={11} className="opacity-60" />
                        <span className="hidden md:inline">Force apply</span>
                    </label>
                </div>
            </div>
            <div className="flex flex-1 min-h-0 w-full">
                <LibraryManager />
                <IconGrid
                    selectedItems={selectedItems || []}
                    targetTypes={selectedTargetTypes}
                    focusedPath={focusedPath || '/'}
                />
                <PreviewPane
                    selectedItems={selectedItems || []}
                    targetTypes={selectedTargetTypes}
                    focusedPath={focusedPath || '/'}
                />
            </div>
        </div>
    );
}
