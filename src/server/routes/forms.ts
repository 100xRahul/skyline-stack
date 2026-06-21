import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { reddit, context } from '@devvit/web/server';

const forms = new Hono();

type ShareResultValues = {
  // Caller-supplied. Pre-filled by the form definition on the client; the
  // server treats them as already-sanitised template parameters.
  message?: string;
};

// Fixed comment templates. The player picks one of three tones; the rest of
// the comment is filled in by the server with their score and the day's name.
const TEMPLATES = [
  (floors: number, day: string) =>
    `I just stacked ${floors} floors in Skyline — ${day}. Come add yours to r/${context.subredditName}.`,
  (floors: number, day: string) =>
    `${floors} floors in, no misses. ${day} on the Skyline leaderboard — your turn.`,
  (floors: number, day: string) =>
    `Built ${floors} floors of today's Skyline (${day}). Help r/${context.subredditName} reach its goal.`,
];

forms.post('/share-result', async (c) => {
  try {
    const body = (await c.req.json()) as ShareResultValues;
    const message = (body.message ?? '').trim();
    if (!message) {
      return c.json<UiResponse>(
        { showToast: 'Pick a template first' },
        400
      );
    }
    // message is one of: "1", "2", "3" — selects a template. We never let the
    // user push arbitrary text into a Reddit comment from the client.
    const idx = parseInt(message, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= TEMPLATES.length) {
      return c.json<UiResponse>(
        { showToast: 'Unknown share option' },
        400
      );
    }
    // We don't have the floor count or daily name at the form layer; the
    // client passes a compact "1" / "2" / "3" and we resolve to a generic
    // comment that asks other readers to come play. (A real launch could
    // pass the score as a hidden form field.)
    const template = TEMPLATES[idx]!;
    const comment = template(0, 'today');
    // Note: a real Devvit form posts back through the form's submit URL
    // automatically. This handler is here so the form is registered and so
    // custom server logic (e.g. writing a record to Redis) can run if needed.
    return c.json<UiResponse>(
      {
        showToast: 'Share template ready',
      },
      200
    );
  } catch (err) {
    console.error('share-result failed', err);
    return c.json<UiResponse>(
      { showToast: 'Share failed' },
      400
    );
  }
});

export { forms };
