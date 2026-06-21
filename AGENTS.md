# Reddit Games With A Hook Hackathon Harness

This repo is the build harness for a Reddit Devvit Web game submission.

**Goal:** build a launch-ready Reddit game that is delightful, polished, community-native, and hooky enough to bring players back daily.

## Non-Negotiables

- Build for the hackathon brief, not a generic web game.
- The game must run as a Reddit Devvit app inside a Reddit post.
- Prefer Devvit Web with React + Phaser unless the actual app has already chosen another stack.
- Do not make a marketing landing page as the main experience. Build the playable game first.
- Do not use Reddit trademarks, Snoo, or clone/copycat IP.
- Do not build gambling, finance, political, adult, harmful, spammy, or off-platform account-linking mechanics.
- Avoid obvious AI slop: fit viewport, mobile-first, distinct art direction, clear human player loop.
- Use only assets/code we own or can license.
- Keep user-generated content constrained and moderated: prefer emojis, symbols, predefined prompts, drawings with reporting/removal, or curated inputs over free-form abuse-prone text.
- No external client requests. Devvit Web client calls app `/api/*` endpoints; server handles allowed external fetches only if needed and compliant.

## Hackathon Facts

- Event: Reddit's Games with a Hook Hackathon
- Submission deadline: July 15, 2026 at 6:00 PM PDT
- Current repo created: June 21, 2026
- Prizes: $40,000 total
- Grand prize: Best App with a Hook, $15,000
- Sub-challenges: Best Use of Phaser, Best Use of Retention Mechanics, Best Use of User Contributions
- Submission needs: app listing, demo post in a public subreddit, README, optional demo video under 1 minute, optional public repo, optional Devvit feedback survey

## Build Pipeline

```
BRIEF -> CONCEPT -> SCAFFOLD -> GAME LOOP -> RETENTION -> REDDIT INTEGRATION -> POLISH -> VERIFY -> SUBMIT
```

Do not skip `VERIFY`.

## Start Of Session

Run:

```bash
npm run harness:check
```

Then read:

1. `harness/01-hackathon-brief.md`
2. `harness/02-devvit-platform.md`
3. `harness/03-product-strategy.md`
4. `harness/04-build-workflow.md`
5. `harness/05-quality-gates.md`
6. `harness/08-skills-and-tools.md`

If building or editing app code, inspect the actual generated app first. Expected Devvit Web shape:

```text
src/client/
src/server/
src/shared/
devvit.json
package.json
```

## Commands

Harness commands:

```bash
npm run harness:check
npm run brief
npm run resources
```

Devvit app commands after scaffold exists:

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run launch
```

Only run commands that exist in the actual app `package.json`.

## Decision Rules

- Choose a small, replayable game loop over a broad unfinished concept.
- Optimize for daily return: streaks, daily puzzle/challenge, weekly leagues, unlocks, evolving shared state, player-of-the-day, community milestones.
- Optimize for Reddit-native play: comments, public post state, subreddit identity, asynchronous multiplayer, community goals, safe user contributions.
- Make first screen self-explanatory. Judges primarily evaluate from a public demo post.
- Make mobile excellent. Bonus points for launch-ready mobile experience.
- If using Phaser, use it meaningfully for gameplay feel, animation, particles, physics, camera, juice, or scene architecture.
- Use the local skill at `.agents/skills/reddit-hackathon-builder/SKILL.md` when planning, building, reviewing, or preparing the submission.
- Use `.agents/skills/playwright-game-verifier/SKILL.md` when a Devvit playtest URL, localhost URL, or deployed demo URL is available.

## When Stuck

- Read `harness/06-resources.md`.
- Fetch current docs with `curl.md <url>` before guessing.
- Create or update `notes/DECISIONS.md` with the blocking decision.
- Prefer a shippable MVP with one excellent hook over multiple half-built systems.
