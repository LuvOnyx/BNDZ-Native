# How to make a BNDZ license key (super simple)

This is for **you** (Mikey), when you need another key for yourself, a friend, or a support case.

Think of it like this:
- The **app** has a secret stamp baked in.
- A **license key** is a ticket stamped with that same stamp.
- If the stamp matches, the app unlocks.

You do **not** need to rebuild the installer just to make a new key.

---

## Fastest way (recommended)

1. Open **PowerShell** on BandzPC.
2. Go to the project:

```powershell
cd C:\Users\mikey\Projects\BNDZ-Native
```

3. Load your secret stamp (already saved on this PC — do not share this file):

```powershell
$s = Get-Content .\services\bndz-license-api\.deploy-secrets.local.json | ConvertFrom-Json
$env:BNDZ_LICENSE_ADMIN_KEY = $s.BNDZ_LICENSE_ADMIN_KEY
$api = $s.LICENSE_API_URL
```

4. Ask the key server for 1 new key:

```powershell
$body = @{ count = 1; note = "for-whoever-this-is" } | ConvertTo-Json
$r = Invoke-RestMethod -Uri "$api/v1/admin/issue" -Method POST -Headers @{
  Authorization = "Bearer $env:BNDZ_LICENSE_ADMIN_KEY"
  "Content-Type" = "application/json"
} -Body $body
$r.serials
```

5. Copy the key it prints (looks like `BNDZ-XXXX-XXXX-XXXX`).
6. Give that person:
   - the key
   - the installer: https://bndz.org/downloads/BNDZ-Native-Setup-1.0.0.exe

Want more than one key? Change `count = 1` to `count = 5`.

---

## Other way (offline script)

This makes a key on your PC with the same stamp:

```powershell
cd C:\Users\mikey\Projects\BNDZ-Native
$s = Get-Content .\services\bndz-license-api\.deploy-secrets.local.json | ConvertFrom-Json
$env:BNDZ_LICENSE_SECRET = $s.BNDZ_LICENSE_SECRET
.\scripts\generate-license.ps1 -Count 1
```

The **server way** (first section) is better because it also writes the key into the online database.

---

## Where important stuff lives

| What | Where |
|------|--------|
| Secret stamp file (PRIVATE) | `services\bndz-license-api\.deploy-secrets.local.json` |
| Your personal keys notepad | `Documents\BNDZ-private-licenses.txt` |
| Official installer | https://bndz.org/downloads/BNDZ-Native-Setup-1.0.0.exe |
| Make keys script | `scripts\generate-license.ps1` |
| Key server | https://bndz-license-api.mikeyrespondi.workers.dev |

**Never** put the stamp file or admin key in Discord, GitHub, or chat.

---

## How customers get keys (normal)

1. They pay on https://bndz.org/file-manager
2. Stripe tells our site “paid”
3. The site asks the key server for a key
4. The key shows on their page (email too, once mail is set up)

You only need the steps above for **manual** keys.

---

## If something breaks

- “Unauthorized” → admin key missing or wrong. Re-check the `.deploy-secrets.local.json` file.
- Key doesn’t unlock the app → wrong stamp (old installer vs new stamp). Use the **Release** installer from the downloads link above.
- Need to cancel a bad key → tell me (or use the revoke admin API later).

That’s it. Stamp stays secret. Keys can be made anytime.