---
name: reddit-hackathon-builder
description: Build, review, verify, and prepare a Reddit Devvit Web game for the Reddit Games with a Hook Hackathon.
allowed-tools: Bash(npm:*) Bash(curl.md:*) Bash(node:*) Bash(find:*) Bash(sed:*)
---

# Reddit Hackathon Builder Skill

Use this skill when working in `/Users/rahulm/Downloads/reddit-hackathon` on concept design, Devvit scaffolding, game implementation, polish, verification, or submission prep.

## First read

Read these files before making decisions:

1. `AGENTS.md`
2. `harness/01-hackathon-brief.md`
3. `harness/02-devvit-platform.md`
4. `harness/03-product-strategy.md`
5. `harness/04-build-workflow.md`
6. `harness/05-quality-gates.md`
7. `harness/08-skills-and-tools.md`

## Operating mode

- Build the actual playable experience first, not a landing page.
- Prefer a small, polished, daily-return game over a large concept.
- Keep all mechanics compatible with Devvit Web limits.
- Use Phaser only where it improves game feel or interaction.
- Keep the game Reddit-native: shared post state, async play, subreddit identity, leaderboards, daily prompts, community goals, or safe user contributions.
- Preserve legal and platform safety: owned/licensed assets, no Reddit IP misuse, no restricted categories, no abuse-prone UGC.

## Output expectations

- If planning, create or update `notes/GAME_SPEC.md` from `templates/GAME_SPEC.md`.
- If implementing, inspect the generated Devvit app structure first.
- If verifying, run available `npm` scripts and do browser/playtest checks where possible.
- If preparing a submission, fill `templates/SUBMISSION.md` into `notes/SUBMISSION_DRAFT.md`.
