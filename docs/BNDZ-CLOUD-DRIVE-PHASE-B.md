# BNDZ Phase B — Cloud Drive (product + engineering plan)

**Audience:** Mikey + parent agent (plain rewrite OK).  
**Scope:** Locked product path for Phase B. **No BNDZ code changes in this turn.**  
**Date:** 2026-10-07 (America/Chicago).  
**Related (superseded as primary path):** `BNDZ-COPYPARTY-HELPER-PLAN.md` — thin local helper stays optional/LAN-adjacent, not Phase B primary.

---

## Plain-language summary (for Mikey)

**Phase B = a real private drive you control from BNDZ — a tiny isolated machine with its own disk.**

- BNDZ-Native (the Windows file manager) is the **remote control**.
- Each Cloud Drive is a **small isolated Linux box** (microVM / sealed sandbox) with a **persistent disk**.
- **Where the disk lives (buyer chooses at Create):**
  1. **Cloud elsewhere** — Fly / partner / buyer’s own cloud account (primary Phase B story).
  2. **Separate local drive** — e.g. `D:`, USB, NAS-mounted letter — sealed sandbox rooted on that disk, still SSH + same UX. Not “share a random folder”; a real isolated drive image on the disk they pick.
- You **SSH in**, browse in BNDZ over **SFTP/WebDAV**, start/stop/snapshot/delete from the app.
- **You are not the landlord for everyone’s cloud files.** Cloud models: (1) partner/reseller capacity, or (2) buyer BYO cloud token. One fat AWS account holding every customer’s disks is **non-default / avoid**. Local placement keeps bytes on the buyer’s chosen disk.
- Phase B is **not**: thin copyparty helper, FileBrowser Quantum portable exe as the product, Docker-required OpenCloud on the buyer PC, or “Mikey hosts all tenants.”

**MVP cloud provider:** **Fly Machines** (slice B1). **Local placement** is first-class in parallel (B1b): sealed disk image on a user-picked drive letter.

---

## 1. Locked product decisions

| Decision | Lock |
|---|---|
| Primary Phase B path | Remote microVM + persistent volume (“Cloud Drive”) |
| BNDZ role | Remote control UI + browse/share against the VM |
| Where the VM/disk lives | **Cloud elsewhere** (provider / partner / BYO) **or** **separate local drive** (buyer-picked letter/path) |
| Hosting default | Partner/reseller **or** BYO cloud — **not** “Mikey hosts all tenants” |
| Isolation | One drive ≈ one tenant sandbox (no shared multi-tenant FS) |
| Movable | Cloud: snapshot/restore/export. Local: export/copy sealed disk image to another path/machine |
| BNDZ-Native | Paid Windows FM (React + WinUI) at `C:\Users\mikey\Projects\BNDZ-Native` |
| Non-goals (see §9) | Mandatory Docker on buyer PC; thin local helper as primary; DIY landlord for all disks |

---

## 2. Architecture — control plane vs data plane

```
[BNDZ-Native on BandzPC]
        |  HTTPS (user session / device auth)
        v
[BNDZ Cloud API]  ← thin control plane (or provider SDK direct in early B1)
        |  provider API token (partner account OR buyer BYO token)
        v
[Provider]  creates Machine/VM + attaches Volume
        |
        v
[microVM elsewhere]  ← DATA PLANE (files never route through BandzPC by default)
   - SSH/SFTP
   - optional WebDAV / tiny web FM
   - one data mount (/data)
```

**Split rules**

1. **Control plane** (BNDZ Cloud API or in-app provider SDK): create, start, stop, destroy, snapshot, rotate SSH keys, usage meter, map drive → provider resource IDs. Holds *metadata* and *encrypted secrets* (tokens, private keys) — never plaintext in client logs.
2. **Data plane** (the VM + volume): file bytes stay on the provider volume. BNDZ browses via **direct SFTP/WebDAV to the VM** (or a short-lived relay only if a firewall forces it — not the default).
3. **BNDZ is not a file proxy** for normal browse/upload. That keeps Mikey’s infra off the hot path and matches “VM lives elsewhere.”

**Early B1 shortcut:** BNDZ → Fly Machines API **direct** with buyer BYO Fly token is acceptable to ship create/start/stop/SSH without standing up a full Cloud API. Introduce BNDZ Cloud API when partner billing, multi-provider, or secret custody needs a server.

---

## 3. Hosting models (both supported)

### A. Partner / reseller hosted (**recommended default for “buy Cloud Drive in BNDZ”**)

- BNDZ sells capacity SKUs (e.g. 20 GB / 100 GB / 500 GB).
- An infra partner (or Fly org under partner billing) holds the Machines + volumes.
- Buyer never pastes a cloud token; they pay BNDZ (or partner via BNDZ).
- **Mikey is not DIY landlord** — ops, abuse, and disk capacity sit with the partner contract.
- Needs: partner MSA, usage metering (B4), support runbook, abuse/kill switch.

### B. Bring-your-own cloud (**recommended default for Phase B1 launch**)

- Buyer creates a Fly (or later Hetzner/AWS) account, pastes an **API token** into BNDZ.
- Their account, their invoice, their files.
- Fastest path to “real drive” without Mikey holding anyone’s data.
- BNDZ stores the token encrypted at rest (OS keystore / Cloud API vault); never logs it.

### C. Explicitly **non-default / avoid**

- “Mikey runs one fat AWS (or Fly) account; all customers’ volumes live there.”
- Why avoid: liability, abuse, support load, billing complexity, single-tenant blast radius, and it contradicts the locked preference.

| Model | Who pays cloud | Who holds disks | Launch readiness |
|---|---|---|---|
| Partner/reseller | Customer → BNDZ/partner | Partner | Needs B4 billing + contract |
| BYO token | Customer → provider | Customer’s cloud | **Best for B1** |
| Mikey fat account | Customer → Mikey → provider | Mikey | **Avoid as default** |

---


## 3b. Placement modes (Create wizard)

At **Create Cloud Drive**, BNDZ asks **where this drive lives**:

| Placement | What it is | Who holds bytes | SSH | Move |
|---|---|---|---|---|
| **Cloud (BYO / partner)** | MicroVM + volume on Fly (MVP) or partner | Buyer cloud or partner | Yes (public host) | Snapshot / restore / export |
| **This PC — separate drive** | **Same microVM-class isolation** (Hyper-V / WSL2 VM layer); **disk image on a drive the user picks** (`D:`, USB, etc.) | Buyer’s chosen local disk | Yes — localhost + **remote** (SSH/FTP/SFTP/… via port forward / tunnel) | Copy/export the sealed image to another path/PC |

**Local placement rules**

1. Same remote-control UX as cloud (Create / Start / Stop / Copy SSH / Browse / Delete).
2. User picks a **root path on another volume** (not forced onto system `C:`). BNDZ stores the sandbox disk image there (e.g. `D:\BNDZ\CloudDrives\<id>\disk.vhdx` or equivalent).
3. Isolation = **real microVM** (Hyper-V preferred; WSL2 VM layer acceptable) with VHD/VHDX on the picked path — **not** a thin helper exe sharing the host filesystem as primary. Local and cloud are the same product shape.
4. Optional: also allow “use free space on this external disk” as the only capacity meter for local.
5. Local does **not** require Docker. WSL2/Hyper-V availability is detected; clear install guidance if missing.
6. Cloud remains the flagship “files not on this PC” story; local is for people who want the same product shape on iron they already own.

## 4. MVP provider pick (after quick fitness check)

### Comparison (persistent disk + SSH + API + cost + Windows-app fit)

| Provider | SSH | Persistent disk | Create/destroy API | Snapshots / move | ~Cost small drive | Fit for Phase B |
|---|---|---|---|---|---|---|
| **Fly Machines** | Yes (`fly ssh` / Machine SSH) | Fly Volumes (~$0.15/GB-mo) | Machines API | Volume snapshots (~$0.08/GB-mo; 10 GB free/mo) | ~$2–7 compute + volume | **MVP pick** |
| Hetzner Cloud | Native SSH | Volumes (min ~10 GB; very cheap €/GB) | Excellent REST | Snapshots/images | Often cheapest VPS (~€ few/mo) | Strong BYO / partner alt |
| AWS Lightsail / EC2 | Native SSH | Bundle SSD / EBS | Yes (IAM heavier) | Snapshots | Lightsail from ~$3.50/mo | Viable later; BYO friction |
| Cloudflare Containers | Wrangler-only SSH (not public SFTP-friendly) | Ephemeral by default; DO snapshots beta/immutable | Workers/DO APIs | Snapshot restore model | Usage-based | **Fail** for always-on SFTP drive |
| Lambda MicroVMs | Shell connector, not classic SFTP host | Session/suspend state; not classic durable volume product | Lambda MicroVM APIs | Suspend/resume oriented | Session-priced | **Fail** for durable cloud drive MVP |

### Recommendation: **Fly Machines** for Phase B slice 1

**Why**

1. Matches the **Cursor-style isolated microVM** story better than a bare VPS brand.
2. **SSH + persistent volume + snapshot** in one product surface.
3. Clean **Machines API** for create / start / stop / destroy from a Windows app.
4. **BYO org token** is simple (one secret) vs AWS IAM sprawl.
5. Ballpark MVP SKU: `shared-cpu-1x` 512MB–1GB + 20–50 GB volume ≈ **~$5–12/mo** always-on (iad/ewr-class regions), stoppable to cut compute.
6. Volume snapshots give a credible **move story** without inventing backup plumbing on day one.

**Fallback:** Hetzner Cloud if Fly token/org limits, EU price pressure, or partner prefers classic VPS. Keep provider interface pluggable from B0.

---

## 5. What BNDZ UI owns

Cloud Drive panel / wizard actions:

| Action | Behavior |
|---|---|
| **Create** | Placement (Cloud vs This PC / drive letter) → size/name → provision Machine+Volume **or** local sealed disk + inject SSH key + bootstrap |
| **Start / Stop** | Provider start/stop; show state + last seen |
| **Open web** | Open optional lightweight web FM / WebDAV URL (if enabled on image) |
| **Copy SSH** | `ssh -i … user@host` one-liner + host fingerprint |
| **Rotate keys** | Generate new keypair, push pubkey, revoke old; private key never leaves secure store unencrypted |
| **Snapshot** | Provider volume snapshot; name + timestamp |
| **Delete** | Confirm → destroy Machine + volume (and optional snapshot retain toggle) |
| **Usage meter** | Disk used/provisioned, approximate $ (BYO: link to provider; partner: BNDZ meter) |
| **Browse in BNDZ** | Mount-like pane via **SFTP** (primary) or **WebDAV** against the VM |
| **Share** (B2) | QR / link for read-only or timed share **from the drive** (not BandzPC LAN) |

UI copy should say: *“Your files live on a private cloud machine. BNDZ only remote-controls it.”*

---


## 5b. BNDZ UI + web control panel (after protocols)

**Order Mikey locked:** microVM (cloud + local) → protocols (SSH/FTP/SFTP/…) for away access → **then** plan/ship UI → **nice web control panel** reachable from away (share links, etc.).

### BNDZ-Native UI (remote control)
- Drive list with placement badge (Cloud / This PC)
- Create wizard: placement → disk location or cloud size/region → credentials
- Start / Stop / Delete / Copy connection strings (SSH, SFTP, FTP, panel URL)
- In-app browse against the drive
- Away-access helper for local drives (ports / tunnel status)

### Web control panel (on the microVM, from away)
- Login (per-drive credentials)
- File manager (upload/download/mkdir/rename/delete)
- **Create share links** (timed, read-only / read-write, password optional)
- Protocol status (SSH/FTP/SFTP/WebDAV on/off, ports)
- Basic drive health (disk used, uptime)
- Works in a phone/desktop browser without BNDZ installed

### Share links
- Mint from panel or from BNDZ UI; served by the drive itself
- Revoke / expiry / view count where cheap to add
- QR for phone grab


## 5c. Cloudflare for away access (locked)

**Yes — include Cloudflare, but as the away-access layer, not the microVM host.**

| Use | Role |
|---|---|
| **Cloudflare Tunnel** (`cloudflared`) | Publish SSH/SFTP/web panel/FTP safely from a **local** microVM without raw port-forwarding |
| **Cloudflare Access** (optional) | Extra login gate in front of the web control panel |
| **Not** Cloudflare Containers / Workers as the drive VM | Wrong fit for always-on SFTP + durable disk (see §4) |

Flow: microVM stays Hyper-V/WSL2 (local) or Fly (cloud) → `cloudflared` tunnel → `https://drive-….bndz…` or buyer’s domain → panel + share links. Cloud Fly drives may still use Tunnel or native Fly HTTPS for the panel.

Buyer needs a Cloudflare account (free tier OK for Tunnel) **or** BNDZ-managed tunnels later under partner model.

## 6. What runs inside the VM (minimal image)

**Ship a small, pinned Linux image** (not full Nextcloud unless a later phase).

Minimum (both cloud and local microVM images):

- **SSH** (shell + file) and **SFTP**
- **FTP / FTPS**
- **WebDAV** (+ HTTPS)
- One data mount: `/data` on the persistent volume / local VHD
- **Web control panel** (see §5b) — reachable from away, not only from BNDZ
- Firewall: allow the published protocol ports; deny everything else inbound
- Non-root `bndz` user owning `/data`
- Health: sshd + `/data` mounted + panel up → ready signal for BNDZ
- Bootstrap via cloud-init / Machine start; local Hyper-V/WSL2 equivalent; no Docker-on-buyer-PC dependency
- **Away access (local placement):** BNDZ helps publish safely (UPnP/manual port map and/or optional tunnel) so SSH/FTP/SFTP/panel work off-LAN without turning the PC into an open honeypot

**Phase order after core VM:** protocols → **BNDZ UI** → **web control panel + share links**.

**Explicitly out of MVP image:** full Nextcloud suite, full desktop GUI, SMB as day-one hard requirement (port 445 pain — revisit later), buyer-custom apt sprawl.

---

## 7. Move story

**Cloud**
1. **Snapshot volume** on provider (Fly volume snapshot).
2. **Restore** onto a new Machine in same or (when supported) new region — or attach restored volume to replacement Machine.
3. **Export backup archive:** from BNDZ, SFTP/`tar` of `/data` to local or object storage (buyer-owned). Required when leaving a provider.

**Local (separate drive)**
1. **Stop** the sandbox.
2. **Copy/export** the sealed disk image folder (VHDX + metadata) to another path, USB, or PC.
3. **Open existing** / Start on the new location — same files, rebind SSH host key if needed.

4. Document RPO/RTO honestly: snapshot = crash-consistent disk; export = portable escape hatch.
5. Metadata (drive id, placement, key fingerprints) stays in BNDZ local encrypted store / Cloud API so the remote control can rebind after move.

---

## 8. Security

- **Per-drive SSH keypair** (ed25519). Never reuse one key across drives or users.
- **No shared tenants** — one Machine + volume per Cloud Drive SKU instance.
- **Secrets:** provider tokens + private keys in OS secure store (BYO local) or Cloud API vault (partner). **Never** in client logs, crash dumps, or analytics.
- **Egress notes:** VM can reach the internet for updates unless buyer chooses lock-down; document that file content egress is the buyer’s risk/bill (Fly egress ~$0.02/GB NA/EU).
- **Fingerprint verify** on first SSH/SFTP connect in BNDZ; pin TOFU.
- **Rotate keys** flow must prove old key dead before marking success.
- **Delete** must be destructive and confirmed (type drive name).
- Abuse (partner model): rate limits, disk caps, kill switch via control plane.

---

## 9. Non-goals

- Mandatory **Docker Desktop** (or any container engine) on the buyer PC for Cloud Drive.
- **Thin local helper** (copyparty / Quantum portable) as the **primary** Phase B cloud path.
- **Mikey hosting all tenants’ disks** without a partner (fat single account).
- Treating **WSL alone** as the whole product with no Create → placement chooser (local is a **placement**, implemented with the cleanest Windows isolation that can root the disk on a chosen drive — may use a private WSL2 distro whose `.vhdx` lives on that drive, or Hyper-V; not “just enable WSL and dump files”).
- Docker-required **OpenCloud** on the buyer machine as default.
- Full **Nextcloud** stack in MVP image.
- Making BandzPC the data plane for remote users’ files.

LAN Share / local Wi-Fi helpers may still exist for **local** sharing; they are not Phase B Cloud Drive.

---

## 10. Phases + acceptance criteria

### B0 — Design (this doc + confirmations)

**Accept when:**

- [ ] Mikey confirms MVP provider (Fly vs Hetzner) — see Open decisions.
- [ ] Provider abstraction sketch exists (create/start/stop/destroy/snapshot/SSH inject).
- [ ] Minimal image contents listed and pinned version strategy chosen.
- [ ] Threat notes: secrets, per-drive keys, no shared tenants.

### B1 — One drive on chosen provider (BYO token OK)

**Accept when:**

- [ ] User pastes Fly (or chosen) token → Create Drive → Machine + Volume exist.
- [ ] Start / Stop / Delete work from BNDZ UI.
- [ ] **Copy SSH** works; user can SFTP with the per-drive key.
- [ ] `/data` persists across stop/start.
- [ ] No provider token or private key appears in logs.
- [ ] Works from BNDZ-Native on Windows without Docker/WSL.

### B1b — Local placement on a separate drive

**Accept when:**

- [ ] Create → **This PC** → user picks a path on a non-system drive (e.g. `D:`) → sealed sandbox disk image is created **on that path**.
- [ ] Start / Stop / Delete work; **Copy SSH** reaches the local sandbox.
- [ ] `/data` (or equivalent) persists across stop/start and survives reboot.
- [ ] Stop → copy sealed folder to another path → Open/Start → same files.
- [ ] No Docker required; if WSL2/Hyper-V missing, BNDZ shows a clear fix path (not a silent fail).
- [ ] Same UI shell as cloud drives (placement badge: Local vs Cloud).


### B1c — Protocols for away access

**Accept when:**

- [ ] SSH, SFTP, FTP/FTPS work against a running drive (cloud and local).
- [ ] Local drive can be reached from another network with the documented away-access path (port map and/or tunnel) — not LAN-only.
- [ ] Credentials / keys managed from BNDZ; no default open anonymous FTP.

### B1d — BNDZ UI polish for Cloud Drive

**Accept when:**

- [ ] Create / list / start / stop / delete / copy endpoints feel Explorer-grade, not a debug panel.
- [ ] Placement chooser (Cloud vs This PC + drive letter) is obvious.
- [ ] Connection info for SSH/FTP/SFTP/panel is one tap to copy.

### B2 — Web control panel + share links (expands prior B2)

**Accept when:**

- [ ] Panel loads from away over HTTPS (or tunnel URL).
- [ ] Full basic FM in browser.
- [ ] Create / revoke share links with optional expiry + password.
- [ ] QR for a share link works on phone.
- [ ] In-app BNDZ browse still works (SFTP primary).

### B2 — Browse in BNDZ + share from drive

**Accept when:**

- [ ] In-app file browse/upload/download via SFTP (WebDAV optional).
- [ ] QR or link share for a folder/file **served from the VM** (timed token or read-only web path).
- [ ] Open web (if image includes web FM) launches correct URL.

### B3 — Snapshots / move

**Accept when:**

- [ ] Snapshot create/list/restore (or new Machine from snapshot) in UI.
- [ ] Export `/data` archive to local path documented + works once.
- [ ] Drive metadata rebinds after restore (SSH host may change; fingerprint update UX).

### B4 — Partner billing (if selling capacity)

**Accept when:**

- [ ] Partner account provisions drives without buyer cloud token.
- [ ] Usage meter + SKU caps enforced.
- [ ] Kill/suspend path for abuse/non-payment.
- [ ] Legal/ops: Mikey is not sole DIY landlord of disks.

---

## 11. Engineering sketch (no code this turn)

- **BNDZ-Native:** Cloud Drive wizard/list/actions (§5); `ICloudDriveProvider` → Fly adapter first (Hetzner stub later); SFTP pane with per-drive key; secrets in Credential Locker / DPAPI — never log tokens/keys.
- **BNDZ Cloud API (optional until partner/multi-provider):** auth, drive registry, secret custody, provider status poll; **does not** proxy file bytes by default.
- **Image:** CI-built minimal Linux, pinned digest; cloud-init for user, sshd harden, `/data` mount, optional WebDAV.
- **State machine:** `creating | running | stopped | error | deleting`; plain-English provider errors.

---

## 12. Rough cost anchors (UX copy, not a price list)

MVP always-on ~20 GB on Fly ≈ **$7–12/mo** (shared-cpu-1x 512MB ~$3.69 + volume ~$0.15/GB). Stopped = volume still bills, compute mostly off. Hetzner small CX-class is often cheaper € — good partner economics. BYO UX: show estimate + “billed by your cloud”; partner UX: SKU price.

---

## 13. Open decisions for Mikey (max 3)

1. **Confirm MVP cloud provider:** Fly Machines (recommended) vs Hetzner Cloud (cheaper classic VPS)?
2. **Launch posture:** Ship **B1 cloud BYO** first, **B1b local-on-separate-drive** in parallel, or local-first for the Windows demo?
3. **LAN Share:** Keep local Wi-Fi share **alongside** Cloud Drive (cloud + local sealed drive + LAN), or fold LAN into “local Cloud Drive” over time?

---

## 14. One-page mental model

> BNDZ is the remote for a **private mini-server with a disk**.  
> That disk lives in the **cloud** or on a **drive you pick on this PC** — same microVM either way.
> SSH/FTP/SFTP + a **web control panel** so they can use it from away, with share links.  
> Mikey does not become everyone’s hard drive.

---

*End of Phase B plan. No BNDZ code changes in this document turn.*
