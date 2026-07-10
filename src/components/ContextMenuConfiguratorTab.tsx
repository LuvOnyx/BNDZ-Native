import React from 'react';
import { useAppConfig } from '../data/configContext';
import { Icons8Icon } from './Icons8Icon';

export default function ContextMenuConfiguratorTab() {
    const { config, updateConfig } = useAppConfig();

    return (
        <div className="h-full flex flex-col m-0 p-0 outline-none text-white overflow-hidden p-6 gap-6">
             <div>
                 <h1 className="text-[20px] font-bold text-white mb-2 leading-tight">Context Menu Environment</h1>
                 <p className="text-[12px] text-[#e0e0e0] leading-relaxed">
                     Configure global injection settings. To build and customize your menus, use the "Menu Architect" module in the bottom panel.
                 </p>
             </div>

             <div className="flex flex-col gap-4 border border-[#333] p-4 rounded-md bg-[#171717]">
                 <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Icons8Icon id="config" size={14} className="text-[#7eb8e8]"/> System Injections</h2>
                 
                 <label className="flex items-center gap-3 text-sm cursor-pointer hover:text-white text-gray-300">
                      <input 
                          type="checkbox" 
                          className="accent-[#0078d4] h-4 w-4"
                          checked={config.overrideWin11MoreOptions ?? false}
                          onChange={(e) => updateConfig({ overrideWin11MoreOptions: e.target.checked })}
                      />
                      <span>Override Windows 11 'Show More Options' natively</span>
                  </label>

                  <label className="flex items-center gap-3 text-sm cursor-pointer hover:text-white text-gray-300">
                      <input 
                          type="checkbox" 
                          className="accent-[#0078d4] h-4 w-4"
                          checked={config.injectGlobalContextMenu ?? false}
                          onChange={(e) => updateConfig({ injectGlobalContextMenu: e.target.checked })}
                      />
                      <span>Inject Custom BNDZ Engine into Global Windows Explorer (HKEY_CLASSES_ROOT)</span>
                  </label>
             </div>
        </div>
    );
}
