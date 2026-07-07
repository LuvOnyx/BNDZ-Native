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
            <PluginPanelShell title="Icon Studio" icon="icon_studio" iconColor="#ec4899" variant="embedded">
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
        <div className={`${styles.container} flex-col`}>
            <div className={`${styles.workflowBar} shrink-0 flex items-center justify-between px-5 h-11`}>
                    <div className="flex items-center gap-1">
                        {STEPS.map((step, i) => (
                            <React.Fragment key={step.n}>
                                <div className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-colors ${
                                    activeStep >= step.n ? 'text-pink-200' : 'text-gray-600'
                                }`}>
                                    <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center transition-all ${
                                        activeStep >= step.n
                                            ? 'bg-gradient-to-br from-pink-500 to-purple-600 text-white shadow-[0_0_12px_rgba(236,72,153,0.35)]'
                                            : 'bg-white/5 text-gray-500'
                                    }`}>{step.n}</span>
                                    <span className="text-[10px] font-semibold uppercase tracking-wide hidden sm:inline">{step.label}</span>
                                </div>
                                {i < STEPS.length - 1 && <div className="w-6 h-px bg-white/10 mx-0.5" />}
                            </React.Fragment>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                    {targetCount > 0 ? (
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-300/90 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                            <Icons8Icon id="sparkles_ui" size={11} /> {targetCount} target{targetCount !== 1 ? 's' : ''} ready
                        </div>
                    ) : (
                        <span className="text-[10px] text-gray-500">Select folders/files in the list first</span>
                    )}
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer shrink-0" title="Allow overwriting read-only or system-protected icons">
                        <input
                            type="checkbox"
                            checked={config.allowGlobalIconOverwrite ?? false}
                            onChange={e => updateConfig({ allowGlobalIconOverwrite: e.target.checked })}
                            className="accent-pink-500"
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
