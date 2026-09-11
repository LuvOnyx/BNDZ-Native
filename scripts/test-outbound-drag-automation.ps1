# OLE outbound smoke: ole-smoke.json arms FILE_DRAG_ACTIVE; synthetic mouse exits host for escalate.
param(
    [int]$WaitReadySec = 45,
    [switch]$Launch,
    [string[]]$Paths = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$bndzDir = Join-Path $env:LOCALAPPDATA 'BNDZ'
$logPath = Join-Path $bndzDir 'ole-dnd.log'
$triggerPath = Join-Path $bndzDir 'ole-smoke.json'
$logBefore = if (Test-Path $logPath) { (Get-Item $logPath).Length } else { 0 }

function Get-NewLogText {
    if (-not (Test-Path $logPath)) { return '' }
    $raw = [System.IO.File]::ReadAllText($logPath)
    if ($raw.Length -le $logBefore) { return '' }
    return $raw.Substring($logBefore)
}

function Wait-LogMatch([string]$Pattern, [int]$TimeoutSec, [string]$Label) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-NewLogText
        if ($chunk -match $Pattern) {
            Write-Host "OK   $Label"
            return $true
        }
        Start-Sleep -Milliseconds 200
    }
    Write-Host "MISS $Label (timeout ${TimeoutSec}s)"
    return $false
}

if ($Paths.Count -eq 0) {
    $downloads = Join-Path $env:USERPROFILE 'Downloads'
    $Paths = @(
        Get-ChildItem -LiteralPath $downloads -File -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName
    ) | Where-Object { $_ }
}
if ($Paths.Count -eq 0) {
    Write-Host "FAIL: no smoke paths (Downloads empty?)"
    exit 1
}

New-Item -ItemType Directory -Force -Path $bndzDir | Out-Null
try { Remove-Item -LiteralPath $triggerPath -Force -ErrorAction SilentlyContinue } catch { }

if ($Launch) {
    try { taskkill /F /T /IM BNDZShell.exe 2>$null | Out-Null } catch { }
    Start-Sleep -Milliseconds 700
    Start-Process -FilePath (Join-Path $repoRoot 'scripts\run-bndz-native.cmd') -WorkingDirectory $repoRoot
}

Write-Host "Waiting for BNDZShell window (max ${WaitReadySec}s)..."
$deadline = (Get-Date).AddSeconds($WaitReadySec)
$proc = $null
$hwnd = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
    $proc = Get-Process BNDZShell -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc) {
        $hwnd = $proc.MainWindowHandle
        if ($hwnd -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 300
        $proc = Get-Process BNDZShell -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($proc) { $hwnd = $proc.MainWindowHandle }
        if ($hwnd -ne [IntPtr]::Zero) { break }
    }
    Start-Sleep -Milliseconds 200
}
if (-not $proc -or $hwnd -eq [IntPtr]::Zero) {
    Write-Host "FAIL: BNDZShell window not ready"
    exit 1
}
Write-Host "OK   BNDZShell hwnd=0x$($hwnd.ToInt64().ToString('X'))"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class BndzDragMouse {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, int e);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string wnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string wnd);
  public static bool TryGetDesktopIconPoint(out int x, out int y) {
    x = y = 0;
    var prog = FindWindow("Progman", null);
    if (prog == IntPtr.Zero) return false;
    var worker = FindWindowEx(prog, IntPtr.Zero, "WorkerW", null);
    var root = worker != IntPtr.Zero ? worker : prog;
    var shell = FindWindowEx(root, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (shell == IntPtr.Zero && worker != IntPtr.Zero)
      shell = FindWindowEx(prog, IntPtr.Zero, "SHELLDLL_DefView", null);
    var list = shell != IntPtr.Zero ? FindWindowEx(shell, IntPtr.Zero, "SysListView32", null) : IntPtr.Zero;
    var target = list != IntPtr.Zero ? list : root;
    RECT r;
    if (!GetWindowRect(target, out r)) return false;
    x = r.L + Math.Max(48, (r.R - r.L) / 8);
    y = r.T + Math.Max(48, (r.B - r.T) / 6);
    return true;
  }
  public const uint LDOWN=0x0002; public const uint LUP=0x0004; public const uint MOVE=0x0001;
}
"@

[void][BndzDragMouse]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 400

$rect = New-Object BndzDragMouse+RECT
[void][BndzDragMouse]::GetWindowRect($hwnd, [ref]$rect)
$w = $rect.R - $rect.L
$h = $rect.B - $rect.T
$midX = [int]($rect.L + ($w * 0.45))
$insideY = [int]($rect.T + [Math]::Min(280, $h * 0.42))

# Hold LMB inside the list BEFORE smoke arms so escalate sees btnDown=True.
Write-Host "Mouse down inside ($midX,$insideY) before smoke arm..."
[BndzDragMouse]::SetCursorPos($midX, $insideY) | Out-Null
Start-Sleep -Milliseconds 120
[BndzDragMouse]::mouse_event([BndzDragMouse]::LDOWN, 0, 0, 0, 0)
Start-Sleep -Milliseconds 180

@{ paths = $Paths } | ConvertTo-Json | Set-Content -Path $triggerPath -Encoding UTF8
Write-Host "Wrote ole-smoke.json -> $($Paths[0])"

if (-not (Wait-LogMatch 'FILE_DRAG_ACTIVE arm|OLE smoke host-direct arm' 20 'smoke arm in new log')) {
    Write-Host "WARN: continuing drag gesture anyway"
}

# Exit through left layout band (~12%) then onto shell desktop (SysListView32).
$outsideX = [int]($rect.L + [Math]::Max(48, $w * 0.10))
$outsideY = [int]($rect.T + ($h * 0.35))
Add-Type -AssemblyName System.Windows.Forms
$work = [System.Windows.Forms.Screen]::FromHandle($hwnd).WorkingArea
$deskX = [Math]::Max($work.Left + 64, [int]($rect.L - 120))
$deskY = [Math]::Max($work.Top + 64, [int]($rect.T + 80))
$deskPtX = 0; $deskPtY = 0
if ([BndzDragMouse]::TryGetDesktopIconPoint([ref]$deskPtX, [ref]$deskPtY)) {
    $deskX = $deskPtX
    $deskY = $deskPtY
    Write-Host "Desktop icon target from Progman/SysListView32: ($deskX,$deskY)"
}
if ($deskX -ge $rect.L -and $deskX -le $rect.R -and $deskY -ge $rect.T -and $deskY -le $rect.B) {
    $deskX = [int]($work.Left + 96)
    $deskY = [int]($work.Top + 96)
}

Write-Host "Drag: inside -> left rim ($outsideX,$outsideY) -> desktop ($deskX,$deskY)"

$steps = 20
for ($i = 1; $i -le $steps; $i++) {
    $x = $midX + [int](($outsideX - $midX) * ($i / $steps))
    $y = $insideY + [int](($outsideY - $insideY) * ($i / $steps))
    [BndzDragMouse]::SetCursorPos($x, $y) | Out-Null
    [BndzDragMouse]::mouse_event([BndzDragMouse]::MOVE, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 24
}

$steps2 = 12
for ($i = 1; $i -le $steps2; $i++) {
    $x = $outsideX + [int](($deskX - $outsideX) * ($i / $steps2))
    $y = $outsideY + [int](($deskY - $outsideY) * ($i / $steps2))
    [BndzDragMouse]::SetCursorPos($x, $y) | Out-Null
    [BndzDragMouse]::mouse_event([BndzDragMouse]::MOVE, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 32
}

# Hold steady on desktop — do not cross back over BNDZ (folder-hover commit needs ~1.2s).
[BndzDragMouse]::SetCursorPos($deskX, $deskY) | Out-Null
[BndzDragMouse]::mouse_event([BndzDragMouse]::MOVE, 0, 0, 0, 0)
for ($h = 0; $h -lt 30; $h++) {
    [BndzDragMouse]::SetCursorPos($deskX, $deskY) | Out-Null
    [BndzDragMouse]::mouse_event([BndzDragMouse]::MOVE, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 100
}
$pt = New-Object BndzDragMouse+POINT
[void][BndzDragMouse]::GetCursorPos([ref]$pt)
Write-Host "Pre-release cursor=($($pt.X),$($pt.Y)) target desktop=($deskX,$deskY)"
[BndzDragMouse]::mouse_event([BndzDragMouse]::LUP, 0, 0, 0, 0)
Start-Sleep -Milliseconds 1500

Write-Host "Waiting for DoDragDrop end (max 30s)..."
$null = Wait-LogMatch 'DoDragDrop end hr=(DROP|CANCEL)' 30 'DoDragDrop completed'

Write-Host ""
Write-Host "=== New ole-dnd.log lines ==="
$chunk = Get-NewLogText
if ($chunk.Trim()) {
    $chunk.Split("`n") | Where-Object { $_.Trim() } | Select-Object -Last 60 | ForEach-Object { Write-Host $_ }
} else {
    Write-Host '(no new lines)'
}

Write-Host ""
& (Join-Path $PSScriptRoot 'verify-ole-dnd-log.ps1') -TailLines 80 -RequireDropVerify
exit $LASTEXITCODE
