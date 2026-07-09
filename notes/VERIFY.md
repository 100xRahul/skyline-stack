# Verify — Skyline Subreddit Stack

Smoke-tested by serving `dist/client/` locally and loading `game.html` in
Chromium via Playwright on two viewports. The Devvit runtime context is
stubbed via `page.addInitScript` so the bundle's `requestExpandedMode` and
`context.*` calls resolve to no-ops without needing Reddit auth.

## URLs tested

- `http://127.0.0.1:4321/game.html` (production bundle)

## Viewports tested

- Desktop: 1280×900 (Chrome)
- Mobile: 390×664 iPhone 14 emulation, touch + mobile flags

## What worked

- Canvas mounts at full viewport on both viewports.
- HUD pills render (r/sub, YOU, SUB, NEXT, streak, mute) and reflect stubbed init payload.
- Progress bar fills correctly against the stubbed community total.
- Phaser scene chain runs Boot → Preloader (bakes canvas textures) → MainMenu (animated title plate) → Game.
- Splash + game + start overlay all work without console errors.
- Tap-to-drop drops a block; second stacked block visible on top of the base.
- Background gradient, sun disk, parallax city silhouette, and stars all render.
- Next-claim pill shows the next unclaimed milestone and hides on goal.
- Streak-at-risk warning is visible on cold load (stubbed init sets streakAtRisk=true).
- Tap-hint appears after start and hides on first tap.
- Live presence pill ("👥 N building now") renders from the stubbed
  `/api/heartbeat` (active=3) on both viewports and fits the 390px HUD row.
- `connectRealtime` runs in plain Chromium without throwing — the live path
  degrades to a no-op outside the Devvit webview (0 page errors).
- No console errors, no page errors on either viewport.

## Findings and fixes

- (Round 1) Initial score showed `-1` because `updateHud()` was called before `seedGhostFloors()` populated the stacks array. Reordered so the HUD reflects the seeded base.
- (Round 2) Share button was a fake — `forms.ts` hardcoded `template(0, 'today')`. Replaced with a real `/api/share-result` Hono endpoint that uses `reddit.submitComment` to post the actual score.
- (Round 3) Three of five Phaser scenes were empty stubs. Preloader now bakes 3 canvas textures; MainMenu shows a real title plate with auto-advance; GameOver shows a camera beat.
- (Round 4) User contribution was just a number. Added player-named milestone floors: summary overlay lets the player name any floor they own (sanitised 12-char cap, blocklist). Name renders on the tower for the whole sub.
- (Round 5) `/api/share-result` was incorrectly mounted at `/internal/form/api/share-result`. Moved to the api router so the client's `fetch('/api/share-result')` actually resolves.
- (Round 6) No rate limiting — added per-user per-minute buckets for init (30/min), submit (20/min), share (6/min) with 70s TTL.
- (Round 7) Daily palette could repeat on consecutive days. Server now stores today's base palette in the daily meta hash and passes yesterday's id into `buildDailySeed` so the anti-repeat promise is actually enforced.
- (Round 8) Mobile HUD pills overlapped at 390px. Added media queries: pill labels hide at <480px, next-claim pill hides at <360px.
- (Round 9) Collaboration was purely additive — every player started a fresh wide block and just incremented a shared counter, so the "shared tower" was cosmetic and the game read as a Stack reskin. Made the sub build one physical tower: the shared top-floor width (`skyline:<date>:topwidth`) narrows with every run (server-authoritative via `narrowTower()`, clamped to a playable minimum, capped per run, reset daily), and each player's first block inherits it — so your run changes the next builder's difficulty. Surfaced in the start/retry overlays ("You're continuing the sub's tower — it's narrowing") and the run summary ("Tower left for sub"). Smoke test re-run clean (0 console/page errors, both viewports); screenshots regenerated. This also revived dead code: `daily.blockWidth` was shipped but never read by the client.
- (Round 11) Judge-perspective pass. Three gaps: the tower only ever narrowed
  (no pro-social role for skilled players), the ghost tower rendered as a
  uniform column (the hook was invisible in a screenshot), and a judge alone
  in the post saw none of the hand-to-hand story (realtime needs a second
  live player). Fixes: (a) `reshapeTower()` — perfect runs now REPAIR the
  shared tower (+4px/floor, capped) while ordinary runs erode it; summary row
  shows "▲ repaired" / "▼ eroded"; (b) real width history (`widthhist` hash)
  drives the ghost tower's true carved silhouette; (c) "u/X handed it to you
  4m ago" hand-off line (daily meta hash) on start/retry overlays + splash
  card, plus an always-visible TOWER integrity meter in the HUD (gold→red,
  refills live on repairs) and a soft chime when another builder lands a
  perfect. Realtime width adoption re-guarded by communityFloors (monotonic)
  since width now moves both ways. Smoke test extended: asserts the tower
  meter fill (52% from the stubbed width) and the hand-off line; also runs on
  the full Chromium build via `channel: 'chromium'` fallback and serves a 204
  favicon so full-headless Chrome stays console-clean. Re-run clean (0/0 both
  viewports); screenshots regenerated.
- (Round 10) The shared tower only updated on the next reload — playing the same post at the same time felt single-player. Wired Devvit realtime (unused until now): `/api/submit` broadcasts a server-authoritative snapshot to `realtimeChannel(postId)`, and every other player's Game scene adopts it live (SUB bar ticks, tower narrows, overlay subtitle re-renders, a "u/name +N" chip pops in a bottom-left live feed; own-run echo suppressed by session id). Added a "👥 N building now" presence pill backed by a self-pruning `/api/heartbeat` (client pings every 15s; pill shows only at ≥2 active sessions). All best-effort — failures never fail a run and the path no-ops outside Devvit. Smoke re-run clean (0/0 both viewports); presence pill verified rendering at active=3; screenshots regenerated.

## Screenshots

- `notes/skyline-splash-desktop.png` — splash card (desktop)
- `notes/skyline-splash-mobile.png` — splash card (mobile)
- `notes/skyline-desktop-start.png` — MainMenu title plate + first run overlay (desktop)
- `notes/skyline-desktop-playing.png` — in-game play view (desktop)
- `notes/skyline-desktop-after-drop.png` — post-drop, two blocks stacked (desktop)
- `notes/skyline-mobile-start.png` — start overlay (mobile)
- `notes/skyline-mobile-playing.png` — in-game play view (mobile)
- `notes/skyline-mobile-after-drop.png` — post-drop (mobile)

## Tooling

- `node scripts/smoke-test.mjs` — serves `dist/client/`, runs Playwright across viewports, captures screenshots, asserts HUD values and overlay state, exits 1 on any pageerror.
- `npm run build` — produces the bundled `dist/client/` and `dist/server/` artifacts.
- `npm run type-check` — clean.
- `npm run lint` — clean.
- `npm run harness:check` — clean.

## Live Devvit verification (2026-07-09)

Ran the real Devvit loop end to end, not just the Playwright smoke test:

- `devvit login` — authenticated as `Upper_Star_5257`.
- Renamed the app id from `skyline-subreddit-stack` to `skyline-stack` in
  `devvit.json` (Devvit app names have a 16-character max; the display
  title everywhere else is unaffected).
- `devvit upload` — registered the app on Reddit's platform for the first
  time (required before any playtest can run under a new app name).
- `npm run dev` (`devvit playtest`) — created a live dev subreddit
  `r/skyline_stack_dev` and installed the app. Confirmed in a real Reddit
  webview: splash card renders, expand into the full game works, runs
  submit and persist across reloads, the HUD reflects real server state.
- Hit Reddit's platform-level comment rate limit
  (`RatelimitError(TimeString="5 seconds")`) on `/api/share-result` during
  rapid manual test-clicking. Confirmed this is handled gracefully: the
  server's try/catch already returns a clean `500` instead of crashing,
  and the client already shows "Try again" on the share button instead of
  hanging. Not a bug in the app logic — Reddit's own comment rate limit is
  stricter than our in-app 6/min limiter and only surfaces under
  unrealistically fast repeated manual testing.
- `npm run launch` (`devvit upload` + `devvit publish`) — published version
  `0.0.3`. Reddit requires manual review for apps that create custom
  posts, so the app is currently **pending review** (submitted
  2026-07-09); approval arrives by email. The app listing page is live at
  `https://developers.reddit.com/apps/skyline-stack`.

## Known limits of this verification

- `/api/init`, `/api/submit`, `/api/leaderboard`, `/api/share-result`, `/api/heartbeat` are stubbed by the test page. Real Devvit server behavior is exercised only when the user runs `npm run dev` (which calls `devvit playtest` and requires Reddit OAuth).
- Realtime is not exercised end-to-end: `connectRealtime` runs but no broadcasts arrive in plain Chromium (no Devvit message bridge), so the live "u/name +N" feed chips and the live tower-narrowing-from-others paths are verified for safety (no throw, graceful no-op) but not for delivery. Two real sessions in a playtest are needed to see a broadcast land.
- The smoke test does not exercise the "perfect run" reward (no scoring beyond the first drop). End-to-end gameplay must be verified with `npm run dev`.
- The 0-floor "name a floor" submit is verified at the type level but not end-to-end in the smoke test.
