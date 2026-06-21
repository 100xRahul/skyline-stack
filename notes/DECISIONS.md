# Decisions

```text
2026-06-21 - Scaffold with the official Devvit Phaser template
Context:
  Initially planned to scaffold manually with Vite + Phaser + React so iteration
  was faster and didn't require Reddit OAuth. Concerned about converting a
  hand-rolled scaffold to a real Devvit app at launch time.
Decision:
  Use the official Devvit Phaser template structure (src/client, src/server,
  src/shared, devvit.json, vite.config.ts, @devvit/start vite plugin, Hono
  server, @devvit/web APIs). Mirror the exact files from the upstream template
  rather than running `npm create devvit@latest` (which requires an interactive
  OAuth flow to copy an init code back into the terminal).
Tradeoff:
  We can't run `npm run dev` (devvit playtest) without Reddit auth, so iteration
  relies on `npm run build` + a static `dist/client/` server for browser
  verification. This is the same trade-off the official template would have on
  day one before the user logs in.
Follow-up:
  When ready for live testing, run `npm run login` to OAuth into Reddit, then
  `npm run dev` to spin up a test subreddit.
```

```text
2026-06-21 - Use sorted sets instead of lists for the daily leaderboard
Context:
  The Devvit Redis client (which mirrors a curated subset of Redis) exposes
  sorted sets (zAdd, zRange, zRemRangeByRank, etc.) and hashes but NOT list
  operations (lPush, lTrim, lRange).
Decision:
  Store daily contributors as a sorted set keyed by floor count (score), so the
  top contributors naturally float to the top via zRange with reverse=true. Trim
  by rank to keep the set to 25 entries.
Tradeoff:
  Slightly more code than a simple list, but uses the supported primitives.
Follow-up:
  None.
```

```text
2026-06-21 - Bootstrap seed flows from server, with client-side fallback
Context:
  The /api/init call returns the daily seed, community floors, personal best,
  and streak. If the call fails (offline, Devvit webview not ready, smoke test),
  the game should still play.
Decision:
  The Game scene bootstrap() awaits /api/init. On any failure, it falls back to
  buildDailySeed(todayUtc(), 0). The /api/submit endpoint also has a client-side
  fallback that shows the local-only summary so the end-of-run overlay still
  shows.
Tradeoff:
  Slight risk of stale "personal best" on offline submissions, but it keeps the
  game playable in degraded conditions.
Follow-up:
  None.
```

```text
2026-06-21 - Phaser 4 instead of Phaser 3
Context:
  The official Devvit Phaser template ships with Phaser 4 (4.1.0) and the
  TypeScript types match the API we use (Tweens, Scenes, Display.Color).
Decision:
  Use Phaser 4 as the template does. Avoid features that would force a downgrade
  (e.g. legacy plugin syntax).
Tradeoff:
  Phaser 4 has some breaking changes from 3; we stick to the documented API.
Follow-up:
  None.
```
