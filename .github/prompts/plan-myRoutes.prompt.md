## Plan: My Routes Filesystem MVP

Build a new authenticated full-page experience at /my-routes that syncs and displays Strava-created routes, then lets users organize those synced routes into a virtual folder tree stored in the app database. Phase 1 is read-only against Strava route data (sync + display) with local folder assignment only; no route editing or push-back to Strava.

**Steps**
1. Confirm API contract and auth scope behavior for Strava routes endpoints and lock request/response shape for MVP (depends on none).
2. Add persistence schema for route catalog + folder tree + route-folder assignment; include user ownership and indexes for fast tree/list queries (depends on 1).
3. Add backend Strava route sync endpoint(s) with token refresh reuse, pagination, idempotent upsert by strava_route_id, and private-route handling under read_all scope (depends on 2).
4. Add backend folder tree endpoints for create folder, rename folder, move folder, and assign/unassign route-to-folder mapping; enforce per-user authorization (depends on 2, parallel with 3).
5. Add server-rendered page entry at /my-routes with auth gate and initial data hydration shape for routes + folders (depends on 3 and 4).
6. Build client page for filesystem UI: left tree (folders), right route list, drag/drop or move action, and sync action; include empty/error/loading states (depends on 5).
7. Wire navigation entry points so users can discover /my-routes from existing app navigation without changing current map editing flows (depends on 6).
8. Add verification coverage: API-level tests for auth/ownership/upsert rules and manual UX validation for sync + folder organization scenarios (depends on 6 and 7).

**Parallelism / blockers**
1. Blockers: Steps 1-2 establish core data contract.
2. Parallel work: Step 3 (Strava sync) and Step 4 (folder endpoints) can run in parallel after Step 2.
3. UI work (Steps 5-7) should start after minimal contracts from Steps 3-4 are stable.

**Relevant files**
- /home/harry/GitHub/trail_overlay/app/api/auth/strava/route.ts — extend/verify OAuth scope string to include read_all for private routes visibility.
- /home/harry/GitHub/trail_overlay/app/api/auth/strava/callback/route.ts — keep token persistence behavior aligned with added route sync usage.
- /home/harry/GitHub/trail_overlay/app/api/strava/sync/route.ts — reference token refresh and pagination patterns for new route sync endpoint.
- /home/harry/GitHub/trail_overlay/lib/auth.ts — reuse getSessionUser/getSessionUserId/provider capability checks for auth-gated routes page and APIs.
- /home/harry/GitHub/trail_overlay/lib/db.ts — use query/queryOne patterns for route/folder persistence.
- /home/harry/GitHub/trail_overlay/lib/api/responses.ts — keep API response shape consistent with existing success/error conventions.
- /home/harry/GitHub/trail_overlay/migrations — add new migration(s) for routes, route_folders, and route_folder_items (or equivalent mapping model).
- /home/harry/GitHub/trail_overlay/app/api — add new endpoints for Strava route sync/read and folder CRUD/move/assignment.
- /home/harry/GitHub/trail_overlay/app/my-routes/page.tsx — new full-page route entry with server-side auth + initial data fetch.
- /home/harry/GitHub/trail_overlay/components — add My Routes page UI components (tree/list/actions) following existing app patterns.
- /home/harry/GitHub/trail_overlay/hooks — add hook(s) for folder tree and route list mutations with optimistic updates where safe.

**Verification**
1. API auth: unauthenticated requests to new /api routes return 401; cross-user folder/route IDs return 403/404 without leakage.
2. Sync correctness: repeated sync does not duplicate routes; renamed Strava routes update local metadata; deleted/private visibility changes are handled per chosen policy.
3. Folder operations: create/rename/move nested folders persists correctly; route assignments survive refresh and re-sync.
4. UI behavior: /my-routes loads for logged-in users, handles empty states, and displays actionable errors for token/scope failures.
5. Regression check: existing Strava activity sync and segment explorer flows remain unchanged.

**Decisions**
- Included: /my-routes full page, virtual DB-based folder tree, Strava route sync/read, and local route-to-folder organization.
- Excluded (phase 1): creating/editing/deleting Strava routes, pushing folder changes to Strava, and writing real filesystem files.
- Assumption: users grant read_all scope to access private routes; otherwise private routes are filtered by Strava.

**Further Considerations**
1. Deletion policy for missing Strava routes after sync: soft-hide locally (safer UX) versus hard-delete mapping rows (cleaner data).
2. Folder model: adjacency list (parent_id) is simplest for MVP; closure table can be deferred unless deep-tree querying becomes a bottleneck.
3. Sync trigger: manual Sync button only for MVP, optional background or scheduled sync later.