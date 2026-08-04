/** Preset catalog + stock BNDZ context-menu blueprint for Shell Menus designer. */

export type TargetMode = 'all' | 'directory' | 'background';

export interface MenuActionSeed {
  name: string;
  command: string;
  icon?: string;
  targetMode?: TargetMode;
  /** Context-menu icon verb for live preview */
  iconVerb?: string;
}

export interface MenuPreset {
  id: string;
  category: string;
  label: string;
  desc: string;
  action: MenuActionSeed;
  /** app = Inside BNDZ, global = Windows Explorer inject */
  surfaces: Array<'app' | 'global'>;
}

export interface StockMenuRow {
  id: string;
  label: string;
  iconVerb?: string;
  kind: 'item' | 'sep' | 'submenu' | 'zone';
  /** Which preview surfaces show this row */
  surfaces: Array<'file' | 'folder' | 'background'>;
  muted?: boolean;
}

export const PRESET_CATEGORIES = [
  { id: 'all', label: 'All', color: '#94a3b8' },
  { id: 'Open', label: 'Open', color: '#38bdf8' },
  { id: 'Terminal', label: 'Terminal', color: '#4ade80' },
  { id: 'Clipboard', label: 'Clipboard', color: '#eab308' },
  { id: 'Edit', label: 'Edit', color: '#a78bfa' },
  { id: 'View', label: 'View', color: '#f472b6' },
  { id: 'Navigate', label: 'Navigate', color: '#60a5fa' },
  { id: 'Archive', label: 'Archive', color: '#fb923c' },
  { id: 'Dev', label: 'Dev', color: '#34d399' },
  { id: 'System', label: 'System', color: '#f87171' },
  { id: 'Network', label: 'Network', color: '#0078d4' },
  { id: 'Media', label: 'Media', color: '#ec4899' },
  { id: 'Hash', label: 'Hash / Verify', color: '#c084fc' },
  { id: 'Structure', label: 'Structure', color: '#64748b' },
] as const;

/** Built-in BNDZ right-click rows the designer previews around your custom zone. */
export const STOCK_BNDZ_MENU: StockMenuRow[] = [
  { id: 'open', label: 'Open', iconVerb: 'open', kind: 'item', surfaces: ['file', 'folder'] },
  { id: 'open-tab', label: 'Open in New Tab', iconVerb: 'open', kind: 'item', surfaces: ['folder'] },
  { id: 'sep-1', label: '', kind: 'sep', surfaces: ['file', 'folder', 'background'] },
  { id: 'refresh', label: 'Refresh List', iconVerb: 'refresh', kind: 'item', surfaces: ['background'] },
  { id: 'new', label: 'New', iconVerb: 'newfolder', kind: 'submenu', surfaces: ['background'] },
  { id: 'paste-bg', label: 'Paste', iconVerb: 'paste', kind: 'item', surfaces: ['background'] },
  { id: 'select-all', label: 'Select all', iconVerb: 'type', kind: 'item', surfaces: ['background'] },
  { id: 'invert', label: 'Invert selection', iconVerb: 'type', kind: 'item', surfaces: ['background'] },
  { id: 'cut', label: 'Cut', iconVerb: 'cut', kind: 'item', surfaces: ['file', 'folder'] },
  { id: 'copy', label: 'Copy', iconVerb: 'copy', kind: 'item', surfaces: ['file', 'folder'] },
  { id: 'paste', label: 'Paste', iconVerb: 'paste', kind: 'item', surfaces: ['file', 'folder'] },
  { id: 'rename', label: 'Rename', iconVerb: 'rename', kind: 'item', surfaces: ['file', 'folder'] },
  { id: 'delete', label: 'Delete', iconVerb: 'delete', kind: 'item', surfaces: ['file', 'folder'] },
  { id: 'sep-2', label: '', kind: 'sep', surfaces: ['file', 'folder'] },
  { id: 'pin', label: 'Pin to Rapid access', iconVerb: 'star', kind: 'item', surfaces: ['folder'] },
  { id: 'index', label: 'Index folder for search', iconVerb: 'search', kind: 'item', surfaces: ['folder'] },
  { id: 'mesh', label: 'Mesh Drop…', iconVerb: 'share', kind: 'item', surfaces: ['file', 'folder'] },
  { id: 'ghost', label: 'Ghost-Link offload…', iconVerb: 'link', kind: 'item', surfaces: ['file', 'folder'] },
  { id: 'ram', label: 'Stage to RAM…', iconVerb: 'harddrive', kind: 'item', surfaces: ['file', 'folder'] },
  { id: 'health', label: 'Scan library health…', iconVerb: 'shield', kind: 'item', surfaces: ['folder'] },
  { id: 'sandbox', label: 'Open sandbox session…', iconVerb: 'folder', kind: 'item', surfaces: ['folder'] },
  { id: 'smart-rename', label: 'Smart Rename', iconVerb: 'sparkles', kind: 'item', surfaces: ['file'] },
  { id: 'sep-before-custom', label: '', kind: 'sep', surfaces: ['file', 'folder', 'background'] },
  { id: 'custom-zone', label: 'Your custom items', kind: 'zone', surfaces: ['file', 'folder', 'background'] },
  { id: 'sep-after-custom', label: '', kind: 'sep', surfaces: ['file', 'folder', 'background'] },
  { id: 'open-in', label: 'Open in…', iconVerb: 'open', kind: 'submenu', surfaces: ['file', 'folder'] },
  { id: 'share', label: 'Share', iconVerb: 'share', kind: 'item', surfaces: ['file', 'folder'] },
  { id: 'properties', label: 'Properties', iconVerb: 'properties', kind: 'item', surfaces: ['file', 'folder', 'background'] },
];

export const SHELL_MENU_PRESETS: MenuPreset[] = [
  // ── Open ──────────────────────────────────────────────────────────────
  { id: 'open-notepad', category: 'Open', label: 'Open with Notepad', desc: 'Classic Notepad', surfaces: ['app', 'global'], action: { name: 'Open with Notepad', command: 'notepad.exe "%1"', targetMode: 'all', iconVerb: 'edit' } },
  { id: 'open-notepadpp', category: 'Open', label: 'Open with Notepad++', desc: 'Notepad++ if installed', surfaces: ['app', 'global'], action: { name: 'Open with Notepad++', command: 'notepad++.exe "%1"', targetMode: 'all', iconVerb: 'edit' } },
  { id: 'open-vscode', category: 'Open', label: 'Open with VS Code', desc: 'code "%1"', surfaces: ['app', 'global'], action: { name: 'Open with VS Code', command: 'code "%1"', targetMode: 'all', iconVerb: 'edit' } },
  { id: 'open-vscode-folder', category: 'Open', label: 'VS Code Here', desc: 'Open folder in Code', surfaces: ['app', 'global'], action: { name: 'Open with VS Code', command: 'code "%L"', targetMode: 'directory', iconVerb: 'edit' } },
  { id: 'open-cursor', category: 'Open', label: 'Open with Cursor', desc: 'cursor "%1"', surfaces: ['app', 'global'], action: { name: 'Open with Cursor', command: 'cursor "%1"', targetMode: 'all', iconVerb: 'edit' } },
  { id: 'open-wordpad', category: 'Open', label: 'Open with WordPad', desc: 'write.exe', surfaces: ['app', 'global'], action: { name: 'Open with WordPad', command: 'write.exe "%1"', targetMode: 'all', iconVerb: 'edit' } },
  { id: 'open-paint', category: 'Open', label: 'Open with Paint', desc: 'mspaint', surfaces: ['app', 'global'], action: { name: 'Open with Paint', command: 'mspaint.exe "%1"', targetMode: 'all', iconVerb: 'edit' } },
  { id: 'open-photos', category: 'Open', label: 'Open with Photos', desc: 'ms-photos', surfaces: ['app', 'global'], action: { name: 'Open with Photos', command: 'explorer.exe shell:AppsFolder\\Microsoft.Windows.Photos_8wekyb3d8bbwe!App', targetMode: 'all', iconVerb: 'eye' } },
  { id: 'open-default', category: 'Open', label: 'Open with default app', desc: 'Shell default handler', surfaces: ['app', 'global'], action: { name: 'Open', command: 'explorer.exe "%1"', targetMode: 'all', iconVerb: 'open' } },
  { id: 'open-bndz', category: 'Open', label: 'Browse in BNDZ', desc: 'Folder → BNDZ', surfaces: ['global'], action: { name: 'Open in BNDZ', command: 'bndz-open-path', targetMode: 'directory', iconVerb: 'open' } },
  { id: 'open-bndz-problems', category: 'Open', label: 'BNDZ Problems', desc: 'Open /bndz/problems', surfaces: ['global'], action: { name: 'BNDZ Problems', command: 'bndz-open-url:bndz://problems', targetMode: 'all', iconVerb: 'shield' } },
  { id: 'open-bndz-inbound', category: 'Open', label: 'BNDZ Inbound', desc: 'Open /bndz/inbound', surfaces: ['global'], action: { name: 'BNDZ Inbound', command: 'bndz-open-url:bndz://inbound', targetMode: 'all', iconVerb: 'download' } },
  { id: 'open-bndz-ram', category: 'Open', label: 'BNDZ RAM Staging', desc: 'Open /bndz/ram', surfaces: ['global'], action: { name: 'BNDZ RAM Staging', command: 'bndz-open-url:bndz://ram', targetMode: 'all', iconVerb: 'harddrive' } },

  // ── Terminal ──────────────────────────────────────────────────────────
  { id: 'term-ps', category: 'Terminal', label: 'PowerShell Here', desc: 'PS in parent folder', surfaces: ['app', 'global'], action: { name: 'Open PowerShell Here', command: 'powershell.exe -NoExit -Command Set-Location -LiteralPath \'%L\'', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'term-cmd', category: 'Terminal', label: 'Command Prompt Here', desc: 'cmd /k', surfaces: ['app', 'global'], action: { name: 'Open Command Prompt Here', command: 'cmd.exe /k cd /d "%L"', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'term-wt', category: 'Terminal', label: 'Windows Terminal Here', desc: 'wt -d', surfaces: ['app', 'global'], action: { name: 'Open Windows Terminal Here', command: 'wt.exe -d "%L"', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'term-wt-admin', category: 'Terminal', label: 'Terminal Admin', desc: 'Elevated wt', surfaces: ['app', 'global'], action: { name: 'Terminal (Admin)', command: 'powershell.exe -Command "Start-Process wt.exe -Verb RunAs -ArgumentList \'-d\',\'%L\'"', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'term-pwsh7', category: 'Terminal', label: 'PowerShell 7 Here', desc: 'pwsh.exe', surfaces: ['app', 'global'], action: { name: 'PowerShell 7 Here', command: 'pwsh.exe -NoExit -Command Set-Location -LiteralPath \'%L\'', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'term-git-bash', category: 'Terminal', label: 'Git Bash Here', desc: 'bash --cd', surfaces: ['app', 'global'], action: { name: 'Git Bash Here', command: 'bash.exe --cd="%L"', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'term-bndz', category: 'Terminal', label: 'BNDZ Open Terminal', desc: 'In-app verb', surfaces: ['app'], action: { name: 'Open Terminal', command: 'openTerminal', iconVerb: 'terminal' } },

  // ── Clipboard ─────────────────────────────────────────────────────────
  { id: 'clip-path', category: 'Clipboard', label: 'Copy Path', desc: 'Full path → clipboard', surfaces: ['app', 'global'], action: { name: 'Copy Path', command: 'cmd.exe /c echo|set /p="%1"| clip', targetMode: 'all', iconVerb: 'copypath' } },
  { id: 'clip-path-quoted', category: 'Clipboard', label: 'Copy as Path (quoted)', desc: 'Quoted path', surfaces: ['app', 'global'], action: { name: 'Copy as Path', command: 'cmd.exe /c echo "%1"| clip', targetMode: 'all', iconVerb: 'copypath' } },
  { id: 'clip-name', category: 'Clipboard', label: 'Copy Name', desc: 'Filename only', surfaces: ['app', 'global'], action: { name: 'Copy Name', command: 'powershell.exe -NoP -C "Set-Clipboard -Value (Split-Path -Leaf \'%1\')"', targetMode: 'all', iconVerb: 'copy' } },
  { id: 'clip-parent', category: 'Clipboard', label: 'Copy Parent Path', desc: 'Folder of item', surfaces: ['app', 'global'], action: { name: 'Copy Parent Path', command: 'cmd.exe /c echo %L| clip', targetMode: 'all', iconVerb: 'copypath' } },
  { id: 'clip-unc', category: 'Clipboard', label: 'Copy as UNC', desc: 'Network-style path', surfaces: ['app', 'global'], action: { name: 'Copy as UNC', command: 'powershell.exe -NoP -C "$p=(Resolve-Path \'%1\').Path; Set-Clipboard $p"', targetMode: 'all', iconVerb: 'copypath' } },
  { id: 'clip-bndz', category: 'Clipboard', label: 'BNDZ Copy Path', desc: 'Native copyPath verb', surfaces: ['app'], action: { name: 'Copy Path', command: 'copyPath', iconVerb: 'copypath' } },
  { id: 'clip-list', category: 'Clipboard', label: 'Copy Selected Paths', desc: 'Multi via %V', surfaces: ['app', 'global'], action: { name: 'Copy Selected Paths', command: 'cmd.exe /c echo %V| clip', targetMode: 'all', iconVerb: 'copy' } },

  // ── Edit ──────────────────────────────────────────────────────────────
  { id: 'edit-notepad', category: 'Edit', label: 'Edit in Notepad', desc: 'Quick text edit', surfaces: ['app', 'global'], action: { name: 'Edit with Notepad', command: 'notepad.exe "%1"', targetMode: 'all', iconVerb: 'edit' } },
  { id: 'edit-hex', category: 'Edit', label: 'Open as Hex (Certutil dump)', desc: 'Hex dump to console', surfaces: ['app', 'global'], action: { name: 'Hex Dump', command: 'cmd.exe /k certutil -encodehex "%1" CON', targetMode: 'all', iconVerb: 'filetext' } },
  { id: 'edit-attrib', category: 'Edit', label: 'Toggle Hidden', desc: 'attrib ±H', surfaces: ['app', 'global'], action: { name: 'Toggle Hidden', command: 'attrib.exe "%1" ±H', targetMode: 'all', iconVerb: 'eye' } },
  { id: 'edit-readonly', category: 'Edit', label: 'Toggle Read-only', desc: 'attrib ±R', surfaces: ['app', 'global'], action: { name: 'Toggle Read-only', command: 'attrib.exe "%1" ±R', targetMode: 'all', iconVerb: 'lock' } },
  { id: 'edit-touch', category: 'Edit', label: 'Touch Modified Time', desc: 'Now stamp', surfaces: ['app', 'global'], action: { name: 'Touch Modified', command: 'powershell.exe -NoP -C "(Get-Item \'%1\').LastWriteTime = Get-Date"', targetMode: 'all', iconVerb: 'refresh' } },

  // ── View (in-app) ─────────────────────────────────────────────────────
  { id: 'view-refresh', category: 'View', label: 'Refresh', desc: 'Reload folder listing', surfaces: ['app'], action: { name: 'Refresh', command: 'refresh', iconVerb: 'refresh' } },
  { id: 'view-details', category: 'View', label: 'Details View', desc: 'Switch list to details', surfaces: ['app'], action: { name: 'Details View', command: 'powershell.exe -NoP -C "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^+\')"', iconVerb: 'layers' } },
  { id: 'view-separator', category: 'Structure', label: 'Menu Separator', desc: 'Visual divider in menu', surfaces: ['app', 'global'], action: { name: '—', command: '', iconVerb: 'filetext' } },

  // ── Navigate ──────────────────────────────────────────────────────────
  { id: 'nav-explorer', category: 'Navigate', label: 'Reveal in Explorer', desc: 'openExplorer verb', surfaces: ['app'], action: { name: 'Open in Explorer', command: 'openExplorer', iconVerb: 'openexplorer' } },
  { id: 'nav-explorer-select', category: 'Navigate', label: 'Select in Explorer', desc: '/select', surfaces: ['app', 'global'], action: { name: 'Select in Explorer', command: 'explorer.exe /select,"%1"', targetMode: 'all', iconVerb: 'openexplorer' } },
  { id: 'nav-parent', category: 'Navigate', label: 'Open Parent Folder', desc: 'Explorer on %L', surfaces: ['app', 'global'], action: { name: 'Open Parent Folder', command: 'explorer.exe "%L"', targetMode: 'all', iconVerb: 'folder' } },
  { id: 'nav-recycle', category: 'Navigate', label: 'Open Recycle Bin', desc: 'shell:RecycleBinFolder', surfaces: ['app', 'global'], action: { name: 'Open Recycle Bin', command: 'explorer.exe shell:RecycleBinFolder', targetMode: 'all', iconVerb: 'trash' } },

  // ── Archive ───────────────────────────────────────────────────────────
  { id: 'arc-zip', category: 'Archive', label: 'Zip with PowerShell', desc: 'Compress-Archive', surfaces: ['app', 'global'], action: { name: 'Compress to Zip', command: 'powershell.exe -NoP -C "Compress-Archive -LiteralPath \'%1\' -DestinationPath (\'%1\' + \'.zip\') -Force"', targetMode: 'all', iconVerb: 'compress' } },
  { id: 'arc-7z', category: 'Archive', label: '7-Zip Add to Archive', desc: '7z a', surfaces: ['app', 'global'], action: { name: 'Add to 7z Archive', command: '7z.exe a "%1.7z" "%1"', targetMode: 'all', iconVerb: 'compress' } },
  { id: 'arc-7z-extract', category: 'Archive', label: '7-Zip Extract Here', desc: '7z x', surfaces: ['app', 'global'], action: { name: 'Extract Here (7z)', command: '7z.exe x "%1" -o"%L\\*" -y', targetMode: 'all', iconVerb: 'extract' } },
  { id: 'arc-tar', category: 'Archive', label: 'Create Tar.gz', desc: 'tar -czf', surfaces: ['app', 'global'], action: { name: 'Create tar.gz', command: 'tar.exe -czf "%1.tar.gz" "%1"', targetMode: 'all', iconVerb: 'compress' } },

  // ── Dev ───────────────────────────────────────────────────────────────
  { id: 'dev-git-status', category: 'Dev', label: 'Git Status Here', desc: 'git status', surfaces: ['app', 'global'], action: { name: 'Git Status', command: 'cmd.exe /k cd /d "%L" && git status', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'dev-git-log', category: 'Dev', label: 'Git Log Here', desc: 'git log --oneline', surfaces: ['app', 'global'], action: { name: 'Git Log', command: 'cmd.exe /k cd /d "%L" && git log --oneline -20', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'dev-npm-i', category: 'Dev', label: 'npm install', desc: 'In folder', surfaces: ['app', 'global'], action: { name: 'npm install', command: 'cmd.exe /k cd /d "%L" && npm install', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'dev-npm-start', category: 'Dev', label: 'npm start', desc: 'In folder', surfaces: ['app', 'global'], action: { name: 'npm start', command: 'cmd.exe /k cd /d "%L" && npm start', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'dev-dotnet', category: 'Dev', label: 'dotnet build', desc: 'Build project', surfaces: ['app', 'global'], action: { name: 'dotnet build', command: 'cmd.exe /k cd /d "%L" && dotnet build', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'dev-cargo', category: 'Dev', label: 'cargo build', desc: 'Rust project', surfaces: ['app', 'global'], action: { name: 'cargo build', command: 'cmd.exe /k cd /d "%L" && cargo build', targetMode: 'directory', iconVerb: 'terminal' } },
  { id: 'dev-py', category: 'Dev', label: 'Run with Python', desc: 'python "%1"', surfaces: ['app', 'global'], action: { name: 'Run with Python', command: 'python.exe "%1"', targetMode: 'all', iconVerb: 'terminal' } },
  { id: 'dev-node', category: 'Dev', label: 'Run with Node', desc: 'node "%1"', surfaces: ['app', 'global'], action: { name: 'Run with Node', command: 'node.exe "%1"', targetMode: 'all', iconVerb: 'terminal' } },

  // ── System ────────────────────────────────────────────────────────────
  { id: 'sys-owner', category: 'System', label: 'Take Ownership', desc: 'takeown + icacls', surfaces: ['app', 'global'], action: { name: 'Take Ownership', command: 'powershell.exe -NoProfile -Command "takeown /f \'%1\' /r /d y; icacls \'%1\' /grant Administrators:F /t"', targetMode: 'all', iconVerb: 'lock' } },
  { id: 'sys-props', category: 'System', label: 'Properties (Explorer)', desc: 'Select + props', surfaces: ['app', 'global'], action: { name: 'Properties', command: 'explorer.exe /select,"%1"', targetMode: 'all', iconVerb: 'properties' } },
  { id: 'sys-perm', category: 'System', label: 'Edit Permissions', desc: 'icacls GUI', surfaces: ['app', 'global'], action: { name: 'Edit Permissions', command: 'explorer.exe /select,"%1"', targetMode: 'all', iconVerb: 'lock' } },
  { id: 'sys-permanent-delete', category: 'System', label: 'Secure Wipe (cipher)', desc: 'cipher /w on folder', surfaces: ['app', 'global'], action: { name: 'Secure Wipe Free Space', command: 'cmd.exe /k cipher /w:"%L"', targetMode: 'directory', iconVerb: 'delete' } },
  { id: 'sys-disk-cleanup', category: 'System', label: 'Disk Cleanup', desc: 'cleanmgr', surfaces: ['app', 'global'], action: { name: 'Disk Cleanup', command: 'cleanmgr.exe', targetMode: 'all', iconVerb: 'harddrive' } },
  { id: 'sys-taskmgr', category: 'System', label: 'Task Manager', desc: 'taskmgr', surfaces: ['app', 'global'], action: { name: 'Task Manager', command: 'taskmgr.exe', targetMode: 'all', iconVerb: 'monitor' } },
  { id: 'sys-regedit', category: 'System', label: 'Registry Editor', desc: 'regedit', surfaces: ['app', 'global'], action: { name: 'Registry Editor', command: 'regedit.exe', targetMode: 'all', iconVerb: 'settings' } },
  { id: 'sys-services', category: 'System', label: 'Services', desc: 'services.msc', surfaces: ['app', 'global'], action: { name: 'Services', command: 'services.msc', targetMode: 'all', iconVerb: 'settings' } },
  { id: 'sys-env', category: 'System', label: 'Environment Variables', desc: 'sysdm.cpl', surfaces: ['app', 'global'], action: { name: 'Environment Variables', command: 'rundll32.exe sysdm.cpl,EditEnvironmentVariables', targetMode: 'all', iconVerb: 'settings' } },

  // ── Network ───────────────────────────────────────────────────────────
  { id: 'net-share', category: 'Network', label: 'Share Folder', desc: 'fsmgmt.msc', surfaces: ['app', 'global'], action: { name: 'Shared Folders', command: 'fsmgmt.msc', targetMode: 'directory', iconVerb: 'share' } },
  { id: 'net-connections', category: 'Network', label: 'Network Connections', desc: 'ncpa.cpl', surfaces: ['app', 'global'], action: { name: 'Network Connections', command: 'ncpa.cpl', targetMode: 'all', iconVerb: 'share' } },
  { id: 'net-ping', category: 'Network', label: 'Ping Host File', desc: 'Ping from name', surfaces: ['app', 'global'], action: { name: 'Ping…', command: 'cmd.exe /k ping %1', targetMode: 'all', iconVerb: 'share' } },
  { id: 'net-map', category: 'Network', label: 'Map Network Drive', desc: 'net use dialog', surfaces: ['app', 'global'], action: { name: 'Map Network Drive', command: 'rundll32.exe shell32.dll,SHHelpShortcuts_RunDLL Connect', targetMode: 'all', iconVerb: 'harddrive' } },

  // ── Media ─────────────────────────────────────────────────────────────
  { id: 'media-vlc', category: 'Media', label: 'Play in VLC', desc: 'vlc "%1"', surfaces: ['app', 'global'], action: { name: 'Play in VLC', command: 'vlc.exe "%1"', targetMode: 'all', iconVerb: 'film' } },
  { id: 'media-mpv', category: 'Media', label: 'Play in mpv', desc: 'mpv', surfaces: ['app', 'global'], action: { name: 'Play in mpv', command: 'mpv.exe "%1"', targetMode: 'all', iconVerb: 'film' } },
  { id: 'media-photos', category: 'Media', label: 'View Image', desc: 'Shell open', surfaces: ['app', 'global'], action: { name: 'View Image', command: 'explorer.exe "%1"', targetMode: 'all', iconVerb: 'eye' } },
  { id: 'media-ffmpeg-info', category: 'Media', label: 'ffprobe Info', desc: 'Media metadata', surfaces: ['app', 'global'], action: { name: 'ffprobe', command: 'cmd.exe /k ffprobe -hide_banner "%1"', targetMode: 'all', iconVerb: 'film' } },

  // ── Hash ──────────────────────────────────────────────────────────────
  { id: 'hash-md5', category: 'Hash', label: 'MD5 Hash', desc: 'Get-FileHash MD5', surfaces: ['app', 'global'], action: { name: 'MD5 Hash', command: 'powershell.exe -NoP -C "Get-FileHash -Algorithm MD5 -LiteralPath \'%1\' | Format-List | Out-Host; pause"', targetMode: 'all', iconVerb: 'lock' } },
  { id: 'hash-sha256', category: 'Hash', label: 'SHA-256 Hash', desc: 'Get-FileHash SHA256', surfaces: ['app', 'global'], action: { name: 'SHA-256 Hash', command: 'powershell.exe -NoP -C "Get-FileHash -Algorithm SHA256 -LiteralPath \'%1\' | Format-List | Out-Host; pause"', targetMode: 'all', iconVerb: 'lock' } },
  { id: 'hash-sha1', category: 'Hash', label: 'SHA-1 Hash', desc: 'Get-FileHash SHA1', surfaces: ['app', 'global'], action: { name: 'SHA-1 Hash', command: 'powershell.exe -NoP -C "Get-FileHash -Algorithm SHA1 -LiteralPath \'%1\' | Format-List | Out-Host; pause"', targetMode: 'all', iconVerb: 'lock' } },
  { id: 'hash-certutil', category: 'Hash', label: 'CertUtil SHA256', desc: 'certutil -hashfile', surfaces: ['app', 'global'], action: { name: 'CertUtil SHA256', command: 'cmd.exe /k certutil -hashfile "%1" SHA256', targetMode: 'all', iconVerb: 'lock' } },

  // ── Structure helpers as presets with special id ──────────────────────
  { id: 'struct-sep', category: 'Structure', label: 'Separator', desc: 'Adds a divider line', surfaces: ['app'], action: { name: 'separator', command: 'separator', iconVerb: 'filetext' } },
];

export function presetsForSurface(surface: 'app' | 'global'): MenuPreset[] {
  return SHELL_MENU_PRESETS.filter(p => p.surfaces.includes(surface));
}

/** Default Explorer inject list — seed when Windows Explorer tab is empty. */
export const DEFAULT_STOCK_GLOBAL_ACTIONS: Array<MenuActionSeed & { id: string }> = [
  { id: 'stock-open-bndz', name: 'Open in BNDZ', command: 'bndz-open-path', targetMode: 'directory', iconVerb: 'open' },
  { id: 'stock-index', name: 'Index folder in BNDZ', command: 'bndz-open-path', targetMode: 'directory', iconVerb: 'search' },
  { id: 'stock-problems', name: 'BNDZ Problems', command: 'bndz-open-url:bndz://problems', targetMode: 'all', iconVerb: 'shield' },
  { id: 'stock-inbound', name: 'BNDZ Inbound', command: 'bndz-open-url:bndz://inbound', targetMode: 'all', iconVerb: 'download' },
  { id: 'stock-ram', name: 'BNDZ RAM Staging', command: 'bndz-open-url:bndz://ram', targetMode: 'all', iconVerb: 'harddrive' },
  { id: 'stock-mesh', name: 'Open in BNDZ (Mesh)', command: 'bndz-open-path', targetMode: 'all', iconVerb: 'share' },
];

export function iconVerbForAction(action: { id?: string; command?: string; iconVerb?: string; name?: string }): string {
  if (action.iconVerb) return action.iconVerb;
  const cmd = (action.command || '').trim();
  if (action.id === 'copy-path' || cmd === 'copyPath') return 'copypath';
  if (action.id === 'os-delete' || /delete|wipe/i.test(action.name || '')) return 'delete';
  if (action.id === 'smart-rename') return 'sparkles';
  if (cmd === 'openTerminal') return 'terminal';
  if (cmd === 'refresh') return 'refresh';
  if (cmd === 'openExplorer') return 'openexplorer';
  if (/powershell|cmd\.exe|wt\.exe|pwsh|bash|terminal/i.test(cmd)) return 'terminal';
  if (/notepad|code |cursor |edit/i.test(cmd)) return 'edit';
  if (/7z|zip|tar|compress/i.test(cmd)) return 'compress';
  if (/hash|certutil|cipher/i.test(cmd)) return 'lock';
  if (/vlc|mpv|ffprobe|mspaint/i.test(cmd)) return 'film';
  return 'filetext';
}
