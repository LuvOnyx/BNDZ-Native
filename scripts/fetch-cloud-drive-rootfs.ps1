# Pin the Ubuntu 24.04 rootfs used by This PC Cloud Drives.
# Run from an elevated PowerShell on the Windows PC that will boot the guest.
# Docker is not used.
$ErrorActionPreference = 'Stop'

$ImageUrl = 'https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64-azure.vhd.tar.gz'
$ImageSha256 = '3543723afd820d7a8a64ea7399376856a95ce15200439c38447170652a60a5f3'
$FileName = 'ubuntu-24.04-server-cloudimg-amd64.vhdx'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Error "Run scripts/fetch-cloud-drive-rootfs.ps1 from an elevated PowerShell. Convert-VHD and the rootfs patch need administrator. Docker is not used."
  exit 1
}

$root = Join-Path $env:LOCALAPPDATA 'BNDZ\CloudDrives\rootfs'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$dest = Join-Path $root $FileName
if (Test-Path -LiteralPath $dest) {
  Write-Output "ALREADY_PRESENT $dest"
  Write-Output "Start in BNDZ uses this file. The sealed VHDX is only the data disk and is not recreated."
  exit 0
}

if (-not (Get-Command Convert-VHD -ErrorAction SilentlyContinue)) {
  Write-Error "Convert-VHD is not available. Turn on Hyper-V, open an elevated PowerShell, and run this script again. Docker is not used."
  exit 1
}

$tgz = Join-Path $root 'ubuntu-24.04-server-cloudimg-amd64-azure.vhd.tar.gz'
$work = Join-Path $root 'extract'
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null

Write-Output "DOWNLOAD $ImageUrl"
Invoke-WebRequest -Uri $ImageUrl -OutFile $tgz -UseBasicParsing
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $tgz).Hash.ToLowerInvariant()
if ($hash -ne $ImageSha256) {
  Remove-Item -LiteralPath $tgz -Force
  Write-Error "SHA256 mismatch. Expected $ImageSha256 got $hash. The Ubuntu release pointer moved. Refusing to pin this file."
  exit 1
}

Write-Output "SHA256_OK"
tar -xzf $tgz -C $work
$vhd = Get-ChildItem -LiteralPath $work -Filter '*.vhd' -Recurse | Select-Object -First 1
if (-not $vhd) {
  Write-Error "The tarball did not contain a .vhd. Left the download at $tgz. Docker is not used."
  exit 1
}

$partial = Join-Path $root ($FileName + '.partial')
if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
Write-Output "CONVERT_VHD $($vhd.FullName)"
Convert-VHD -Path $vhd.FullName -DestinationPath $partial -VHDType Dynamic

$patch = @'
set -eu
part=$(lsblk -rno NAME,FSTYPE | awk '$2=="ext4"{print $1; exit}')
if [ -z "${part:-}" ]; then
  echo NO_EXT4
  exit 2
fi
mkdir -p /mnt/bndz-rootfs
mount "/dev/$part" /mnt/bndz-rootfs
mkdir -p /mnt/bndz-rootfs/etc/cloud/cloud.cfg.d
cat > /mnt/bndz-rootfs/etc/cloud/cloud.cfg.d/99-bndz-nocloud.cfg <<'EOF'
datasource_list: [ NoCloud, None ]
EOF
umount /mnt/bndz-rootfs
echo PATCHED
'@
$patchPath = Join-Path $root 'patch-nocloud.sh'
[System.IO.File]::WriteAllText($patchPath, $patch.Replace("`r`n", "`n"))
$drive = $patchPath.Substring(0, 1).ToLowerInvariant()
$rest = $patchPath.Substring(2) -replace '\\', '/'
$wslPath = "/mnt/$drive$rest"

$patched = $false
try {
  wsl --mount --vhd $partial --bare
  & wsl -u root -- bash $wslPath
  if ($LASTEXITCODE -eq 0) { $patched = $true }
}
finally {
  wsl --unmount $partial 2>$null | Out-Null
}

if (-not $patched) {
  Write-Error @"
The VHDX was converted but not pinned. The Ubuntu Azure image ignores a cidata seed until it has /etc/cloud/cloud.cfg.d/99-bndz-nocloud.cfg with: datasource_list: [ NoCloud, None ]
Converted file (not pinned): $partial
Install a WSL distro (wsl --install), then run this script again from an elevated PowerShell. Docker is not used.
"@
  exit 1
}

Move-Item -LiteralPath $partial -Destination $dest
Write-Output "PINNED $dest"
Write-Output "Next: start BNDZ elevated, create a This PC Cloud Drive on D: or another letter, then Start. First boot can take several minutes. The sealed disk.vhdx is only the data disk and is not recreated."
