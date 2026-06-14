import fs from 'fs';

const p = 'src/components/BNDZUI.tsx';
let s = fs.readFileSync(p, 'utf8');

s = s.replace(/(<PortaledDropdown[\s\S]*?)\n(\s*)<\/div>\n(\s*\)\})/g, '$1\n$2</PortaledDropdown>\n$3');

// Add shrink-0 refs where missing
const menus = ['File','Edit','View','Go','Tools','Favorites','Tags','User','Scripting','Panes','Tabsets','Window','Help'];
for (const id of menus) {
  const needle = `openMenuId === '${id}' ? 'bg-[#333]'`;
  if (!s.includes(`bindMenuAnchor('${id}')`)) {
    s = s.replace(
      `<div className="relative">\n             <div \n                 data-menu-trigger\n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${${needle}`,
      `<div className="relative shrink-0" ref={bindMenuAnchor('${id}')}>\n             <div \n                 data-menu-trigger\n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${${needle}`
    );
    s = s.replace(
      `<div className="relative">\n             <div \n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${${needle}`,
      `<div className="relative shrink-0" ref={bindMenuAnchor('${id}')}>\n             <div \n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${${needle}`
    );
  }
}

fs.writeFileSync(p, s);
console.log('close tags fixed');
