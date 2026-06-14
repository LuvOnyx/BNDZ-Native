import fs from 'fs';
const p = 'src/components/BNDZUI.tsx';
let s = fs.readFileSync(p, 'utf8');
const menus = ['Edit','View','Go','Tools','Favorites','Tags','User','Scripting','Panes','Tabsets','Window','Help'];
for (const id of menus) {
  if (s.includes(`bindMenuAnchor('${id}')`)) continue;
  s = s.replace(
    `<div className="relative">\n             <div \n                 data-menu-trigger\n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${openMenuId === '${id}'`,
    `<div className="relative shrink-0" ref={bindMenuAnchor('${id}')}>\n             <div \n                 data-menu-trigger\n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${openMenuId === '${id}'`
  );
  s = s.replace(
    `<div className="relative">\n             <div \n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${openMenuId === '${id}'`,
    `<div className="relative shrink-0" ref={bindMenuAnchor('${id}')}>\n             <div \n                 className={\`px-2 py-[2px] cursor-pointer rounded-sm \${openMenuId === '${id}'`
  );
}
fs.writeFileSync(p, s);
console.log('anchors bound');
