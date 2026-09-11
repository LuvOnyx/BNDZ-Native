/** Extensions treated as editable text in the preview panel.
 * Expanded from QL-Win/QuickLook SUPPORTED_FORMATS (text/code coverage). */
export const TEXT_EDIT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'mdx', 'mmd', 'mkd', 'mdwn', 'mdown', 'mdc', 'qmd', 'rmd', 'rmarkdown',
  'apib', 'mdtxt', 'mdtext', 'adoc', 'asciidoc', 'rst', 'log', 'csv', 'tsv', 'psv',
  'ini', 'cfg', 'conf', 'config', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml',
  'bat', 'cmd', 'ps1', 'psd1', 'psm1', 'sh', 'env', 'gitignore', 'gitattributes',
  'htaccess', 'reg', 'inf', 'properties', 'diff', 'patch', 'rej', 'sub', 'srt',
  'hosts', 'makefile', 'mk', 'cmake', 'dockerfile', 'editorconfig', 'npmrc', 'nvmrc',
]);

export const CODE_EXTENSIONS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'uts', 'mjs', 'cjs', 'cs', 'html', 'htm', 'css', 'scss', 'less',
  'py', 'cpp', 'cxx', 'cc', 'c', 'h', 'hpp', 'hxx', 'java', 'kt', 'kts', 'go', 'rs', 'php',
  'rb', 'sql', 'vue', 'svelte', 'lua', 'swift', 'scala', 'r', 'dart', 'hs', 'elm', 'ex', 'exs',
  'erl', 'clj', 'cljs', 'fs', 'fsx', 'vb', 'vbs', 'asm', 's', 'zig', 'nim', 'v', 'sv', 'vhd', 'vhdl',
  'proto', 'graphql', 'gql', 'tf', 'hcl', 'sol', 'move', 'wasm', 'wat', 'hlsl', 'glsl', 'wgsl',
  'ipynb',
]);

export function isTextEditableExt(ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  return TEXT_EDIT_EXTENSIONS.has(e) || CODE_EXTENSIONS.has(e);
}

export function isCodeExt(ext: string): boolean {
  return CODE_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, '')) && !isHtmlExt(ext);
}

export function isHtmlExt(ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  return e === 'html' || e === 'htm' || e === 'mht' || e === 'mhtml';
}

export function isMarkdownExt(ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  return (
    e === 'md' || e === 'markdown' || e === 'mdx' || e === 'mdc' || e === 'qmd'
    || e === 'rmd' || e === 'rmarkdown' || e === 'mkd' || e === 'mdwn' || e === 'mdown'
  );
}

export function isDocxExt(ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  return e === 'docx' || e === 'docm' || e === 'odt';
}

/** Spreadsheet / office extras QuickLook covers — preview as download/open fallback in viewer. */
export function isOfficeExt(ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  return ['doc', 'docx', 'docm', 'odt', 'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'ppt', 'pptx', 'odp', 'vsd', 'vsdx'].includes(e);
}

export function isFontExt(ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  return e === 'ttf' || e === 'otf' || e === 'woff' || e === 'woff2' || e === 'ttc';
}

export function isEmailExt(ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  return e === 'eml' || e === 'msg';
}

export function prismLanguageForExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', jsx: 'jsx', tsx: 'tsx', py: 'python',
    cs: 'csharp', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
    md: 'markdown', mdx: 'markdown', ps1: 'powershell',
    sh: 'bash', yml: 'yaml', yaml: 'yaml', json: 'json', jsonl: 'json',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', xml: 'xml', sql: 'sql',
    go: 'go', rs: 'rust', java: 'java', php: 'php', lua: 'lua', rb: 'ruby',
    vue: 'markup', svelte: 'markup', kt: 'kotlin', swift: 'swift',
    r: 'r', dart: 'dart', sol: 'solidity', graphql: 'graphql', proto: 'protobuf',
  };
  return map[e] || e;
}
