# FileSSH → BNDZ Remote Mesh (reference only)

Upstream: [JayanAXHF/filessh](https://github.com/JayanAXHF/filessh) (MIT / Unlicense).

This tree is **UX and algorithm reference** for upgrading BNDZ Remote Mesh. It is **not** built, shipped, or run as a sidecar.

## Patterns absorbed into BNDZ

| FileSSH | BNDZ destination |
|---------|------------------|
| `src/par_dir_traversal/` work-stealing parallel SFTP walk | `BNDZBackend/Services/Mesh/MeshParallelWalker.cs` |
| In-place edit via hydrate + editor + write-back | Mesh hydrate cache + `MESH_WRITE` IPC |
| Recursive download with progress gauge | `MeshTransferService` + transfer queue HUD |
| Shell open at browsed remote cwd (`Ctrl+o`) | Mesh Terminal “Shell Here” + remote cwd |
| OpenSSH certificate + passphrase key load | `SshSftpMeshProvider` auth + host editor fields |
| Rename / delete / mkdir / new file | List-native mesh CRUD via `IMeshProvider` |
| Metadata table (mode, uid, gid, size) | Enriched `MeshDirEntry` → list/preview attrs |
| Keybindings → actions | Context menu + Command Deck (`pluginId: remote-mesh`) |

## Non-goals

- No Rust/cargo product build
- No iframe / TUI embed
- No new marketplace plugin id `filessh`
- Ghost-Link remains a separate local cold-storage plugin
