# Build Workflow

Pipeline:

```text
BRIEF -> CONCEPT -> SCAFFOLD -> GAME LOOP -> RETENTION -> REDDIT INTEGRATION -> POLISH -> VERIFY -> SUBMIT
```

## BRIEF

Read `AGENTS.md`, `harness/01-hackathon-brief.md`, and `harness/02-devvit-platform.md`.

Refresh official docs with `curl.md <url>` if a rule or API seems stale.

## CONCEPT

Create `notes/GAME_SPEC.md` from `templates/GAME_SPEC.md`.

Pick exactly one primary hook. Write non-goals. Reject ideas that require complex account linking, live multiplayer, or unrestricted free-form UGC.

## SCAFFOLD

Use `https://developers.reddit.com/new` and pick the template that matches the concept. Prefer Devvit Web Phaser for action/arcade/spatial games, React for puzzle/card/turn games, Three.js only when 3D is core.

After scaffold, inspect:

- `package.json`
- `devvit.json`
- `src/client`
- `src/server`
- `src/shared`

Do not assume command names. Use scripts that exist.

## GAME LOOP

Implement the playable loop before retention systems. The first build should be fun without a leaderboard.

Minimum loop:

- Start state.
- Player action.
- Clear win/loss/score result.
- Retry.
- Mobile-friendly controls.

## RETENTION

Add one daily or weekly reason to return:

- Daily challenge seed.
- Streak.
- Unlockable cosmetic/status.
- Community milestone.
- Weekly leaderboard.
- New safe prompt/modifier.

## REDDIT INTEGRATION

Add one Reddit-native feature:

- Shared subreddit/post state.
- Async leaderboard.
- Player contributed modifiers from constrained choices.
- Community challenge progress.
- Comment/post context if supported and compliant.

## POLISH

Prioritize:

- Responsive layout.
- Fast first load.
- Clear controls.
- Strong feedback when scoring/failing/winning.
- Consistent visual language.
- No visible debug text in final build.

## VERIFY

Run available checks:

```bash
npm run harness:check
npm run build
npm run lint
npm run typecheck
npm run dev
```

Only run scripts that exist.

Use browser automation or Devvit playtest for visual checks. Verify mobile and desktop sizes. Capture issues in `notes/VERIFY.md`.

## SUBMIT

Use `harness/07-submission.md` and `templates/SUBMISSION.md`. Ensure root `README.md` describes install/play instructions, game loop, retention hook, community mechanic, and Devvit limitations/commands.

