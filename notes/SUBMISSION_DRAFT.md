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
- **Daily seed**: same challenge for the whole sub for 24h. Palettes, swing speed, and starting block width are deterministic from the UTC date.
- **Shared visible progress**: the HUD progress bar fills toward today's floor goal as the sub plays. You are not just chasing a personal best — you are pushing the skyline.
- **Streak**: any day with at least one stacked floor bumps your personal streak counter.
- **Constrained contribution**: every run contributes a small numeric artifact (`username`, `floors`, `perfect`). No free-form text.

## Why it is Reddit-native

- Custom Devvit post with two entrypoints (`splash.html` for the inline post card, `game.html` for the full-screen game).
- Shared post state: every player in the same post sees and contributes to one skyline.
- Subreddit-scoped leaderboard (`/api/leaderboard`).
- No external client requests — Phaser only talks to `/api/*` on the Devvit server; the server is the only thing that touches Reddit APIs.
- `requestExpandedMode(e, 'game')` to expand into fullscreen game.
- No login, no posting, no commenting, no voting required. Players contribute just by playing.
- Menu item for moderators to start a fresh post. `onAppInstall` trigger creates the initial post.

## Retention mechanic

- Daily seed (UTC) — new challenge every day at 00:00 UTC.
- Per-day personal best so the leaderboard is fair.
- Streak counter that resets if a player skips a day.
- Daily community goal — when the bar fills, tomorrow's palette upgrades for everyone.

## User contribution mechanic

Every run submits `(username, floors, perfect)` to Redis under `skyline:<UTC-date>:contributors`. The top 10 (by floors) are returned by `/api/leaderboard`. All contributions are short-lived (24h, by key naming), numeric, and reportable via standard Devvit moderation. No free-form text, no avatars, no abuse surface.

## Phaser / technical implementation

- Phaser 4 scene architecture: `Boot -> Preloader -> MainMenu -> Game -> GameOver`.
- `Phaser.Scale.RESIZE` so the canvas fits the Devvit webview on desktop and mobile.
- Tween-driven horizontal block swing for deterministic motion at any FPS.
- Camera follow tween that tracks the growing stack.
- Camera shake on miss; full-screen color flash on perfect and miss.
- Procedural particles (rectangle pool) using tweened alpha and scale.
- Procedural sky gradient via `Display.Color.Interpolate` so each daily palette has its own horizon.
- Dynamic Phaser-to-DOM HUD coordination via element id hooks.

## Devvit features used

- Custom post with two entrypoints.
- Hono server endpoints: `/api/init`, `/api/submit`, `/api/leaderboard`.
- `redis` for daily seed state, per-user streaks, and personal bests.
- `reddit.getCurrentUsername()` for attribution.
- `requestExpandedMode(e, 'game')` from the splash.
- `context.subredditName` for splash label.
- Menu item: moderators can create a fresh skyline post.
- `onAppInstall` trigger creates the initial post.

## Compliance notes

- No Reddit trademarks or Snoo. Visual identity is original (three palettes: sunrise, daylight, dusk).
- All assets procedural — no third-party art, fonts, or audio.
- No login, no posting, no commenting, no voting required.
- All user contributions are constrained numeric data.
- Stack uses Redis key scoping so no app-wide data leakage.
- Devvit web limits respected: no streaming, no external client requests, no long-running server work, request and response payloads well under the 4MB / 10MB limits.

## Demo post

Link TBD — to be created in a public subreddit under 200 members.

## App listing

Link TBD — to be created via the Devvit developer portal.
