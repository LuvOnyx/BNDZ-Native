/** Extensions treated as editable text in the preview panel */
export const TEXT_EDIT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'log', 'csv', 'ini', 'cfg', 'conf', 'json', 'xml', 'yaml', 'yml',
  'toml', 'bat', 'cmd', 'ps1', 'sh', 'env', 'gitignore', 'htaccess', 'reg', 'inf',
]);

export const CODE_EXTENSIONS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'cs', 'html', 'htm', 'css', 'scss', 'less', 'py', 'cpp', 'c', 'h',
  'hpp', 'java', 'go', 'rs', 'php', 'rb', 'sql', 'vue', 'svelte', 'lua',
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
  return e === 'html' || e === 'htm';
}

export function isMarkdownExt(ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  return e === 'md' || e === 'markdown';
}

export function isDocxExt(ext: string): boolean {
  return ext.toLowerCase().replace(/^\./, '') === 'docx';
}

export function prismLanguageForExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx', py: 'python',
    cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', md: 'markdown', ps1: 'powershell',
    sh: 'bash', yml: 'yaml', yaml: 'yaml', json: 'json', html: 'html', htm: 'html',
    css: 'css', xml: 'xml', sql: 'sql', go: 'go', rs: 'rust', java: 'java', php: 'php',
    lua: 'lua', rb: 'ruby', vue: 'markup', svelte: 'markup',
  };
  return map[e] || e;
}
