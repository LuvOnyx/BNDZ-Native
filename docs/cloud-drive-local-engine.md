# BNDZ Cloud: This PC engine

This PC drives need no Windows feature setup. BNDZ picks the first engine that is already available:

1. Hyper-V, when it is already on and BNDZ is elevated.
2. WSL2, when a hypervisor is already running.
3. Bundled QEMU with WHPX (Windows Hypervisor Platform), shown as "Running accelerated".
4. Bundled QEMU with TCG, shown as "Running in compatibility mode". Works on every x64 Windows PC, no admin.

"Turn on faster mode" is optional. It asks Windows (UAC) to enable HypervisorPlatform and
VirtualMachinePlatform, then needs a restart. It never enables or requires Hyper-V.

## Guest

Alpine Linux 3.24.1 generic cloud image (cloud-init, python3, OpenSSH, OpenRC). Per drive:

- `system.qcow2`: copy-on-write overlay on the shared pinned image.
- `data.qcow2`: data disk (sparse), ext4 labelled `BNDZDATA`. QEMU never writes vhdx: in the live test its
  vhdx driver lost ext4 metadata across a restart. Moving between engines is one offline `qemu-img convert`
  (`CloudDriveQemu.ConvertDataDisk`): qcow2 → vhdx for Hyper-V / `wsl --mount --vhd`, and an existing
  `disk.vhdx` is copied to qcow2 automatically the first time QEMU starts that drive (the vhdx is left untouched).
  The filesystem inside is the same, and the bootstrap formats a disk only when it has no filesystem at all.
- `seed.iso`: NoCloud seed with the panel files and an OpenRC service.
- Networking is QEMU user mode with `hostfwd` on 127.0.0.1 for the panel and SSH. No TAP, no vSwitch, no admin.

## First-use downloads (pinned, SHA256, resumable)

| File | Size | SHA256 |
|---|---|---|
| generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2 (dl-cdn.alpinelinux.org) | 175.2 MiB | 6e2e6fe0572b6632527f268d3659e8fccebda4e1ee470fafe2c4d7b85b6a4df6 |
| qemu-w64-setup-20260811.exe (qemu.weilnetz.de) | 197.0 MiB | f98a8aeb5f7faea9765b6dee28316c266cd179d80354a2fed8e50176f9a2e59f |
| 7zr.exe (7-zip.org) | 0.6 MiB | 256feca8e274e5da655e2a284fabafd9f554365eb164862089dacd4e8276d282 |
| 7z2301-x64.exe (7-zip.org) | 1.5 MiB | 26cb6e9f56333682122fafe79dbcdfd51e9f47cc7217dccd29ac6fc33b5598cd |

Everything lands in `<picked folder>\BNDZ\CloudDrives\.runtime`, on the drive the user picked, never on C: by default.
Only `qemu-system-x86_64.exe`, `qemu-img.exe`, their DLLs, a few firmware files and the license texts are
unpacked from the QEMU installer; the installer is deleted afterwards.

## Licensing

- QEMU: GPL v2 (parts LGPL). BNDZ starts it as a separate program and never links to it. BNDZ does not
  redistribute the binaries: the app downloads the upstream build from its publisher. `COPYING`,
  `COPYING.LIB` and `SOURCE.txt` (source location and written offer) are kept next to the unpacked files.
  Source: https://www.qemu.org/download/#source and https://qemu.weilnetz.de/w64/2026/.
- 7-Zip: LGPL (unRAR restriction does not apply; it is only used to unpack). `License.txt` kept in `.runtime\7z`.
- Alpine Linux: a collection of free software packages under their own licenses (mostly GPL/MIT/BSD); downloaded from Alpine's CDN.
