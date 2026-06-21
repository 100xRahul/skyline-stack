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

```text
2026-06-22 - Lifetime achievements as the long-term retention loop
Context:
  Daily streaks are powerful but a player who misses two days in a row loses
  the streak. We needed a second retention loop that compounds even when the
  player is offline: lifetime floors, lifetime perfects, and longest streak.
  These let a returning player see real progress, unlock permanent badges, and
  always have "what's next" visible in the summary card.
Decision:
  Add four lifetime achievements (first-stack, ten-perfect, week-streak,
  fifty-floors) tracked on the server with Redis hashes. Server returns
  current/goal/progress/unlocked on every /api/init and /api/submit response.
  The summary card shows all four with progress bars, and newly-unlocked
  achievements pop a celebratory toast in the corner. The splash also shows a
  "Lifetime: N/4 unlocked" chip so first-time visitors see the long-term goal.
Tradeoff:
  Server response grew slightly (achievements array on every call). The hash
  write happens once per submit, so it's not a hot path. The HUD didn't get
  crowded because achievements live in the post-run summary, not the HUD.
Follow-up:
  Consider expanding to 6-8 achievements (streak tiers, builder-of-the-day,
  perfect-run streaks) if launch data shows we need a longer "what's next".
```

```text
2026-06-22 - "Next claim" pill in the HUD
Context:
  The milestone floor ownership system (5, 10, 15, ..., goal) awards the
  first-to-cross floor to the player, but the player had no way to see which
  milestone they were racing toward in the moment.
Decision:
  Add a "next-claim" pill in the HUD that shows the next unclaimed milestone
  (next multiple of 5 above community floors, or the daily goal if closer).
  Pulses gently to draw the eye. Hidden once the goal is reached.
Tradeoff:
  One more HUD chip, but it's tucked between the score and community pills and
  reuses the same visual language (pill, soft gold tint).
Follow-up:
  None.
```
