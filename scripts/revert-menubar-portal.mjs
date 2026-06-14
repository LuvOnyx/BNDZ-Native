import fs from 'fs';
const p = 'src/components/BNDZUI.tsx';
let s = fs.readFileSync(p, 'utf8');

const menus = ['File','Edit','View','Go','Tools','Favorites','Tags','User','Scripting','Panes','Tabsets','Window','Help'];
for (const id of menus) {
  const openOld = `<PortaledDropdown open={openMenuId === '${id}'} anchorEl={menubarAnchors.current['${id}']} className="bg-[#1f1f1f] border border-[#444] shadow-xl rounded-md py-1 min-w-[200px]" onMouseDown={e => e.stopPropagation()}>`;
  const openNew = `<div className={\`fixed z-[300] bg-[#1f1f1f] border border-[#444] shadow-xl rounded-md py-1 min-w-[200px] max-h-[calc(100vh-48px)] overflow-y-auto bndz-scrollbar \${openMenuId === '${id}' ? 'block' : 'hidden'}\`} style={openMenuId === '${id}' && menubarAnchors.current['${id}'] ? { top: menubarAnchors.current['${id}']!.getBoundingClientRect().bottom, left: menubarAnchors.current['${id}']!.getBoundingClientRect().left } : undefined} onMouseDown={e => e.stopPropagation()}>`;
  s = s.split(openOld).join(openNew);
  s = s.split('</PortaledDropdown>').join('</div>');
}

// Remove PortaledDropdown import if unused
if (!s.includes('PortaledDropdown')) {
  s = s.replace("import PortaledDropdown from './PortaledDropdown';\n", '');
}

// Fix File menu wrapper ref
s = s.replace(`<div className="relative">\n             <div \n                 data-menu-trigger\n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${openMenuId === 'File'`,
  `<div className="relative shrink-0" ref={bindMenuAnchor('File')}>\n             <div \n                 data-menu-trigger\n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${openMenuId === 'File'`);

// Menubar scroll container - allow visible overflow for Y
s = s.replace(
  'className="flex items-center flex-1 px-1 min-w-0 overflow-x-auto scrollbar-hidden"',
  'className="flex items-center flex-1 px-1 min-w-0 overflow-x-auto overflow-y-visible scrollbar-hidden"'
);

fs.writeFileSync(p, s);
console.log('reverted to fixed-position overflow menus');
