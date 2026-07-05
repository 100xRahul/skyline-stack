import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import { createPost } from '../core/post';
import { todayUtc } from '../../shared/seed';

const menu = new Hono();

const postScope = (postId: string) => postId.replace(/[^a-zA-Z0-9_-]/g, '_');
const floorNamesKey = (postId: string, date: string) =>
  `skyline:${postScope(postId)}:${date}:floor-names`;

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();
    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      },
      200
    );
  } catch (err) {
    console.error('post-create failed', err);
    return c.json<UiResponse>({ showToast: 'Failed to create skyline post' }, 400);
  }
});

menu.post('/clear-floor-tags', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { targetId?: string };
    const postId = body.targetId ?? context.postId;
    if (!postId) {
      return c.json<UiResponse>(
        { showToast: 'Open this from a Skyline post to clear tags' },
        400
      );
    }
    const key = floorNamesKey(postId, todayUtc());
    const names = (await redis.hGetAll(key)) ?? {};
    const fields = Object.keys(names);
    if (fields.length > 0) {
      await redis.hDel(key, fields);
    }
    return c.json<UiResponse>(
      {
        showToast:
          fields.length > 0
            ? `Cleared ${fields.length} floor tag${fields.length === 1 ? '' : 's'}`
            : 'No floor tags to clear today',
      },
      200
    );
  } catch (err) {
    console.error('clear-floor-tags failed', err);
    return c.json<UiResponse>({ showToast: 'Failed to clear floor tags' }, 400);
  }
});

export { menu };
