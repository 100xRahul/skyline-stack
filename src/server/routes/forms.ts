import { Hono } from 'hono';
import { reddit, context } from '@devvit/web/server';
import { dailyChallengeName, todayUtc } from '../../shared/seed';

const forms = new Hono();

// Three comment tones the player can pick from the end-of-run overlay. The
// template function receives the player's actual floor count and today's
// named day, so the resulting comment is specific to *this* run (not a
// generic stub like "0 floors today"). Subreddit name is read from the
// server context at submission time.
const TEMPLATES = [
  (floors: number, day: string) =>
    `I just stacked ${floors} floors in Skyline — ${day}. Come add yours to r/${context.subredditName}.`,
  (floors: number, day: string) =>
    `${floors} floors in, no misses. ${day} on the Skyline leaderboard — your turn.`,
  (floors: number, day: string) =>
    `Built ${floors} floors of today's Skyline (${day}). Help r/${context.subredditName} reach its goal.`,
];

type ShareResultBody = {
  // Which template to use (1-indexed). Anything outside [1,3] is rejected.
  template?: number;
  // Caller-supplied floor count. We sanitise: must be a non-negative integer.
  floors?: number;
  // Optional override; if absent we resolve the day name from today's UTC date.
  dayName?: string;
};

// Client-facing API: posts a real Reddit comment with the player's score
// and today's day name filled in. Replaces the previous form-based stub
// that hardcoded `template(0, 'today')`.
forms.post('/api/share-result', async (c) => {
  try {
    const body = (await c.req.json()) as ShareResultBody;
    const templateIdx = Math.floor(Number(body.template ?? 1)) - 1;
    if (
      !Number.isInteger(templateIdx) ||
      templateIdx < 0 ||
      templateIdx >= TEMPLATES.length
    ) {
      return c.json({ ok: false, error: 'invalid template' }, 400);
    }
    const floors = Math.max(0, Math.floor(Number(body.floors ?? 0)));
    const day = (body.dayName ?? '').trim() || dailyChallengeName(todayUtc());
    const text = TEMPLATES[templateIdx]!(floors, day);

    // Post the comment on the current post as the app account. This is a
    // user-initiated share, so it's safe to publish.
    const postId = context.postId as `t3_${string}` | undefined;
    if (!postId) {
      return c.json({ ok: false, error: 'no post context' }, 400);
    }
    await reddit.submitComment({ id: postId, text, runAs: 'APP' });
    return c.json({ ok: true, posted: text }, 200);
  } catch (err) {
    console.error('share-result failed', err);
    return c.json({ ok: false, error: 'share failed' }, 500);
  }
});

// Legacy form endpoint — kept so the entry in devvit.json is still valid.
// The form has no fields, so the body is empty and we just acknowledge it.
forms.post('/share-result', async (c) => {
  return c.json({ showToast: 'Use the in-game share button' }, 200);
});

export { forms };
