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

- **One-sentence hook**: every player in the sub builds one shared tower, hand to hand — you continue from exactly where the last builder left it, and together you reach the goal.
- **One shared physical tower (the core hook)**: each Skyline post reshapes a single tower across the day. Your run's starting block width is the width that post's tower currently sits at — and the tower is a **two-way economy**: ordinary runs erode it toward a razor-thin minimum, while a **perfect run repairs it**, widening the top back out for everyone. Sloppy play hands the next builder a harder game; clean play is a gift to the sub. This makes the collaboration *interactive* — your run changes the difficulty of the next player's session, not just a counter both of you watch. Reshaping is server-authoritative (computed from accepted floors added, clamped to a playable range, capped per run in both directions, reset daily), so it's grief-resistant in both directions.
- **The tower's true silhouette**: the server records the width after every accepted run, and the ghost tower renders that real history — pinched where the sub eroded it, swelling where perfect runs repaired it. The post is literally a community-carved sculpture that looks different every day in every subreddit.
- **Legible even solo**: a TOWER integrity meter lives in the HUD (gold when healthy, red when thin), and the start overlay and splash card say who touched the tower last — "u/X handed it to you 4m ago" or "u/X repaired it just now" — so the hand-to-hand mechanic lands even for the first player of the morning.
- **It happens live (Devvit realtime)**: the tower updates in real time. Each submit broadcasts a server-authoritative snapshot to the post's realtime channel, so everyone else in the post watches the SUB bar tick, the shared tower narrow, and a "u/name +N" chip pop in a live feed — two redditors on the same post genuinely build it together at the same moment. A "👥 N building now" presence pill (server heartbeat, shown only at ≥2 sessions) makes the room feel occupied. The client is receive-only and the whole path is best-effort, so it never affects a run.
- **Daily seed**: same challenge for the whole sub for 24h. Palette, swing speed, and goal are deterministic from the UTC date. The seed has a name (e.g. "Stardrop Saturday") so the day has identity. (Starting width comes from the shared tower, not the seed.)
- **Shared visible progress**: the HUD progress bar fills toward today's floor goal as the sub plays. You are not just chasing a personal best — you are pushing the skyline.
- **Streak**: any day with at least one stacked floor bumps your personal streak counter. A "streak at risk" warning fires in the overlay if you played yesterday but not today.
- **Milestone ownership**: every 5th floor (and the final goal floor) is claimed by the first player to cross it. Their username is etched on the floor in the stack, and they can tag the floor with a curated label like Apex, Beacon, or Rally.
- **Lifetime achievements**: four unlockable badges (First Stack, Sharpshooter, On Fire, High-Rise) persist across days. They show up in the post-run summary and as a "Lifetime: N/4 unlocked" chip on the splash.
- **Next-claim pill**: a small HUD chip always shows the next unclaimed milestone floor, so you know which run actually matters for the sub.
- **Rival indicator**: the end-of-run overlay names the player you're chasing.
- **PB ghost**: a faint gold line marks your previous best height.
- **Daily goal comment**: the first run that tips the sub over today's goal triggers a Reddit comment from the app account announcing it.
- **Constrained contribution**: every run submits `(username, floors, perfect, optional curated floor label)` to Redis. Floor labels come from a server-approved list, not arbitrary text. Daily community contributions are short-lived (36h TTL), the rest of the input is numeric, and moderators can clear today's visible labels from a Skyline post.

## Why it is Reddit-native

- Custom Devvit post with two entrypoints (`splash.html` for the inline post card, `game.html` for the full-screen game).
- Shared post state: every player in the same post sees and contributes to one skyline. Daily Redis keys include the post id, so different Skyline posts/subreddits do not share tower state.
- Live shared state via Devvit realtime: the post updates in real time for everyone viewing it (community bar, tower width, a live builder feed, and a presence count), so the feed entry is a living, co-built object rather than a static card.
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

Every run submits `(username, floors, perfect)` to Redis under the daily Skyline keys. The top 10 (by floors) are returned by `/api/leaderboard`. Daily run contributions are short-lived (36h TTL, by key naming), numeric, and reportable via standard Devvit moderation. The `/api/share-result` endpoint lets the player post a fixed-template share comment with no free-form text. The named-floor surface is curated: a player can choose one server-approved label for a milestone floor they own, so the sub still sees player contribution without opening an abuse-prone text box.

Positive-floor runs must include a short-lived server-issued run token from `/api/init` or the previous `/api/submit`. The server consumes the token and caps implausible scores by elapsed time before updating the shared tower, leaderboard, achievements, or daily goal.

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
- Hono server endpoints: `/api/init`, `/api/submit`, `/api/leaderboard`, `/api/share-result`, `/api/heartbeat`.
- `realtime` (Devvit realtime): `realtime.send` on each submit broadcasts the live tower snapshot to every player in the post; the client subscribes with `connectRealtime` (receive-only) for live updates and a live builder feed.
- `redis` for daily seed state, per-user streaks, personal bests, lifetime counters, achievement hashes, milestone floor owners, curated floor labels, base-palette history, a self-pruning live-presence hash, and rate-limit buckets.
- `reddit.getCurrentUsername()` for attribution.
- `reddit.submitComment` for the once-per-day "goal reached" comment and the share-template comment.
- `requestExpandedMode(e, 'game')` to expand the inline post card into the fullscreen game.
- `context.subredditName` for the subreddit pill in the HUD, the share comment template, and the splash label.
- Menu item: moderators can create a fresh skyline post.
- Moderator post menu item: clear today's visible floor labels from the current Skyline post.
- `onAppInstall` trigger creates the initial post.
- `Devvit Form` registered in `devvit.json` (placeholder for the legacy form entry).
- Batched Redis reads (`Promise.all`) for both `/api/init` (9 independent reads) and `/api/submit` (5 trailing reads) to keep the request budget under 30s.
- Per-user per-minute rate limiting on init (30/min), submit (20/min), and share (6/min) with 70-second TTL buckets.

## Compliance notes

- No Reddit trademarks or Snoo. Visual identity is original (four palettes: sunrise, daylight, dusk, aurora).
- All assets procedural — no third-party art, fonts, or audio.
- No login, no posting, no commenting, no voting required.
- User contributions are constrained numeric data plus curated milestone-floor labels.
- Moderator removal path exists for the displayed label surface.
- Stack uses Redis key scoping so no app-wide data leakage.
- Devvit web limits respected: no streaming, no external client requests, no long-running server work, request and response payloads well under the 4MB / 10MB limits.

## Demo post

Link TBD — pending Reddit app review (submitted as version 0.0.3 on
skyline-stack, which creates custom posts and therefore requires manual
review before it can be installed publicly). Once approved, install on a
public subreddit under 200 members, play a few runs (including at least
one perfect run so the tower-repair mechanic is visible), and drop the
post URL here.

## App listing

https://developers.reddit.com/apps/skyline-stack

Current status: version 0.0.3 submitted for review (2026-07-09). Awaiting
Reddit approval email before the app can be installed outside the
dev playtest subreddit.
