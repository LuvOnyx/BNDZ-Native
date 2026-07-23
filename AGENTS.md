## Learned User Preferences

- Do not use bandaid fixes; implement core-issue fixes and improvements.
- Expect top-tier UI and backend implementations; nothing less is acceptable.
- Only commit git changes when explicitly asked.
- User tests only after all planned phases are completely done, not mid-implementation.
- Spacedrive/Spacebot work must extract actual repo files and wire user-visible features into BNDZ FM surfaces (search, preview, Smart Tools, list panes)—not sidecar plumbing, iframe embeds, vendor dumps, or engine admin UI.
- Do not label packaging or build milestones (cargo build, binary staging, daemon start) as integration done.
- Answer direct questions without reframing or changing the plan unprompted.
- When restoring missing features, use specified backup builds (e.g. BNDZ 3.2 for settings menu, BNDZ 3.6 for plugin marketplace).
- Preserve listview interaction fixes (drag, virtualized marquee, Ctrl+marquee) when reverting other work.
- Clone upstream repos and rename/rebrand concepts to BNDZ product language for end users.
- **Project rule (always apply):** `.cursor/rules/bndz-implementation-rule.mdc` — native host + META upgrades + #1-app quality on every implementation.
- **Mandatory after every implementation:** fresh `npm run build` **and** `dotnet build BNDZBackend/BNDZ.csproj -c Debug` before asking the user to test (WebView2 serves built assets).

## Learned Workspace Facts

- BNDZ is a next-gen Windows file manager: C# backend (BNDZBackend) + WebView2/React frontend (src/), competing with File Pilot and XYplorer.
- Spacedrive/Spacebot upstream repos at `external/spacedrive` and `external/spacebot` are **UX/reference only** — copy UI patterns into BNDZ components; wire to native C# services (`BndzFileIndexService`, `AiAssistantService`, `DuplicateFinderService`), never `src/engines/` HTTP bridges or sidecar admin UI.
- File index cache: `BNDZBackend/Services/BndzFileIndexService.cs` (SQLite under `%LocalAppData%/BNDZ/Index/`).
- `package:installer:rust` expects pre-staged binaries; `package:installer:rust:source` is the full compile path.
- List interaction logic primarily in `src/components/BNDZUI.tsx` and `src/lib/dragController.ts`.
- Frontend IPC bridge at `src/lib/ipcBridge.ts`.
- META upgrades: deepen NuGet-backed host services into list/preview/search/metadata surfaces; see `.cursor/rules/bndz-implementation-rule.mdc`.
