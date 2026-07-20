/** Re-export context submenu primitives with menubar-friendly styling */
export { ContextSubmenu as MenubarSubmenu, runMenuAction as menubarMenuAction } from './ContextSubmenu';

export const menubarPanelClass =
  'fixed z-[300] bg-[#1f1f1f] border border-[#444] shadow-xl rounded-md py-1 min-w-[220px] bndz-scrollbar';

export const menubarItemClass =
  'px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2 select-none';

export const menubarSeparatorClass = 'h-[1px] bg-[#444] my-1 mx-1';
