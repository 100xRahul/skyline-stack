---
name: Submission Draft
---

## App name

Skyline — Subreddit Stack

## Short description

Drop blocks to build today's skyline. Every player in the sub adds a floor, and together you reach today's goal.

## How to play

1. Open a Skyline post in your subreddit.
2. Tap **Start today's stack** to enter the game.
3. Tap (or press Space) to drop each swinging block. Smaller overlaps trim the next block.
4. Stack as many floors as you can. Every floor is added to your sub's shared tower for today.
5. When the sub reaches its daily goal, tomorrow's palette unlocks for everyone.

A run is 20–60 seconds. Perfect stacks (zero overhang) trigger a gold burst and slightly grow the next block, so stacking perfect runs is the meta.

## Why it has a hook

- **One-sentence hook**: drop blocks to build today's skyline — every player in the sub adds a floor, and together you reach the goal.
- **Daily seed**: same challenge for the whole sub for 24h. Palettes, swing speed, and starting block width are deterministic from the UTC date. The seed has a name (e.g. "Stardrop Saturday") so the day has identity.
- **Shared visible progress**: the HUD progress bar fills toward today's floor goal as the sub plays. You are not just chasing a personal best — you are pushing the skyline.
- **Streak**: any day with at least one stacked floor bumps your personal streak counter. A "streak at risk" warning fires in the overlay if you played yesterday but not today.
- **Milestone ownership**: every 5th floor (and the final goal floor) is permanently claimed by the first player to cross it. Their username is etched on the floor in the stack and on the splash.
- **Lifetime achievements**: four unlockable badges (First Stack, Sharpshooter, On Fire, High-Rise) persist across days. They show up in the post-run summary and as a "Lifetime: N/4 unlocked" chip on the splash.
- **Next-claim pill**: a small HUD chip always shows the next unclaimed milestone floor, so you know which run actually matters for the sub.
- **Rival indicator**: the end-of-run overlay names the player you're chasing.
- **PB ghost**: a faint gold line marks your previous best height.
- **Daily goal comment**: the first run that tips the sub over today's goal triggers a Reddit comment from the app account announcing it.
- **Constrained contribution**: every run submits `(username, floors, perfect, optional name)` to Redis. The name (when present) is a single short word, max 12 chars, server-sanitised (control chars stripped, slur blocklist). All contributions are short-lived (36h TTL), and the named-floor surface is the only piece of free-form text — the rest of the input is numeric.

## Why it is Reddit-native

- Custom Devvit post with two entrypoints (`splash.html` for the inline post card, `game.html` for the full-screen game).
- Shared post state: every player in the same post sees and contributes to one skyline.
- Subreddit-scoped leaderboard (`/api/leaderboard`).
- No external client requests — Phaser only talks to `/api/*` on the Devvit server; the server is the only thing that touches Reddit APIs.
- `requestExpandedMode(e, 'game')` to expand into fullscreen game.
- No login, no posting, no commenting, no voting required. Players contribute just by playing.
- Menu item for moderators to start a fresh post. `onAppInstall` trigger creates the initial post.

## Retention mechanic

- Daily seed (UTC) — new challenge every day at 00:00 UTC, with a named "day" (Stardrop Saturday, Tinfoil Tuesday, etc.).
- Per-day personal best so the leaderboard is fair, plus a PB ghost line so you can see your previous high in the stack.
- Streak counter that resets if a player skips a day, with an at-risk warning on day 2+.
- Daily community goal — when the bar fills, a Reddit comment is posted by the app account and tomorrow's palette upgrades for everyone.
- Lifetime achievements (4 tiers) — the only retention loop that survives missing a day, so the player always has a "what's next" goal.
- Milestone ownership — the first player to cross each 5-floor mark etches their name on it forever (for that post).
- Top-3 leaderboard medals, rival indicator naming the next player above you.
- On any unlock, a celebratory achievement toast slides in from the top-right.

## User contribution mechanic

Every run submits `(username, floors, perfect)` to Redis under `skyline:<UTC-date>:contributors`. The top 10 (by floors) are returned by `/api/leaderboard`. All contributions are short-lived (36h TTL, by key naming), numeric, and reportable via standard Devvit moderation. The `/api/share-result` endpoint lets the player post a fixed-template share comment with no free-form text. The named-floor surface (a single 12-char word the player can pin to a claimed milestone) is the only free-form UGC; it is server-sanitised and the blocklist is reviewer-extensible.

## Phaser / technical implementation

- Phaser 4 scene architecture: `Boot -> Preloader -> MainMenu -> Game -> GameOver`.
- `Phaser.Scale.RESIZE` so the canvas fits the Devvit webview on desktop and mobile.
- Tween-driven horizontal block swing for deterministic motion at any FPS.
- Camera follow tween that tracks the growing stack.
- Camera shake on miss; full-screen color flash on perfect and miss.
- Camera "money shot" — at the end of a 3+ floor run the camera zooms out and pans to show the whole tower against the daily city silhouette and sun/moon.
- Procedural particles (rectangle pool) using tweened alpha and scale.
- Procedural sky gradient via `Display.Color.Interpolate` so each daily palette has its own horizon.
- Day/night cycle: sky tints based on UTC hour, sun/moon disk slides across the horizon, deterministic star field fades in at night.
- Parallax city silhouette: deterministic per-day buildings with lit windows, `scrollFactor 0.35`.
- Per-floor HSL color jitter so the stack reads as varied instead of uniform.
- Squash/stretch tween on every block land.
- Combo HUD pill (visible at 2+ consecutive perfects) and haptic feedback via `navigator.vibrate`.
- Procedural Web Audio engine (drop, perfect, miss, goal) with persistent mute toggle.
- Dynamic Phaser-to-DOM HUD coordination via element id hooks.

## Devvit features used

- Custom post with two entrypoints (`splash.html` for the inline post card, `game.html` for the full-screen game).
- Hono server endpoints: `/api/init`, `/api/submit`, `/api/leaderboard`, `/api/share-result`.
- `redis` for daily seed state, per-user streaks, personal bests, lifetime counters, achievement hashes, milestone floor owners, player-named floor labels, base-palette history, and rate-limit buckets.
- `reddit.getCurrentUsername()` for attribution.
- `reddit.submitComment` for the once-per-day "goal reached" comment and the share-template comment.
- `requestExpandedMode(e, 'game')` to expand the inline post card into the fullscreen game.
- `context.subredditName` for the subreddit pill in the HUD, the share comment template, and the splash label.
- Menu item: moderators can create a fresh skyline post.
- `onAppInstall` trigger creates the initial post.
- `Devvit Form` registered in `devvit.json` (placeholder for the legacy form entry).
- Batched Redis reads (`Promise.all`) for both `/api/init` (9 independent reads) and `/api/submit` (5 trailing reads) to keep the request budget under 30s.
- Per-user per-minute rate limiting on init (30/min), submit (20/min), and share (6/min) with 70-second TTL buckets.

## Compliance notes

- No Reddit trademarks or Snoo. Visual identity is original (four palettes: sunrise, daylight, dusk, aurora).
- All assets procedural — no third-party art, fonts, or audio.
- No login, no posting, no commenting, no voting required.
- All user contributions are constrained numeric data.
- Stack uses Redis key scoping so no app-wide data leakage.
- Devvit web limits respected: no streaming, no external client requests, no long-running server work, request and response payloads well under the 4MB / 10MB limits.

## Demo post

Link TBD — to be created in a public subreddit under 200 members.

## App listing

Link TBD — to be created via the Devvit developer portal.
