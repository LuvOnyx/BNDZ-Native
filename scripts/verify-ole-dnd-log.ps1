# Verify outbound OLE drag evidence in %LocalAppData%\BNDZ\ole-dnd.log
param(
    [int]$TailLines = 120,
    [switch]$RequireDropVerify
)

$logPath = Join-Path $env:LOCALAPPDATA 'BNDZ\ole-dnd.log'
if (-not (Test-Path $logPath)) {
    Write-Host "FAIL: no ole-dnd.log at $logPath"
    exit 1
}

$lines = Get-Content $logPath -Tail $TailLines
$text = $lines -join "`n"

function Test-Line([string]$Pattern, [string]$Label) {
    if ($text -match $Pattern) {
        Write-Host "OK   $Label"
        return $true
    }
    Write-Host "MISS $Label"
    return $false
}

Write-Host "=== ole-dnd.log (last $TailLines lines) ==="
Write-Host ""

$ok = $true
$ok = (Test-Line 'UI_READY bundle=' 'UI_READY (fresh bundle loaded)') -and $ok
$ok = (Test-Line 'FE_DEBUG drag-policy|drag-policy' 'drag-policy forensics') -and $ok
$pressOrSmoke = (Test-Line 'FE_DEBUG list-press-arm|ole-smoke-arm|OLE smoke FE arm|OLE smoke host-direct arm' 'list press or ole-smoke arm')
if (-not $pressOrSmoke) { $ok = $false }
$ok = (Test-Line 'FE_DEBUG list-drag-mode|FILE_DRAG_ACTIVE recv|ole-smoke-arm|OLE smoke FE arm|OLE smoke host-direct arm' 'drag armed (list-drag-mode or FILE_DRAG recv)') -and $ok
$ok = (Test-Line 'FILE_DRAG_ACTIVE arm' 'host FILE_DRAG_ACTIVE arm') -and $ok
$ok = (Test-Line 'ESCALATE DoDragDrop' 'host ESCALATE DoDragDrop') -and $ok
$ok = (Test-Line 'payload kind=owned-hdrop' 'owned-hdrop payload') -and $ok
$ok = (Test-Line 'DoDragDrop end hr=DROP effect=(COPY|MOVE|COPY\|MOVE)' 'DoDragDrop DROP with COPY|MOVE') -and $ok

if ($RequireDropVerify) {
    $ok = (Test-Line 'drop-verify .* onDesktop=True' 'drop-verify onDesktop=True (P0 proof)') -and $ok
} else {
    if ($text -match 'drop-verify .* onDesktop=True') {
        Write-Host 'OK   drop-verify onDesktop=True (P0 proof)'
    } elseif ($text -match 'drop-verify ') {
        Write-Host 'WARN drop-verify present but onDesktop!=True'
        $ok = $false
    } else {
        Write-Host 'MISS drop-verify (run Downloads->Desktop test on current build)'
    }
}

Write-Host ""
if ($text -match 'DoDragDrop end hr=DROP effect=NONE') { Write-Host 'WARN: saw effect=NONE drop — target did not accept' }
if ($text -match 'drop-cancelled') { Write-Host 'WARN: saw drop-cancelled — drag aborted before commit' }
if ($text -match 'FILE_DRAG_ACTIVE reject=|file-uri-encoded|payload reject=') { Write-Host 'WARN: path sanitize rejected payload paths' }

Write-Host ""
if ($ok) {
    Write-Host 'RESULT: PASS (checklist satisfied in tail window)'
    exit 0
}
Write-Host 'RESULT: INCOMPLETE - perform Downloads->Desktop drag on latest build, then re-run.'
exit 2
