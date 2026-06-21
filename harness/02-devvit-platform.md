# Devvit Platform Notes

Sources read on June 21, 2026:

- `https://developers.reddit.com/docs/quickstart`
- `https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview`
- `https://developers.reddit.com/docs/introduction/intro-games`
- `https://developers.reddit.com/docs/guides/best-practices/community_games`
- `https://developers.reddit.com/docs/devvit_rules`

## Baseline

- Node.js 22.2.0 or newer is required by the quickstart.
- New apps are created from `https://developers.reddit.com/new`.
- Choose a Devvit Web template. For this hackathon, prefer Phaser if the concept benefits from animation, physics, scene structure, or game feel.
- `npm run dev` starts Devvit playtest flow, creates a dev subreddit/test post, and is the realistic runtime path.

Expected app shape:

```text
src/client/
src/server/
src/shared/
devvit.json
package.json
```

## Client and server

- Client code uses `@devvit/client`.
- Server code uses `@devvit/server`.
- Server endpoints must start with `/api/`.
- Client should call the app server, not arbitrary external services.
- Backend can fetch external services when needed and allowed.
- Use Redis or Devvit storage for persistent state. Do not rely on `localStorage` for durable game progress because app updates can clear it.

## Limits to design around

- No streaming responses, chunked responses, or WebSockets.
- Serverless endpoint max duration is about 30 seconds.
- Request payload limit is about 4 MB.
- Response payload limit is about 10 MB.
- No `fs` access or external native packages in server runtime.
- HTML/CSS/JS only on the client side.

## Review and launch

- `npm run launch` uploads an app for review.
- App review is required before broad public installs, especially on subreddits over 200 members.
- Demo post and app listing must remain available through judging.

## Rules to respect

- No harmful, illegal, deceptive, spammy, gambling, financial, crypto, political, adult, healthcare, or restricted-category mechanics.
- Do not force user actions such as posting/commenting/voting/sharing as progress gates.
- User actions must be explicit, optional, and manual.
- Do not ask for passwords or credentials.
- Minimize data collection.
- Attribute and make new user-generated content reportable/removable.
- Do not use Reddit trademarks, Snoo, or Reddit-owned IP without approval.
- Use only owned or properly licensed assets.
- If using LLMs, use only approved providers and keep privacy/compliance requirements in scope. Prefer no LLM dependency unless it is central to the hook.

