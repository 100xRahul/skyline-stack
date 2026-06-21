# Quality Gates

Run this checklist before considering the project ready.

## Hackathon fit

- The project is a game, not a landing page or generic app.
- The game runs on Reddit Developer Platform / Devvit.
- The hook is explainable in one sentence.
- The project has a clear Reddit-native reason to exist.
- The game avoids obvious clone/slop feel.

## Product

- First play is understandable in under 30 seconds.
- Core loop is complete: start, action, result, retry.
- Mobile play is good.
- There is one daily/weekly retention mechanic.
- There is one community/user-contribution mechanic.
- The scope is shippable by July 15, 2026.

## UX and polish

- No overlapping UI at small or large viewports.
- Text fits containers.
- Controls are obvious and accessible.
- Loading/error states exist.
- Visual feedback makes scoring, failure, and progress clear.
- Sound, if present, has a mute control.

## Devvit

- Client/server split follows Devvit Web expectations.
- Client does not call external APIs directly.
- Server endpoints use `/api/*`.
- Persistent state uses Devvit-supported storage, not only local browser storage.
- No WebSocket/streaming/server-native filesystem assumptions.
- Package scripts actually work in the generated app.

## Rules

- No restricted categories or off-platform account dependency.
- No Reddit trademark/Snoo misuse.
- Assets are owned or licensed.
- UGC is constrained, attributed where needed, and reportable/removable when newly displayed.
- User actions are explicit and optional.

## Submission

- App listing exists.
- Demo post exists in a public subreddit.
- Root README exists.
- Devpost text explains the hook, how to play, retention, user contribution, and Devvit usage.
- Optional short video is under 1 minute if included.

