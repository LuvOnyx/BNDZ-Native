# BNDZ License API (Cloudflare Workers + D1)

Online activation service: **one machine seat per serial**. Deactivate frees the seat.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/v1/activate` | — | Bind serial → HWID, return signed token |
| POST | `/v1/deactivate` | — | Free seat for this HWID |
| POST | `/v1/validate` | — | Check token still valid / not revoked |
| POST | `/v1/admin/issue` | Bearer admin | Mint serial (HMAC) |
| POST | `/v1/admin/revoke` | Bearer admin | Revoke serial |
| GET | `/health` | — | Liveness |

## Deploy

```powershell
# From repo root (requires Cloudflare login once: npx wrangler login)
.\scripts\deploy-license-api.ps1
```

Or manually:

```bash
cd services/bndz-license-api
npm install --legacy-peer-deps
npx wrangler login
npx wrangler d1 create bndz-licenses
# Paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply bndz-licenses --remote
npx wrangler secret put LICENSE_HMAC_SECRET   # same as BNDZ_LICENSE_SECRET
npx wrangler secret put TOKEN_HMAC_SECRET     # same as BNDZ_TOKEN_HMAC_SECRET
npx wrangler secret put ADMIN_API_KEY
npx wrangler deploy
```

Secrets are written to `.deploy-secrets.local.json` (gitignored) by the deploy script.

**Live:** https://bndz-license-api.mikeyrespondi.workers.dev — wired into `LicenseService.DefaultLicenseApiBase`.

## Admin

```powershell
$secrets = Get-Content .\services\bndz-license-api\.deploy-secrets.local.json | ConvertFrom-Json
$env:LICENSE_API_URL = $secrets.LICENSE_API_URL
$env:ADMIN_API_KEY = $secrets.BNDZ_LICENSE_ADMIN_KEY
cd services\bndz-license-api
npm run issue -- "customer note"
npm run revoke -- BNDZ-XXXX-XXXX-XXXX
```

For Release builds, also set:

```powershell
$env:BNDZ_LICENSE_SECRET = $secrets.BNDZ_LICENSE_SECRET
$env:BNDZ_TOKEN_HMAC_SECRET = $secrets.BNDZ_TOKEN_HMAC_SECRET
```

## Client secrets

Release builds embed:

- `BNDZ_LICENSE_SECRET` — serial HMAC (must match Worker `LICENSE_HMAC_SECRET`)
- `BNDZ_TOKEN_HMAC_SECRET` — offline JWT verify (must match Worker `TOKEN_HMAC_SECRET`)
