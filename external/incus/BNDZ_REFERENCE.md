# Incus → BNDZ Remote Mesh (reference only)

Upstream: [lxc/incus](https://github.com/lxc/incus) (Apache-2.0).

This tree is **UX/API reference ONLY** — never ship or run `incusd` as a sidecar.
BNDZ talks to a remote Incus HTTPS API and folds temporary hosts into **Remote Mesh**.

## Patterns absorbed into BNDZ

| Incus (this tree) | BNDZ destination |
|-------------------|------------------|
| `client/doc.go` create→wait→start flow | `IncusApiClient` + `MeshEphemeralService.LaunchAsync` |
| `shared/api/instance.go` `InstancesPost` / `Ephemeral` / `Start` | Launch request body |
| `cloud-init.user-data` / `user.user-data` | SSH pubkey inject on launch (`BuildSshCloudInit`) |
| `shared/api/instance_state.go` `Network` addresses | Discover IPv4/IPv6 → upsert Mesh SSH host |
| `shared/api/operation.go` + `/wait` | `IncusApiClient.WaitOperationAsync` |
| `shared/api/certificate.go` `trust_token` | Endpoint trust (DPAPI) + auto client cert |
| `doc/authentication.md` TLS client certs | `%LocalAppData%/BNDZ/Mesh/Incus/<id>/client.{crt,key}` |
| `/1.0/images/aliases` | Ephemeral launch pad datalist |
| Incus remotes + instances UX | Remote Mesh **Ephemeral** tab |

## Product wiring

- Plugin: existing `remote-mesh` only (no new marketplace id)
- Backend: `BNDZBackend/Services/Mesh/Incus/`
- IPC: `MESH_INCUS_*` in `BndzIpcHost` / `MainWindow`
- UI: `src/components/mesh/MeshEphemeralPanel.tsx`

## Non-goals

- No Go daemon / no embedding `incusd` on Windows
- No hypervisor reinvented locally — Incus remains the remote runtime
- No iframe / CLI embed of Incus web UI
- Ghost-Link stays local cold vault; unrelated to ephemeral VPS hosts
