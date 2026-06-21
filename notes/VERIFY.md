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

## Known limits of this verification

- `/api/init`, `/api/submit`, `/api/leaderboard`, `/api/share-result` are stubbed by the test page. Real Devvit server behavior is exercised only when the user runs `npm run dev` (which calls `devvit playtest` and requires Reddit OAuth).
- The smoke test does not exercise the "perfect run" reward (no scoring beyond the first drop). End-to-end gameplay must be verified with `npm run dev`.
- The 0-floor "name a floor" submit is verified at the type level but not end-to-end in the smoke test.
