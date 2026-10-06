# Phase 1 map — old P2P / share path (before LAN Share rebuild)

## Mesh Drop (`BNDZBackend/Services/MeshDrop/*`, `src/components/meshdrop/*`)
- WebRTC data-channel file push between two BNDZ desktops (SDP Mesh Code / deep link / optional relay).
- `MeshDropLanBeacon` is **offer-only**: HttpListener serves JSON `{sessionId,meshCode,label}` + UDP beacon. Not a folder browser/player.
- QR encodes `bndz://` deep link — useless for a normal phone browser without a hosted receiver.
- Context menu entry `Mesh Drop...` is optional stock and **off by default** (`DEFAULT_ENABLED_STOCK_CONTEXT_IDS` = photo-studio only).
- Quick Action only appears when `remote-mesh` plugin is installed.

## Live Share (`LiveShareCursorService`)
- Local JSON peer cursor/selection for mesh collaborators browsing the same folder path.
- Not a network file share.

## Modern Share (`ModernShareHelper`)
- Windows Share charm / nearby-share style OS UI. Not LAN folder HTTP.

## Temp cloud
- No dedicated TempCloud share server found in tree for this slice (hypothesis: unfinished / absent).

## Rebuild target
Replace the weak “phone share” expectation with **BNDZ LAN Share**: native read-only HTTP folder share with URL + QR + stop, owned by BNDZ host.
