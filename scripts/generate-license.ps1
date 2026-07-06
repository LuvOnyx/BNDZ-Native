# Generates BNDZ license serials (format: BNDZ-XXXX-XXXX-CCCC)
# Must use the same secret as LicenseService.cs before shipping.
#
# Usage:
#   .\scripts\generate-license.ps1
#   .\scripts\generate-license.ps1 -Count 5
#   .\scripts\generate-license.ps1 -Segment1 "PRO1" -Segment2 "A2B3"

param(
    [int]$Count = 1,
    [string]$Segment1 = "",
    [string]$Segment2 = "",
    [string]$Secret = $(if ($env:BNDZ_LICENSE_SECRET) { $env:BNDZ_LICENSE_SECRET } else { "BNDZ-36-Commercial-Key-Seed-CHANGE-ME" })
)

$ErrorActionPreference = "Stop"
$Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function Get-Checksum([string]$Payload, [string]$Key) {
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Key)
    $hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Payload))
    $hmac.Dispose()
    $sb = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt 4; $i++) {
        [void]$sb.Append($Alphabet[$hash[$i] % $Alphabet.Length])
    }
    return $sb.ToString()
}

function New-RandomSegment {
    -join ((1..4) | ForEach-Object { $Alphabet[(Get-Random -Maximum $Alphabet.Length)] })
}

Write-Host "BNDZ License Serial Generator" -ForegroundColor Cyan
if ($Secret -eq "BNDZ-36-Commercial-Key-Seed-CHANGE-ME") {
    Write-Host "WARNING: Set BNDZ_LICENSE_SECRET env var (must match retail build) before generating customer serials." -ForegroundColor Yellow
}

for ($n = 0; $n -lt $Count; $n++) {
    $s1 = if ($Segment1) { $Segment1.ToUpper() } else { New-RandomSegment }
    $s2 = if ($Segment2) { $Segment2.ToUpper() } else { New-RandomSegment }
    $payload = "$s1-$s2"
    $chk = Get-Checksum $payload $Secret
    $serial = "BNDZ-$payload-$chk"
    Write-Host $serial -ForegroundColor Green
}
