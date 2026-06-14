import React from 'react';
import { useAppConfig } from '../data/configContext';
import { Button } from './ui/button';
import { RefreshCw, Trash2, Settings } from 'lucide-react';

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
      <div className="h-full flex flex-col m-0 p-0 outline-none text-white overflow-hidden p-6 gap-6">
         <div>
             <h1 className="text-[20px] font-bold text-white mb-2 leading-tight">Icon Engine Configuration</h1>
             <p className="text-[12px] text-[#e0e0e0] leading-relaxed">
                 Configure global system settings for the BNDZ Icon Engine. Use the "Icon Studio" module in the bottom panel to manage and assign your custom libraries.
             </p>
         </div>

         <div className="flex flex-col gap-4 border border-[#333] p-4 rounded-md bg-[#171717]">
             <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Settings size={14} className="text-sky-400"/> System Overrides</h2>
             
             <label className="flex items-center gap-3 text-sm cursor-pointer hover:text-white text-gray-300">
                  <input 
                      type="checkbox" 
                      className="accent-sky-500 h-4 w-4"
                      checked={config.allowGlobalIconOverwrite ?? false}
                      onChange={(e) => updateConfig({ allowGlobalIconOverwrite: e.target.checked })}
                  />
                  <span>Allow BNDZ to overwrite global Windows .ico Registry values system-wide</span>
              </label>

              <label className="flex items-center gap-3 text-sm cursor-pointer hover:text-white text-gray-300">
                  <input 
                      type="checkbox" 
                      className="accent-sky-500 h-4 w-4"
                      checked={config.autoConvertIcons ?? true}
                      onChange={(e) => updateConfig({ autoConvertIcons: e.target.checked })}
                  />
                  <span>Auto-convert imported PNG/SVG assets to multi-res Windows .ico format</span>
              </label>

              <label className="flex items-center gap-3 text-sm cursor-pointer hover:text-white text-gray-300">
                  <input 
                      type="checkbox" 
                      className="accent-sky-500 h-4 w-4"
                      checked={config.enableIconContextSubmenu ?? true}
                      onChange={(e) => updateConfig({ enableIconContextSubmenu: e.target.checked })}
                  />
                  <span>Show Icon Studio libraries in the Change Icon context menu</span>
              </label>
         </div>

         <div className="flex flex-col gap-4 border border-[#333] p-4 rounded-md bg-[#171717]">
             <h2 className="text-sm font-semibold text-white">Cache Management</h2>
             <p className="text-xs text-gray-400 max-w-xl">
                 BNDZ aggressively caches native shell icons to disk. If system icons begin showing incorrectly or if you've recently installed large icon packs, you may need to purge or rebuild the cache.
             </p>
             <div className="flex gap-4 mt-2 items-center">
                 <Button variant="outline" className="h-8 text-xs border-[#444] text-red-400 hover:text-red-300 hover:bg-red-950/30" onClick={clearCache}>
                     <Trash2 size={14} className="mr-2" /> Purge SSD Icon Cache
                 </Button>
                 <Button variant="outline" className="h-8 text-xs border-[#444] text-sky-400 hover:text-sky-300 hover:bg-sky-950/30" onClick={rebuildCache}>
                     <RefreshCw size={14} className="mr-2" /> Force Rebuild Cache
                 </Button>
                 {cacheStatus && <span className="text-[11px] text-emerald-400">{cacheStatus}</span>}
             </div>
         </div>
      </div>
   );
}
