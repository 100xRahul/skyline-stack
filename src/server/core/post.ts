import { reddit } from '@devvit/web/server';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    title: "Skyline — today's stack challenge",
    splash: undefined,
  });
};
