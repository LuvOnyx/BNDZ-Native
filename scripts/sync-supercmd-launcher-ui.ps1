# Sync SuperCmd launcher UI sources into BNDZ launcher shell
# Source: https://github.com/SuperCmdLabs/SuperCmd (MIT)
param(
    [string]$Root = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$SuperCmd = Join-Path $Root "external\SuperCmd"
if (-not (Test-Path $SuperCmd)) {
    Write-Host "==> Cloning SuperCmd..." -ForegroundColor Yellow
    git clone --depth 1 https://github.com/SuperCmdLabs/SuperCmd.git $SuperCmd
}

$Pairs = @(
    @{ Src = "src\renderer\src\components\LauncherSurface.tsx"; Dst = "src\launcher\_supercmd\LauncherSurface.tsx" },
    @{ Src = "src\renderer\src\components\LauncherCommandRow.tsx"; Dst = "src\launcher\_supercmd\LauncherCommandRow.tsx" },
    @{ Src = "src\renderer\src\components\LauncherCommandList.tsx"; Dst = "src\launcher\_supercmd\LauncherCommandList.tsx" },
    @{ Src = "src\renderer\src\components\LauncherSearchHeader.tsx"; Dst = "src\launcher\_supercmd\LauncherSearchHeader.tsx" },
    @{ Src = "src\renderer\src\components\LauncherFooter.tsx"; Dst = "src\launcher\_supercmd\LauncherFooter.tsx" },
    @{ Src = "src\renderer\src\hooks\useAppViewManager.ts"; Dst = "src\launcher\_supercmd\useAppViewManager.ts" },
    @{ Src = "src\renderer\styles\index.css"; Dst = "src\launcher\_supercmd\index.css" },
    @{ Src = "src\main\clipboard-manager.ts"; Dst = "src\launcher\_supercmd\clipboard-manager.ts" },
    @{ Src = "src\main\commands.ts"; Dst = "src\launcher\_supercmd\commands.ts" },
    @{ Src = "src\renderer\src\hooks\useAiChat.ts"; Dst = "src\launcher\_supercmd\useAiChat.ts" },
    @{ Src = "src\renderer\src\views\AiChatView.tsx"; Dst = "src\launcher\_supercmd\AiChatView.tsx" },
    @{ Src = "src\renderer\src\raycast-api\detail-markdown.tsx"; Dst = "src\launcher\_supercmd\detail-markdown.tsx" },
    @{ Src = "src\renderer\src\SnippetManager.tsx"; Dst = "src\launcher\_supercmd\SnippetManager.tsx" },
    @{ Src = "src\renderer\src\QuickLinkManager.tsx"; Dst = "src\launcher\_supercmd\QuickLinkManager.tsx" }
)

$header = @"
// Reference copy from SuperCmd (MIT) — https://github.com/SuperCmdLabs/SuperCmd
// BNDZ-adapted implementations live alongside in src/launcher/components/
// Re-sync: .\scripts\sync-supercmd-launcher-ui.ps1

"@

foreach ($pair in $Pairs) {
    $srcPath = Join-Path $SuperCmd $pair.Src
    $dstPath = Join-Path $Root $pair.Dst
    if (-not (Test-Path $srcPath)) {
        Write-Warning "Missing SuperCmd file: $($pair.Src)"
        continue
    }
    $dstDir = Split-Path -Parent $dstPath
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    if ((Test-Path $dstPath) -and -not $Force) {
        Write-Host "Skip (exists): $($pair.Dst)" -ForegroundColor DarkGray
        continue
    }
    $content = Get-Content $srcPath -Raw -Encoding UTF8
    Set-Content -Path $dstPath -Value ($header + $content) -Encoding UTF8 -NoNewline
    Write-Host "Synced: $($pair.Dst)" -ForegroundColor Green
}

Write-Host "==> SuperCmd reference sync complete" -ForegroundColor Cyan
