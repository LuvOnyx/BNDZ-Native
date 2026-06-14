import fs from 'fs';
const p = 'src/components/BNDZUI.tsx';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/(<PortaledDropdown[\s\S]*?)\n\s*<\/div>\n(\s*\)\})/g, '$1\n                 </PortaledDropdown>\n$2');
fs.writeFileSync(p, s);
console.log('opens', (s.match(/<PortaledDropdown/g) || []).length, 'closes', (s.match(/<\/PortaledDropdown>/g) || []).length);
