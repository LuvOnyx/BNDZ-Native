## Learned User Preferences

- Do not use bandaid fixes; implement core-issue fixes and improvements—do not strip libraries (e.g. Three.js for 3D preview) or downgrade capabilities to paper over bugs.
- Expect top-tier UI and backend; nothing basic, half-assed, or placeholder when full features were requested; generic React/SaaS-looking cards are not allowed for workspace tools (Automation / Spatial); Automation inspector/sidebar on single-click select, not double-click.
- Only commit git changes when explicitly asked; do not run `git revert` without permission—restore uncommitted work via manual file edits.
- Spacedrive/Spacebot work must extract actual repo files and wire user-visible features into BNDZ FM surfaces—not sidecar plumbing, iframe embeds, vendor dumps, or engine admin UI; packaging/build milestones are not integration done.
- Native-integrate host features end-to-end (especially RAM Staging via ImDisk / Arsenal Image Mounter)—no install/driver download prompts, sidebar install UX, leftover “AIM drivers / ImDisk ready” chrome, or requiring users to fetch drivers/API keys separately.
- Follow clear user direction and attached plans without reframing, stopping early, or substituting a narrower scope; keep implementing until work is actually correct, then continue upgrading; user tests only after all planned phases are completely done.
- Selling-point work must be unique category-defining features people cannot get in other file managers—not competitor parity, not music-niche-only because the user works in music; each selling to-do needs 3 distinct implementation paths (parity upgrades go in `to-do-future-upgrades.md`).
- When restoring missing features, use specified backup builds (e.g. BNDZ 3.2 for settings menu, BNDZ 3.6 for plugin marketplace).
- Preserve listview interaction (drag, virtualized marquee, Ctrl+marquee, empty-space deselect); multi-item drag must use one animated fan/span stack without a second single-item ghost covering it; keep desktop→BNDZ external drop working; optimistic move/delete/rename must update the list immediately without flicker-back-then-refresh.
- When editing menubar/dropdowns, keep original structure and icons; add options without removing or reorganizing existing items unless asked.
- Keep classic outer-column workspace layout (sidebar 17% / workspace 71% / preview 12%); do not move/shrink the bottom plugin panel or add pill chrome above it unprompted; do not change views bar spacing or per-view icon/slider sizing unprompted; Smart Views must not auto-pick view modes—the views bar is authoritative.
- Always apply `.cursor/rules/bndz-implementation-rule.mdc` and `.cursor/rules/bndz-uiverse-ui.mdc` (fresh `npm` + Debug `dotnet` builds; Uiverse craft for all UI including Automation/Spatial cards).

## Learned Workspace Facts

- BNDZ is a next-gen Windows file manager: C# backend (BNDZBackend) + WebView2/React frontend (src/), competing with File Pilot and XYplorer—must feel like a native Explorer replacement, not a web app.
- Spacedrive/Spacebot upstream repos at `external/spacedrive` and `external/spacebot` are **UX/reference only** — copy UI patterns into BNDZ components; wire to native C# services (`BndzFileIndexService`, `AiAssistantService`, `DuplicateFinderService`), never `src/engines/` HTTP bridges or sidecar admin UI.
- File index / icon / size cache: `BNDZBackend/Services/BndzFileIndexService.cs` (SQLite under `%LocalAppData%/BNDZ/Index/`) plus native icon/thumbnail caching—icons and sizes must not re-fetch on every revisit.
- List interaction logic primarily in `src/components/BNDZUI.tsx` and `src/lib/dragController.ts`; multi-item fan/span drag UI lives under `src/workstation/drag/` (e.g. `FluidDragStack`); details view must not shift layout vs other views.
- Frontend IPC bridge at `src/lib/ipcBridge.ts`.
- META upgrades: deepen NuGet-backed host services into list/preview/search/metadata surfaces; see `.cursor/rules/bndz-implementation-rule.mdc`.
- Default outer workspace layout in `src/lib/workspaceLayout.ts`: sidebar 17%, workspace 71%, preview 12% (v38 / commit d216b26); classic outer-column preview, not overlay model; breadcrumb bar (`src/components/BreadcrumbTrail.tsx`) keeps path visible via flex/min-width—avoid premature ellipsis when the views bar has room.
- RAM Staging is a native host feature (ImDisk / Arsenal Image Mounter wired into BNDZBackend)—not a separate installer wizard or left-sidebar install prompt; staged-area ops (e.g. rename) must work as a real drive.
- Workspace tools Automation and Spatial Canvas are primary selling surfaces and must be feature-complete, distinctive, and performant—not thin single-purpose canvases or laggy card drag.
- Preview stack keeps Three.js for 3D model viewing; Loupe/Luma must not shrink viewed content to a tiny irrecoverable scale or throw the image on pan.
- Audio/music tooling (BPM/key detection, modern waveform editor in preview) is an intentional product focus for audio engineers and producers—not the sole selling-pillar theme.
- Agent work queue: mandatory stabilization in `to-do.md` (Phases 1-8); **category-defining** selling pillars in `to-do-selling-points.md` (compose RAM+Ghost+Spatial+Rack+Producer — not competitor parity; each pillar with 3 implementation paths); parity backlog in `to-do-future-upgrades.md`.
