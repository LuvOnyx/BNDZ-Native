# Incus → BNDZ Mesh VPS (reference)

Upstream: [lxc/incus](https://github.com/lxc/incus) (Apache-2.0).

This tree is **API/UX reference** for create→wait→SSH patterns.

## Three separate Mesh surfaces (do not conflate)

1. **Hosts** — connect any purchased/remote SSH/SFTP VPS (e.g. BandzVPS). Browse, upload/download, Shell Here.
2. **Mesh Drop** — P2P WebRTC send/receive between BNDZ desktops. Not a VPS.
3. **Mesh VPS** — BNDZ creates **local temporary** Linux instances on this PC (Podman). Destroy when done.

Optional advanced: remote Incus HTTPS for lab compute — never required for Hosts or Mesh Drop.

## Patterns absorbed into BNDZ

| Incus (this tree) | BNDZ destination |
|-------------------|------------------|
| create→wait→start | `MeshLocalVpsFactory` (local) + `LaunchAsync` |
| ephemeral instances | Mesh VPS tab · temporary hosts |
| cloud-init / SSH inject | PUBLIC_KEY / Mesh SSH registration |
| remotes + instances UX | Local factory card + Create one-push |

## Non-goals

- Do not require a purchased remote VPS just to press Create VPS
- Do not replace Remote Mesh Hosts with Mesh VPS
- Do not ship Go `incusd` as a Windows sidecar
- Ghost-Link stays local cold vault; unrelated to Mesh VPS
