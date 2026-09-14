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

    return (
        <IconStudioProvider nativeSyncEnabled={isPluginTabActive !== false}>
            <PluginPanelShell title="Icon Studio" icon="icon_studio" iconColor="#94a3b8" variant="embedded">
                <IconStudioInner
                    selectedItems={selectedItems}
                    selectedTargetTypes={selectedTargetTypes}
                    focusedPath={focusedPath}
                    targetCount={targetCount}
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
}: {
    selectedItems?: string[];
    selectedTargetTypes?: string[];
    focusedPath?: string;
    targetCount: number;
}) {
    const { config, updateConfig } = useAppConfig();

    return (
        <div className={`${styles.container} flex-col`} data-icon-studio>
            <div className="bndz-iconstudio-opsrail shrink-0">
                <div className="bndz-iconstudio-opsrail-copy min-w-0">
                    <div className="bndz-iconstudio-opsrail-title">Icon Studio</div>
                    <div className="bndz-iconstudio-opsrail-meta">
                        {targetCount > 0
                            ? `${targetCount} target${targetCount !== 1 ? 's' : ''} selected · pick an icon and apply`
                            : 'Pick a library · choose an icon · select items in the list to apply'}
                    </div>
                </div>
                <div className="bndz-iconstudio-opsrail-actions">
                    <label className="flex items-center gap-1.5 text-[10px] text-white/45 cursor-pointer shrink-0" title="Allow overwriting read-only or system-protected icons">
                        <input
                            type="checkbox"
                            checked={config.allowGlobalIconOverwrite ?? false}
                            onChange={e => updateConfig({ allowGlobalIconOverwrite: e.target.checked })}
                            className="accent-[#38bdf8]"
                        />
                        <Icons8Icon id="shield_ui" size={11} className="opacity-60" />
                        <span>Force apply</span>
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
