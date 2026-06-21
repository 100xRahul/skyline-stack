# Game Spec — Skyline

## Name

Skyline — Subreddit Stack

## One-sentence hook

Drop blocks to build today's skyline — every player in the sub adds a floor, and together you reach the goal.

## Player fantasy

You are one of many stonemasons racing against the clock. Each tap stacks a glowing slab on top of yesterday's collective work. The sub's tower only reaches today's height if everyone shows up.

## Core loop

- **Start**: Splash CTA opens expanded-mode Phaser canvas. HUD shows YOU / SUB / 🔥 pills plus a horizontal progress bar.
- **Player action**: A block swings horizontally across the top of the stack. Tap (or press Space) to drop it. Score = overlap width.
- **Result**: Each successful drop trims the next block to the overlap. Misses end the run. Perfect drops (zero overhang) glow gold and grow the next block.
- **Retry**: End-of-run overlay shows floors stacked, sub contribution, streak, and whether the sub reached today's goal. One tap starts a fresh run.

Target length: 20–60 seconds per run.

## Daily return

- **Daily seed** (UTC): drives palette (3 base variants + a 4th "aurora" palette unlocked when the sub hit yesterday's goal), swing speed (70–160), and community goal (12–30). Same for every player in the sub for 24h. (Starting block width is no longer seed-derived — it comes from the shared tower the sub is narrowing; see the community mechanic.)
- **Streak**: computed server-side from the stored last-play date. Consecutive UTC days with ≥1 stacked floor increment it; skipping a day resets to 1. Spoof-proof (client never sends the count).
- **Personal best per day**: per-player per-UTC-day, so the leaderboard resets cleanly.
- **Shared goal**: when the community fills the bar, every active player sees a "Goal Reached" badge. The server records it, and the next UTC day everyone loads into the bonus "aurora" palette ("Aurora unlocked ✨"). Determined server-side from yesterday's stored floors vs. goal — no client trust.

## Reddit-native / community mechanic

- **Shared sub tower**: every player's successful drop adds floors to `skyline:<UTC-date>:floors` in Redis. New players see those floors as semi-transparent "ghost" platforms before they begin.
- **One tower, narrowed hand to hand**: the sub builds a single physical tower per day. Its top-floor width lives in `skyline:<UTC-date>:topwidth` and starts wide (`TOWER_START_WIDTH`). Every run narrows it (more for a sloppy run, less for a perfect one) down to a clamped, still-playable minimum (`TOWER_MIN_WIDTH`). Your run's starting block inherits that width, so you continue the sub's tower from where the last builder left it — your contribution changes the difficulty of the next player's session, not just a shared counter. Narrowing is `narrowTower()` in `shared/seed.ts`, applied server-side in `/api/submit` from floors added (the client never asserts the width), capped per run so no single run (or script) can slam the tower to the minimum. Resets with the daily key.
- **Daily builders board**: each player is one entry in a per-day sorted set (`skyline:<UTC-date>:builders`) scored by their best floors for the day (deduped by user). Top 10 are returned inline in the init/submit responses (and via `/api/leaderboard`) and rendered on the start and end overlays — current user highlighted, perfect runs starred. The live builder count and goal bar also drive the inline post card so the feed entry itself is the hook.
- **Single-post shared state**: state is scoped to the post so each post becomes one synchronized skyline for its subreddit.
- **No external client calls**: client hits `/api/*` on the Devvit server; the server is the only thing that touches Reddit APIs.

## User contribution

Each run contributes a safe, constrained, numeric artifact: `(username, floors, perfect, timestamp)`. No free-form text. Reportable per Devvit's standard moderation since the data lives in Reddit storage.

## Safety / moderation

- All contributions are numeric and short-lived: every daily Redis key carries a 36h TTL.
- No message board, no avatars, no PII beyond Reddit username.
- No login, no posting, no commenting, no voting required.
- Block palettes are procedural — no third-party art, no Reddit IP, no copyrighted assets.

## Devvit capabilities used

- Custom post (`splash.html` + `game.html` entrypoints).
- Server `Hono` routes: `/api/init`, `/api/submit`, `/api/leaderboard`.
- `redis` for daily seed state, per-user streaks, and personal bests.
- `reddit.getCurrentUsername()` for attribution.
- `requestExpandedMode(e, 'game')` from the splash CTA.
- `context.subredditName` for splash label.
- Menu item "Start a new skyline" for moderators.
- `onAppInstall` trigger creates the initial post.

## Phaser use

- Phaser scene architecture (`Boot -> Preloader -> MainMenu -> Game -> GameOver`).
- `Phaser.Scale.RESIZE` to fit the Devvit webview (desktop and mobile).
- Tween-driven horizontal swing for deterministic motion at any FPS.
- Camera follow tween as the stack grows.
- Camera shake on miss, full-screen color flash on perfect/miss.
- Procedural particles (20× per perfect) using tweened rectangles.
- Procedural sky gradient via `Display.Color.Interpolate` so each daily palette has its own horizon.
- Procedural lit windows on every block so the stack reads as a city skyline, not plain bars.
- Escalating perfect-combo feedback (bigger bursts, brighter flash, rising pitch).
- Dynamic Phaser DOM HUD coordination through element id hooks.

## Audio

- Synthesized at runtime with the Web Audio API — no asset files. Distinct cues for drop, perfect (rising chime), miss (descending thud), and goal-reached (arpeggio).
- Mute toggle in the HUD, persisted to `localStorage`. Audio context is resumed on the first user gesture so autoplay policies are respected.

## MVP

1. Daily seed (palette, swing speed, goal, block width).
2. Stacking gameplay with overlap-based trim.
3. Personal best + streak + community floor contribution.
4. Sub progress bar in the HUD.
5. End-of-run overlay with summary and "goal reached" feedback.
6. Splash + game entrypoints wired into `devvit.json`.
7. Mobile-fit layout via CSS + Phaser `RESIZE`.
8. Submission of run via `POST /api/submit` and `GET /api/leaderboard`.

## Non-goals

- No multi-block placement per tap (keep the loop pure).
- No free-form text, comments, or avatars.
- No post/comment/vote gating.
- No external API fetches from the client.
- No 3D, no WebGL-only effects that lose mobile smoothness.
- No login screens, no account linking.
- No audio *asset files* — all sound is synthesized at runtime (with a mute toggle).
- No offline/degraded fallback — a failed server call shows an explicit retry overlay, never fabricated state.
