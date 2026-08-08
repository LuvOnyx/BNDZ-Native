import React from 'react';
import { useAppConfig } from '../data/configContext';
import { Button } from './ui/button';
import { Icons8Icon } from './Icons8Icon';
import { Checkbox } from './ui/checkbox';
import { SettingsTabHeader, SettingsSection } from './settings/SettingsPrimitives';

export default function IconConfiguratorTab() {
   const { config, updateConfig } = useAppConfig();

   const [cacheStatus, setCacheStatus] = React.useState<string | null>(null);

   const clearCache = () => {
       import('../lib/ipcBridge').then(({ IPC }) => {
           IPC.clearIconCache().then(() => {
               updateConfig({ iconCacheBuster: Date.now() });
               setCacheStatus('Icon cache purged.');
               setTimeout(() => setCacheStatus(null), 3000);
           });
       });
   };

   const rebuildCache = () => {
       import('../lib/ipcBridge').then(async ({ IPC }) => {
           await IPC.clearIconCache();
           // Cache-bust everything, then re-request workspace data so icons refetch immediately
           updateConfig({ iconCacheBuster: Date.now() });
           const { clearIconCache: clearClientCache } = await import('../lib/nativeIconService');
           clearClientCache();
           IPC.refreshWorkspace?.().catch(() => {});
           setCacheStatus('Cache cleared — icons are re-fetching now.');
           setTimeout(() => setCacheStatus(null), 3000);
       });
   };

   return (
      <div className="m-0 p-0 outline-none text-white min-h-0 pb-4">
         <SettingsTabHeader
           title="Icon Engine Configuration"
           description='Configure global system settings for the BNDZ Icon Engine. Use the "Icon Studio" module in the bottom panel to manage and assign your custom libraries.'
           icon="config"
         />

         <SettingsSection title="System Overrides" description="Registry and import behavior for custom icon packs.">
             <Checkbox
               label="Allow BNDZ to overwrite global Windows .ico Registry values system-wide"
               checked={config.allowGlobalIconOverwrite ?? false}
               onChange={(e) => updateConfig({ allowGlobalIconOverwrite: e.target.checked })}
             />
             <Checkbox
               label="Auto-convert imported PNG/SVG assets to multi-res Windows .ico format"
               checked={config.autoConvertIcons ?? true}
               onChange={(e) => updateConfig({ autoConvertIcons: e.target.checked })}
             />
             <Checkbox
               label="Show Icon Studio in Windows Explorer context menus (and in BNDZ Change Icon)"
               checked={config.enableIconContextSubmenu ?? true}
               onChange={(e) => {
                 updateConfig({ enableIconContextSubmenu: e.target.checked });
                 void import('../lib/shellIntegrationRuntime').then(({ applyBackendSettings }) => {
                   applyBackendSettings({ ...config, enableIconContextSubmenu: e.target.checked });
                 });
               }}
             />
             <p className="text-[10px] text-white/40 -mt-1 mb-1 leading-snug pl-6">
               Right-click a desktop/file item → Icon Studio opens BNDZ with that item and the Icon Studio plugin.
               Uncheck to remove the Explorer verb from the registry.
             </p>
         </SettingsSection>

         <SettingsSection title="Cache Management" description="BNDZ aggressively caches native shell icons to disk. If system icons begin showing incorrectly or if you've recently installed large icon packs, purge or rebuild the cache.">
             <div className="flex flex-wrap gap-3 items-center pt-1">
                 <Button variant="outline" className="h-9 text-xs border-[#444] text-red-400 hover:text-red-300 hover:bg-red-950/30 shrink-0" onClick={clearCache}>
                     <Icons8Icon id="trash_ui" size={14} className="mr-2" /> Purge SSD Icon Cache
                 </Button>
                 <Button variant="outline" className="h-9 text-xs border-[#444] text-[#7eb8e8] hover:text-[#99c9f0] hover:bg-[#094771]/30 shrink-0" onClick={rebuildCache}>
                     <Icons8Icon id="refresh" size={14} className="mr-2" /> Force Rebuild Cache
                 </Button>
                 {cacheStatus && <span className="text-[11px] text-emerald-400">{cacheStatus}</span>}
             </div>
         </SettingsSection>
      </div>
   );
}
