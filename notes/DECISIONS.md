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
2026-06-21 - Bootstrap seed flows from server; no fabricated fallback
Context:
  The /api/init call returns the daily seed, community floors, personal best,
  and streak. An early build fell back to a client-only buildDailySeed() when
  the call failed, but that fabricated community/streak state the player could
  mistake for real, shared data.
Decision:
  The Game scene bootstrap() awaits /api/init and /api/submit. On any failure it
  shows an explicit error overlay with a retry button (showError) and never
  fabricates state — Game.ts:bootstrap() and submitRun() both bail to the retry
  overlay. The game is server-authoritative; a degraded path that invents a
  shared tower would be worse than an honest "try again".
Tradeoff:
  No offline play. Acceptable: the whole point is the shared sub tower, which
  only exists on the server.
Follow-up:
  None.
```

```text
2026-06-24 - Shared physical tower: the sub narrows one tower hand to hand
Context:
  The core loop was single-player "Stack" with the community contribution being
  an additive counter — every player started a fresh wide block and their floors
  just incremented a shared total. The collaboration was a sum, not an
  interaction: nothing one player did changed another player's session. That is
  the weakest form of "user contribution" and reads as a Stack reskin.
Decision:
  Make the sub build ONE physical tower per day. Its top-floor width lives in
  skyline:<date>:topwidth and starts at TOWER_START_WIDTH. Every run narrows it
  (narrowTower() in shared/seed.ts) — more for a sloppy run, less for a perfect
  one — down to a clamped TOWER_MIN_WIDTH. The player's first block inherits the
  current width, so each builder continues the tower from where the last left
  it. Surfaced in the start/retry overlays ("You're continuing the sub's tower —
  it's narrowing") and the end-of-run summary ("Tower left for sub").
  Note: this revived dead state — daily.blockWidth was computed server-side and
  shipped but never used by the client (the first block was hardcoded to
  PLAY_WIDTH).
Tradeoff:
  Narrowing must be server-authoritative to be grief-safe. It is computed from
  floors added (the client never asserts a width), clamped to a playable
  minimum, capped per run (TOWER_MAX_NARROW_PER_RUN) so no single run/script can
  slam the tower to the minimum, and reset with the daily key. One extra Redis
  read + conditional write per submit; one extra read batched into /api/init.
Follow-up:
  Consider a visible tower-width meter in the HUD, and letting a long perfect
  run widen the tower back a touch as a "repair the sub's tower" reward.
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

```text
2026-06-23 - Move share endpoint from /internal/form to /api
Context:
  The original share-to-post feature registered a Devvit form at
  /internal/form/share-result with no fields. The client wired the share
  buttons to call /api/share-result, but the new server code accidentally
  registered the real handler at forms.post('/api/share-result'), which
  resolves to /internal/form/api/share-result — a 404 in production. The
  only reason this didn't blow up in the smoke test is that the smoke
  test never exercised the share endpoint.
Decision:
  Move the real share handler to the api router (api.post('/share-result'))
  so the URL the client calls actually exists. Keep a no-op form handler
  at /internal/form/share-result so the devvit.json form declaration is
  still valid.
Tradeoff:
  None — the right home for this endpoint was always /api/*.
Follow-up:
  None.
```

```text
2026-06-23 - Per-user per-minute rate limiting
Context:
  The /api/* endpoints are internet-exposed (the post is public). Without
  rate limits a single script can call /api/submit thousands of times per
  second and either burn Redis quota or pollute the leaderboard. The
  previous build had no rate limiting at all.
Decision:
  Add a per-user per-minute Redis bucket. Each endpoint gets its own
  counter (init: 30/min, submit: 20/min, share: 6/min) with a 70-second
  TTL. The bucket key includes the current minute so it self-cleans.
  Counters are 1 incrBy + 1 conditional expire; well under the 30s
  request budget.
Tradeoff:
  One extra Redis op per request. Below noise floor.
Follow-up:
  None.
```

```text
2026-06-23 - Mobile HUD: hide labels under 480px, drop next-claim under 360px
Context:
  The HUD has 5 pills (r/sub, YOU, SUB, NEXT, streak) plus a mute button.
  At 390px (iPhone 14 width) the pills overlap or get clipped.
Decision:
  Add a media query that hides the pill labels (which are already in
  aria-label for a11y) at <480px and shrinks the pill padding. A second
  query hides the next-claim pill entirely at <360px because the
  community progress bar carries the same information.
Tradeoff:
  Players on narrow phones lose the textual label but the value
  remains. They retain the community progress bar as a goal cue.
Follow-up:
  None.
```

```text
2026-06-23 - Enforce "no two consecutive days share a base palette"
Context:
  The seed code claimed "the same color never appears two days in a row"
  but the implementation was a uniform random draw, so two days could
  repeat. That was a silent lie in the docs/comments.
Decision:
  Make the promise real. Server stores today's base palette (0/1/2) in
  the daily meta hash and reads yesterday's id on the next init. The
  buildDailySeed function takes a previousBase argument and bumps to
  the next palette on collision. First-ever load (no previousBase) gets
  the unconstrained pick.
Tradeoff:
  One extra Redis op on init (read yesterday's meta key, write today's).
  We already batch the previousBase read into the same Promise.all.
Follow-up:
  None.
```
