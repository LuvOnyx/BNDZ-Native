import fs from 'fs';

const p = 'src/components/BNDZUI.tsx';
let s = fs.readFileSync(p, 'utf8');

if (!s.includes("import PortaledDropdown")) {
  s = s.replace(
    "import ConfigurationDialog from './ConfigurationDialog';",
    "import ConfigurationDialog from './ConfigurationDialog';\nimport PortaledDropdown from './PortaledDropdown';"
  );
}

if (!s.includes('menubarAnchors')) {
  s = s.replace(
    'const menubarRef = React.useRef<HTMLDivElement>(null);',
    `const menubarRef = React.useRef<HTMLDivElement>(null);
  const menubarAnchors = React.useRef<Record<string, HTMLDivElement | null>>({});
  const bindMenuAnchor = (id: string) => (el: HTMLDivElement | null) => { menubarAnchors.current[id] = el; };`
  );
}

const menus = ['File','Edit','View','Go','Tools','Favorites','Tags','User','Scripting','Panes','Tabsets','Window','Help'];

for (const id of menus) {
  const oldOpen = `<div className={\`absolute top-[100%] left-0 bg-[#1f1f1f] border border-[#444] shadow-xl rounded-md py-1 min-w-[200px] z-[110] \${openMenuId === '${id}' ? 'block' : 'hidden'}\`} onMouseDown={e => e.stopPropagation()}>`;
  const newOpen = `<PortaledDropdown open={openMenuId === '${id}'} anchorEl={menubarAnchors.current['${id}']} className="bg-[#1f1f1f] border border-[#444] shadow-xl rounded-md py-1 min-w-[200px]" onMouseDown={e => e.stopPropagation()}>`;
  s = s.split(oldOpen).join(newOpen);

  // bind anchor on relative wrapper before this menu's trigger
  const relOld = `<div className="relative">\n             <div \n                 data-menu-trigger\n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${openMenuId === '${id}'`;
  const relNew = `<div className="relative shrink-0" ref={bindMenuAnchor('${id}')}>\n             <div \n                 data-menu-trigger\n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${openMenuId === '${id}'`;
  if (s.includes(relOld)) s = s.replace(relOld, relNew);

  const relOld2 = `<div className="relative">\n             <div \n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${openMenuId === '${id}'`;
  const relNew2 = `<div className="relative shrink-0" ref={bindMenuAnchor('${id}')}>\n             <div \n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${openMenuId === '${id}'`;
  if (s.includes(relOld2)) s = s.replace(relOld2, relNew2);
}

// Close PortaledDropdown: after each menu block, the dropdown closing tag
for (const id of menus) {
  const marker = `anchorEl={menubarAnchors.current['${id}']}`;
  if (!s.includes(marker)) continue;
  const idx = s.indexOf(marker);
  if (idx < 0) continue;
  const after = s.slice(idx);
  const endCond = after.indexOf('{config.');
  const endMenu = after.indexOf('</div>\n             )}');
  if (endMenu > 0 && (endCond < 0 || endMenu < endCond)) {
    const globalIdx = idx + endMenu;
    s = s.slice(0, globalIdx) + '</PortaledDropdown>\n             )}' + s.slice(globalIdx + '</div>\n             )}'.length);
  }
}

fs.writeFileSync(p, s);
console.log('menubar patch applied');
