import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';

const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createPost();
    const input = await c.req.json<OnAppInstallRequest>();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Skyline installed in r/${context.subredditName} (post ${post.id}, trigger: ${input.type})`,
      },
      200
    );
  } catch (err) {
    console.error('on-app-install failed', err);
    return c.json<TriggerResponse>(
      { status: 'error', message: 'Failed to create initial post' },
      400
    );
  }
});

export { triggers };
