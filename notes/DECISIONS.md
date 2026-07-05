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
2026-06-22 - Curated milestone labels instead of free-form floor names
Context:
  The milestone ownership mechanic had become the main user-contribution
  surface: first-to-cross players could name a floor. That is strong for the
  hackathon's user-contribution prize, but a free-text input is harder to
  defend under Reddit moderation expectations and the project harness guidance
  explicitly prefers constrained inputs over abuse-prone text.
Decision:
  Replace arbitrary floor names with a server-approved label list
  (FLOOR_NAME_CHOICES: Apex, Beacon, Bolt, Crown, Glow, Launch, Rally, Signal,
  Spark, Vault). The client renders a select control, and the server
  canonicalises the submitted label against the same list before writing it to
  Redis. Players still mark their claimed milestone floors in a visible way,
  but there is no arbitrary text box for slurs, harassment, or spam.
Tradeoff:
  Less personal expression than a typed name, but stronger safety and clearer
  judging posture. The mechanic still satisfies "user contribution" because
  players leave persistent, visible marks on the shared daily tower.
Follow-up:
  Consider rotating themed label sets by daily palette if the current ten labels
  feel repetitive after playtesting.
```

```text
2026-06-22 - Smoke test should fail on player-flow regressions
Context:
  The smoke test captured desktop/mobile screenshots and printed HUD state, but
  several player-flow expectations were only logged. A mobile failure like the
  tap hint staying over the playfield could slip through as a "green" command
  if there were no page errors.
Decision:
  Add explicit assertions for the critical first-play flow: start overlay
  visible, overlay hides after start, tap hint appears then hides after the
  first drop, canvas mounts, HUD values match the stubbed Devvit state,
  presence renders, and there are no console/page errors. Any failure now exits
  non-zero.
Tradeoff:
  The smoke test is more opinionated about stub payload values, but that is
  intentional: the script is a product gate, not just a diagnostic capture.
Follow-up:
  Add a second smoke path for end-of-run retry and curated floor tagging once a
  deterministic miss helper is in place.
```

```text
2026-06-22 - Scope daily game state by post id
Context:
  Daily Redis keys originally used only skyline:<date>:..., which meant every
  Skyline post installed on the same day would share floors, leaderboard,
  topwidth, floor labels, and presence. That contradicted the product promise
  that each Reddit post is one living shared tower and could leak state across
  subreddits.
Decision:
  Add the post id to all daily shared-state keys: floors, topwidth, builders,
  perfect flags, milestone owners, floor labels, daily meta, presence, and
  per-day personal best. Streak and lifetime achievement keys stay player-level
  because they are retention loops intended to follow the player across posts.
Tradeoff:
  Two posts in the same subreddit now have separate daily towers. That is the
  right default for a Reddit custom post: the demo post itself is the shared
  object judges experience.
Follow-up:
  If the product later wants subreddit-wide aggregation across many Skyline
  posts, add a separate subreddit aggregate rather than overloading post state.
```

```text
2026-06-22 - Add run tokens and plausible-score caps
Context:
  /api/submit trusted client-reported floors after a simple 0-99 clamp. A script
  could still submit 99-floor runs within the rate limit and pollute the daily
  goal, leaderboard, and achievements.
Decision:
  /api/init and every successful /api/submit issue a short-lived run token tied
  to post id, date, and username. Positive-floor submissions must spend that
  token. The server consumes it, computes a generous max plausible floor count
  from elapsed time, caps impossible scores, and strips perfect-run credit from
  capped submissions before updating shared state.
Tradeoff:
  This is not cryptographic anti-cheat against a dedicated reverse engineer,
  but it blocks raw arbitrary submit spam and raises the bar without adding
  device fingerprinting, account linking, or heavyweight server state.
Follow-up:
  During live playtest, tune the elapsed-time buffer if legitimate fast runs are
  capped too aggressively.
```

```text
2026-06-22 - First-play tutorial belongs inside the visible overlay
Context:
  The first-play tutorial banner was rendered under the start overlay, then
  hidden immediately by startRun(). The CTA said SHOW ME but players never
  actually saw the instructions.
Decision:
  Render the three-step tutorial inside the start overlay on first play:
  watch the block swing, tap when it lines up, and leave the next builder a
  cleaner tower. The smoke test now asserts that this tutorial is visible.
Tradeoff:
  The start overlay is a little denser, but judges get a self-explanatory first
  play without reading docs.
Follow-up:
  Consider replacing the tutorial text with a tiny animated ghost drop if the
  overlay feels too text-heavy after playtesting.
```

```text
2026-06-22 - Moderator removal path for visible floor labels
Context:
  Even curated labels are a displayed user contribution surface. The quality
  gate asks for UGC to be reportable/removable when newly displayed.
Decision:
  Add a moderator-only post menu action on current-app posts:
  "Clear Skyline floor tags". It deletes today's post-scoped floor-label hash
  and leaves scores, floor ownership, streaks, and achievements intact.
Tradeoff:
  Moderators clear all visible labels for the current post/day rather than one
  floor at a time. That is enough for MVP safety and avoids adding a moderation
  UI inside the game.
Follow-up:
  If communities use floor tags heavily, add a specific-floor removal form.
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
2026-06-24 - The tower is alive: Devvit realtime broadcasts + presence
Context:
  The shared physical tower made collaboration interactive, but still only
  asynchronously — you learned the sub had narrowed the tower on your NEXT
  /api/init. Two redditors playing the same post at the same time never saw
  each other. Devvit ships a realtime channel API (realtime.send server-side,
  connectRealtime client-side, both re-exported from @devvit/web) that we were
  not using at all. On Reddit, "the post is alive right now" is the strongest
  hook a game can have, so leaving realtime on the table was the biggest
  remaining gap.
Decision:
  Make the tower update live. On every /api/submit the server broadcasts a
  server-authoritative snapshot {communityFloors, towerWidth, builders,
  goalReached, floors, perfect, user, from} to the post channel
  (realtimeChannel(postId) in shared/api.ts). Every other player's Game scene
  is subscribed and adopts the snapshot — the SUB bar ticks up, the shared
  tower narrows, the start/retry overlay subtitle re-renders, and a "u/name +N"
  chip pops in a bottom-left live feed (gold for a perfect run). The submitting
  tab suppresses its own chip by matching an opaque per-load session id (`from`
  / clientId) it sent with the run; a different tab of the same user still sees
  it. Adopted numbers are guarded monotonically (max floors/builders, min
  width) so out-of-order delivery never rewinds the tower. A second feature —
  a "N building now" presence pill — rides a lightweight /api/heartbeat: the
  client pings every 15s, the server records the session in a self-pruning
  presence hash and returns the count of sessions active in the last 35s. The
  pill shows only when ≥2 sessions are present, so it is a genuine "others are
  here with you" signal.
Tradeoff:
  Devvit realtime is receive-only on the client (only the server may publish),
  so true presence needs a server heartbeat rather than client gossip — one
  extra cheap endpoint, a self-expiring Redis hash, and a 15s client interval.
  Channel names allow only [A-Za-z0-9_], so realtimeChannel() sanitises the
  post id (a raw `skyline:<postId>` would throw in connectRealtime). Everything
  is best-effort: realtime/heartbeat failures never fail a run, and outside the
  Devvit webview (e.g. the Playwright smoke test) connectRealtime degrades to a
  no-op — messages simply never arrive and the game stays fully playable.
Follow-up:
  Could broadcast presence-count changes over realtime too (so the pill updates
  between a client's own heartbeats), and add a soft audio cue when another
  builder lands a perfect run.
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

```text
2026-07-05 - Perfect runs repair the tower; the silhouette is real history
Context:
  The shared tower only ever narrowed. That made the community mechanic
  one-directional (every run made the next player's start worse) and gave
  skilled players no pro-social role. Worse, the hook was invisible: ghost
  floors rendered as a uniform column, and a judge playing alone in the post
  (the realistic judging condition) saw none of the hand-to-hand story —
  realtime chips and presence only appear when someone else is playing at the
  same moment.
Decision:
  Three changes that make the hook visible and two-directional:
  1. reshapeTower() (was narrowTower): ordinary runs erode 5px/floor (cap 30);
     a PERFECT run repairs +4px/floor (cap 24), never above the start width.
     Server-side only, from accepted floors. The tower becomes a two-way
     economy — sloppy play erodes it, clean play is a gift to the sub.
  2. Real carved silhouette: the server records a width sample after every
     accepted run (widthhist hash: floor count -> width). The client
     interpolates between samples so the ghost tower renders its true shape —
     pinched where the sub eroded it, swelling where perfects repaired it —
     plus a deterministic jitter so it reads hand-built. The post becomes a
     community-carved sculpture, which is the screenshot that sells the hook.
  3. Async legibility: lastBuilder/lastBuilderAt/lastBuilderPerfect on the
     daily meta hash drive a "u/X handed it to you 4m ago" line on the start
     and retry overlays and on the splash card, and a TOWER integrity meter
     sits in the HUD (gold when healthy, red when thin). A judge alone in the
     post now sees the hand-to-hand mechanic in the first ten seconds.
  Realtime guard change: width now moves both ways, so the old monotonic
  min() would swallow repairs. communityFloors only ever grows, so receivers
  use it as the sequence guard and adopt towerWidth only from fresh snapshots.
  Also: a soft low-gain chime when another builder lands a perfect (the room
  applauds), and the tutorial now teaches erode/repair explicitly.
Tradeoff:
  Two extra best-effort Redis writes per positive-floor submit (history
  sample + handoff fields) and two extra reads batched into init's existing
  Promise.all. A skilled player can hold a post's tower wide indefinitely —
  that is the point: it gives experts a visible, pro-social job.
Follow-up:
  If live playtest shows repairs are too easy, drop TOWER_REPAIR_PER_FLOOR
  to 3 or the per-run cap to 16. Consider a "Mason" achievement for
  cumulative repaired pixels.
```
