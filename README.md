# Skyline — Subreddit Stack

Drop blocks to build today's skyline — every player in the sub adds a floor, and together you reach the goal.

Built for [Reddit's Games with a Hook Hackathon](https://redditgameswithahook.devpost.com/).

## How to play

1. Open a Skyline post in a participating subreddit.
2. Tap **Start today's stack** to expand into the game.
3. Tap (or press Space) to drop each swinging block.
4. Stack as many floors as you can — every floor you place is added to your sub's shared tower for today.
5. When the sub's tower hits the daily goal, tomorrow's palette unlocks for everyone.

A run takes 20–60 seconds. Perfect stacks (zero overhang) trigger a gold burst, a rising chime, and the next block grows slightly — chaining perfect runs is the meta. A mute toggle sits in the HUD.

## Why it has a hook

- **One-sentence hook**: drop blocks to build today's skyline — every player in the sub adds a floor, and together you reach the goal.
- **Daily reset**: the seed (palette, swing speed, goal, starting block width) is locked for the UTC day, so everyone in the sub gets the same challenge.
- **Visible community progress**: the inline post card *and* the in-game HUD show a live bar toward today's floor goal, plus how many builders have contributed. You are not just chasing a personal best — you are helping the sub's skyline.
- **Today's builders board**: the end-of-run overlay (and the start overlay) shows the day's top contributors, with you highlighted and perfect runs starred.
- **Constrained contribution**: every run contributes `(username, floors, perfect)` to Redis. No free-form text, no abusive inputs.

## Why it is Reddit-native

- Shared post state — every player in the same post shares one skyline.
- Subreddit-scoped leaderboard (`/api/leaderboard`).
- No external client requests. The Phaser client only talks to `/api/*` on the Devvit server. The server is the only thing that touches Reddit's APIs.
- `requestExpandedMode(e, 'game')` from the splash, so the game plays inside the Reddit webview.
- No login, no posting, no commenting, no voting required. Players contribute just by playing.

## Retention mechanic

- Daily seed (UTC) — new challenge every day at 00:00 UTC.
- Streak counter computed server-side: consecutive UTC days with a stacked floor increment it; skipping a day resets it to 1. The count is derived from the stored last-play date, so it can't be spoofed by the client.
- Daily personal best, so the leaderboard stays fair.
- Daily community goal — when the bar fills, tomorrow's palette unlocks.

## User contribution mechanic

Every run submits `(username, floors, perfect)` to Redis. Each player is one entry in a per-day sorted set (`skyline:<UTC-date>:builders`) scored by their best floors for the day, so the board dedupes by user. The top 10 are returned in the init/submit responses (and via `/api/leaderboard`) and surfaced on the start and end overlays, with the current user highlighted and perfect runs starred. All daily keys carry a 36h Redis TTL, so contributions are genuinely short-lived; data is numeric and reportable via standard Devvit moderation.

## Tech stack

- Devvit Web (custom post, `splash.html` + `game.html` entrypoints).
- Phaser 4 for game feel, scenes, tweens, particles, camera.
- Hono server with `@devvit/web` for `/api/*`, `/internal/menu/*`, and `/internal/triggers/*`.
- Redis for daily seed state, per-user streaks, and personal bests.
- Vite for the client/server build.
- TypeScript across `src/client`, `src/server`, `src/shared`.
- Pure CSS for HUD/splash — no Tailwind, no asset CDN.

## Local development

Prereqs: Node 22.2+.

```bash
npm install
npm run harness:check   # quick sanity
npm run build           # produces dist/client + dist/server
npm run type-check      # tsc --build
npm run lint            # eslint
```

`npm run dev` runs `devvit playtest`, which spawns a test subreddit on Reddit. It requires `npm run login` first (opens Reddit OAuth in your browser).

## Devvit features used

- Custom post with two entrypoints: `splash.html` (default) and `game.html` (expanded).
- Server endpoints under `/api/*` (Hono) and `/internal/*` (menu, triggers).
- `redis` for state, `reddit.getCurrentUsername()` for attribution.
- Menu item: moderators can start a fresh skyline post.
- Trigger: `onAppInstall` creates the initial post.

## Known limitations

- The game requires the Devvit server. There is no offline/degraded mode: if `/api/init` or `/api/submit` fails, the player sees an explicit error overlay with a retry button rather than fabricated state.
- No mid-game save — once you miss, the run is over.
- Audio is synthesized at runtime with the Web Audio API (no asset files). The mute preference is stored in `localStorage`; all durable game state lives in Redis.
- Daily seed keys are UTC dates. Players in very late or very early timezones may see two different "todays" within 24h; this is intentional for global fairness.
