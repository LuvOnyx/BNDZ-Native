# Project notes — pinned / parked

## Plaque / empty-state / modal art (PINNED — user gathering)

**Status:** Pinned 2026-09-18. Stop grinding AI/Fluent swaps until user drops their PC asset set for review.

**Why parked:** Agent extract/generate passes were high effort for middling gains vs assets the user already has locally (better cutouts expected). Current wired keepers are interim Fluent Emoji 3D (MIT) PNGs with true alpha + CSS modal washes.

**When user is ready:**
1. Drop candidate PNGs (prefer true alpha cutouts) into something like `public/plaques/candidates/user-gather/` or share a folder for review.
2. Run QUALITY gate: gather → `idle-qc` / review board → no people → true alpha → readable at lg/sm → then wire `BndzPlaque` tones.
3. Map by tone / surface (do not reuse one subject for two jobs):

| Tone / surface | Job | Interim now | Wanted |
|----------------|-----|-------------|--------|
| `idle` | System Properties / generic empty | Fluent Information (blue i) | User pick |
| `panel` | Preview Inspector idle | Fluent Framed picture | User pick (≠ search) |
| `search` | Fast Search empty | Fluent Magnifier | User pick (≠ panel) |
| `folder` | Folder empty | Fluent Open folder | User pick |
| `question` | Help / conflict / ask | Fluent `?` tinted `#0078D4` | User pick (not deny/prohibited) |
| `warn` | Recycle Bin delete confirm | Wastebasket \| Warning (gap) | User pick; trash must stay readable |
| `error` | Permanent delete / destructive | Warning alone (no trash) | User pick |
| washes | Modal atmosphere | CSS radials only | Optional soft PNGs at low opacity |

**Do not:** bake solid black/white/checker plates into heroes; cover trash with the warning badge; use loupe for Preview; use prohibited for question.

**Refs / quarantine already in repo:** `public/plaques/QUALITY.md`, `ATTRIBUTION.md`, `candidates/fluent-emoji-3d/`, `candidates/superseded-ai-gen/`, `candidates/superseded-gravity-*`.

**Resume cue for agents:** “User plaque gather ready” / check `candidates/user-gather/` — then QUALITY → wire → builds. Until then, prioritize Launch Ready Windows-gated work and other FM polish, not more plaque regen.
