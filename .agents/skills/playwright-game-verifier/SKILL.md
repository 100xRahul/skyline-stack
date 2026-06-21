---
name: playwright-game-verifier
description: Verify Reddit hackathon game pages with browser or Playwright automation across desktop and mobile.
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(npm:*)
---

# Playwright Game Verifier Skill

Use this skill when the Reddit hackathon app has a runnable Devvit playtest URL, localhost URL, or deployed demo URL.

## Purpose

Verify the game as a player would see it. Do not stop at build success. A hackathon game must look right, fit mobile, and be playable in the browser.

## Before running

Read:

1. `AGENTS.md`
2. `harness/05-quality-gates.md`
3. `harness/08-skills-and-tools.md`

Find the actual URL from the running command output, Devvit playtest, or user-provided demo link.

## Checks

Run a desktop and mobile pass:

- Page loads without fatal console errors.
- Main game surface/canvas is visible and nonblank.
- First screen is understandable without docs.
- Start/play action works.
- Core action changes game state.
- Score/result/failure/win feedback is visible.
- Retry works.
- Text does not overlap or overflow.
- Controls fit on mobile.
- Any daily/community state is visible or gracefully absent.

## Evidence

Write results to `notes/VERIFY.md`.

Include:

- URL tested.
- Viewports tested.
- Console errors.
- Screenshot or trace paths.
- Bugs found.
- Fix status.

## Tool preference

Use whichever browser automation tool is available in the current agent environment:

- Copilot/browser tool if present.
- Playwright CLI skill if present.
- `npx playwright` or project Playwright tests if the project already has Playwright installed.

Do not add Playwright dependencies unless browser verification is blocked and the user or project context allows adding dev dependencies.
