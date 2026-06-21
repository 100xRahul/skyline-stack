# Skills And Tools

This workspace is a Copilot harness. It should give the agent context and operating rules, not replace the app.

## Automatic context

Copilot should load:

- `AGENTS.md`
- `.github/copilot-instructions.md`

The local skill is available at:

- `.agents/skills/reddit-hackathon-builder/SKILL.md`
- `.agents/skills/playwright-game-verifier/SKILL.md`

Use the builder skill whenever planning, building, reviewing, verifying, or drafting the submission.
Use the Playwright verifier whenever there is a runnable page, Devvit playtest URL, or demo post that can be opened in a browser.

## Recommended agent behavior

- Use subagents for independent research, codebase inspection, asset/source checks, and docs refreshes.
- Keep implementation decisions in `notes/DECISIONS.md`.
- Keep the current concept in `notes/GAME_SPEC.md`.
- Keep test and playtest findings in `notes/VERIFY.md`.
- Use `curl.md <url>` for page content refreshes.
- Use browser automation or Playwright-style verification when a dev/playtest URL is running.
- Use image generation or asset tools only for owned/generated art, then document source and license assumptions.

## Tooling stance

Do not add random frameworks because they are interesting. Choose the smallest stack that can ship:

- Devvit Web is mandatory.
- React is the default UI layer.
- Phaser is preferred when the game needs animation, physics, scenes, camera, particles, sprites, or strong game feel.
- Three.js is only for a game where 3D is the core experience.
- Redis or Devvit storage should hold durable state.

## Playwright CLI install

If `playwright-cli` is not available in the environment, install the CLI and AGENTS-compatible skill files from the repo root:

```bash
npm install -g @playwright/cli@latest
playwright-cli install --skills agents
playwright-cli install-browser chromium
```

Notes:

- `playwright-cli install --skills` defaults to Claude-style skill output.
- Use `--skills agents` for this Copilot/AGENTS workspace.
- Browser install is separate; use Chromium by default unless the bug is browser-specific.

## Verification tools

Use available commands first:

```bash
npm run harness:check
npm run build
npm run lint
npm run typecheck
npm run dev
```

Then visually verify:

- Desktop viewport.
- Mobile viewport.
- First play.
- Retry.
- Daily/retention mechanic.
- Community/state mechanic.

Record Playwright findings in `notes/VERIFY.md` with screenshots or trace paths when available.

## Playwright checks

When a game URL exists, run browser verification rather than relying on code review only:

- Load the page at desktop size.
- Load the page at mobile size.
- Check console errors.
- Check that the canvas or game surface is nonblank.
- Click/tap through first play.
- Confirm retry works.
- Confirm UI text does not overlap.
- Confirm controls fit and remain usable.
- Capture screenshot paths for evidence.
