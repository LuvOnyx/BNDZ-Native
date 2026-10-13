# BNDZ Cloud Drive router

Public hostname: `https://cloud.bndz.org`.

Each drive is a path, `https://cloud.bndz.org/<name>/`. Share links are `https://cloud.bndz.org/s/<token>`. The account page is `https://cloud.bndz.org/`.

One Cloudflare Tunnel cannot send each path to a different machine, because every connector on a tunnel is a replica of the same ingress. This Worker is the only public route. It reads the `bndz-cloud-routes` KV map and fetches the hidden origin `https://d-<name>.bndz.org`, which is a proxied CNAME to that drive's tunnel. The Worker sends `X-Bndz-Origin`. The guest panel rejects any other caller when `BNDZ_ORIGIN_SECRET` is set.

`bndz.org` and `www` (A `15.204.218.94`) are the live website and FiveM server. Nothing in this directory creates or deletes those records.

## What you run

The token is account-scoped. These scripts verify it with `GET /accounts/<id>/tokens/verify`.

```bash
export CLOUDFLARE_API_TOKEN=...   # do not paste this into chat
export CLOUDFLARE_ACCOUNT_ID=43aa82716ea9acc4c2e89fdd9843e182
cd cloud/router
./deploy.sh
./e2e.sh
```

`./deploy.sh` is idempotent. It creates only names that start with `bndz-cloud-`:

- KV namespace `bndz-cloud-routes`
- Worker `bndz-cloud-router`
- Custom domain `cloud.bndz.org` (certificate from Cloudflare)
- origin secret file `cloud/router/.origin-secret` (mode 600, not printed, not committed)

`./deploy.sh teardown` deletes that worker, that KV namespace, and a DNS record whose name is exactly `cloud.bndz.org`. It refuses `bndz.org`, `www`, and any record whose content is `15.204.218.94`.

`./e2e.sh` installs wrangler and cloudflared when they are missing, deploys if needed, then creates a throwaway tunnel `bndz-cloud-e2e-<rand>` and DNS `d-e2e-<rand>.bndz.org`. It runs the real guest panel plus cloudflared and checks path prefix, login, file list, a chunked upload larger than 100 MB, a Range download, `/s/<token>`, a rename 301, and a rejected direct visit to the origin. It prints list TTFB and total time, then deletes the throwaway tunnel, DNS, and KV keys.

Needs `node`, `npm`, `curl`, and `python3` (the guest panel). A box without python3 stops before it creates a tunnel. cloudflared also needs outbound port 7844 (QUIC/UDP or TCP) to the Cloudflare edge. If that port is blocked, e2e stops at "cloudflared edge connection" and still deletes its tunnel, DNS, and KV keys. Set `BNDZ_E2E_LOGDIR` to a directory to keep the cloudflared and panel logs.

Token scopes: Zone DNS Edit, Zone Read, Account Cloudflare Tunnel Edit, Workers Scripts Edit, Workers KV Storage Edit, and Workers Routes (custom domains) on account `43aa82716ea9acc4c2e89fdd9843e182`, zone `bndz.org` = `1ac81c686fa2d4e3f175cd90afed08cc`.

## After deploy

1. Open `cloud/router/.origin-secret` on the machine that ran deploy. Paste that value once into the Cloud Drive address section in BNDZ. It is stored with DPAPI and is not shown again. Start each drive again so the guest receives `BNDZ_ORIGIN_SECRET`.
2. Save the same Cloudflare API token in that address section. BNDZ then publishes each drive's tunnel and the `d-<name>` CNAME, and upserts `bndz-cloud-routes`. It does not upload this Worker. If the KV namespace is missing, the drive is still created and the card says to run `./deploy.sh`.

To keep an existing secret across deploys, leave `.origin-secret` in place or export `BNDZ_ORIGIN_SECRET` before `./deploy.sh`. The script does not rotate a valid file.

## What Fly still needs

No Fly token is in this repo or this environment. Cloud create stays a dry run until both of these exist on the Windows host:

1. A bring-your-own Fly org API token, pasted into the Cloud Drive panel. BNDZ stores it with DPAPI.
2. `BNDZ_CLOUD_DRIVE_IMAGE` set to an image reference or digest that the Fly org can pull. Until that variable is set, Fly may accept the token and no machine is created. The drive stays `stopped`.

This PC still needs Hyper-V or WSL2, plus the pinned rootfs from `scripts/fetch-cloud-drive-rootfs.ps1`, before a local drive listens. That is separate from this router.

## Local checks

```bash
cd cloud/router
npm install
npm test
```

`npm test` covers routing, the 404, rename 301, Range streaming, the origin header, share fan-out, static-only caching, open-proxy rejection, the DNS guard, and a Miniflare boot of the worker. It does not call Cloudflare.
