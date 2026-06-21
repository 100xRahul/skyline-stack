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
- HUD pills render (YOU, SUB, streak) and reflect stubbed init payload (3 floors, 12 goal).
- Progress bar fills to 25% (3/12).
- Splash CTA card displays with title and start button.
- Clicking START hides the overlay.
- Tapping the canvas drops a block — second stacked block visible on top of the base.
- No console errors, no page errors.
- Streak and personal best surface from the stub.
- Background gradient, sun disk, and block colors match the sunrise palette (paletteId 0).

## Findings and fixes

- Initial score showed `-1` because `updateHud()` was called before `seedGhostFloors()` populated the stacks array. Reordered so the HUD reflects the seeded base.
- Otherwise no bugs found.

## Screenshots

- `notes/skyline-desktop-start.png` — splash + base stack (pre-START)
- `notes/skyline-desktop-playing.png` — same view captured pre-click
- `notes/skyline-desktop-after-drop.png` — post-click, two stacked blocks, overlay hidden
- `notes/skyline-mobile-start.png` — mobile splash
- `notes/skyline-mobile-playing.png` — mobile pre-click
- `notes/skyline-mobile-after-drop.png` — mobile post-click

## Tooling

- `node scripts/smoke-test.mjs` — serves `dist/client/`, runs Playwright across viewports, captures screenshots, exits 1 on any pageerror.
- `npm run build` — produces the bundled `dist/client/` and `dist/server/` artifacts.
- `npm run type-check` — clean.
- `npm run lint` — clean.
- `npm run harness:check` — clean.

## Known limits of this verification

- `/api/init`, `/api/submit`, `/api/leaderboard` are stubbed by the test page. Real Devvit server behavior is exercised only when the user runs `npm run dev` (which calls `devvit playtest` and requires Reddit OAuth).
- Sound is not implemented. No audio asset is shipped.
- Streak logic is naive: any day with a stacked floor bumps the streak. A true "skip-day resets" rule needs a server-side check on yesterday's last-play date.
