import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';

const forms = new Hono();

// Legacy Devvit-form endpoint. The original share form had no fields, so the
// body is empty and we just acknowledge it. Real client-side share posts
// go to the dedicated /api/share-result endpoint in api.ts.
forms.post('/share-result', async (c) => {
  return c.json<UiResponse>(
    { showToast: 'Use the in-game share button' },
    200
  );
});

export { forms };
