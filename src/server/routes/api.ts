import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  ErrorResponse,
  InitResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  ScoreSubmission,
  SubmitResponse,
} from '../../shared/api';
import {
  DAILY_TTL_SECONDS,
  buildDailySeed,
  todayUtc,
  yesterdayUtc,
} from '../../shared/seed';

const api = new Hono();

// Redis key helpers. We namespace by the UTC day so that:
// - Every player in the subreddit shares the same community tower for the day.
// - The daily seed resets at UTC midnight.
// - Per-user personal best is per (user, day) so daily leaderboards are honest.
const dayKey = (date: string) => `skyline:${date}`;
const floorsKey = (date: string) => `skyline:${date}:floors`;
// Today's builders, stored as a sorted set keyed by username with the player's
// best floor count for the day as the score. zAdd dedupes by member, so each
// player appears once and their score tracks their personal best for the day.
const buildersKey = (date: string) => `skyline:${date}:builders`;
// Tracks which players landed a perfect run today (hash username -> "1").
const perfectKey = (date: string) => `skyline:${date}:perfect`;
const personalKey = (date: string, username: string) =>
  `skyline:${date}:pb:${username.toLowerCase()}`;
// Streak survives across days, so it is stored as a hash with the run count and
// the last UTC day the player contributed. It is not part of the daily reset.
const streakKey = (username: string) =>
  `skyline:streak:${username.toLowerCase()}`;
// Streak data is kept for 60 days of inactivity, then garbage-collected.
const STREAK_TTL_SECONDS = 60 * 24 * 60 * 60;

// Read the top contributors for a day, joining the builders sorted set with the
// perfect-run hash so the leaderboard can flag perfect players.
async function readLeaderboard(
  date: string,
  limit: number
): Promise<LeaderboardEntry[]> {
  const rows = await redis.zRange(buildersKey(date), 0, limit - 1, {
    reverse: true,
    by: 'score',
  });
  if (rows.length === 0) return [];
  const perfects = await redis.hGetAll(perfectKey(date));
  return rows.map((row) => ({
    username: row.member,
    floors: row.score,
    perfect: perfects?.[row.member.toLowerCase()] === '1',
  }));
}

async function readStreak(username: string): Promise<number> {
  const data = await redis.hGetAll(streakKey(username));
  return data?.count ? parseInt(data.count, 10) : 0;
}

// True if the community reached its goal on the given UTC date. Used to unlock
// the bonus palette the next day. Yesterday's floors key is still readable
// because daily keys carry a 36h TTL.
async function goalReachedOn(date: string): Promise<boolean> {
  const raw = await redis.get(floorsKey(date));
  const floors = raw ? parseInt(raw, 10) : 0;
  if (floors <= 0) return false;
  return floors >= buildDailySeed(date, floors).communityGoal;
}

api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId missing from context' },
      400
    );
  }
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const date = todayUtc();
    const communityFloorsRaw = await redis.get(floorsKey(date));
    const communityFloors = communityFloorsRaw
      ? parseInt(communityFloorsRaw, 10)
      : 0;
    const goalUnlocked = await goalReachedOn(yesterdayUtc());
    const daily = buildDailySeed(date, communityFloors, goalUnlocked);
    const pbRaw = await redis.get(personalKey(date, username));
    const personalBest = pbRaw ? parseInt(pbRaw, 10) : 0;
    const streak = await readStreak(username);
    // Streak is at risk if the player has an active streak and yesterday is
    // the most recent day they played — i.e. the streak expires at UTC midnight.
    const streakData = await redis.hGetAll(streakKey(username));
    const lastDay = streakData?.last;
    const streakAtRisk =
      !!lastDay && lastDay === yesterdayUtc() && streak > 0;
    const builders = await redis.zCard(buildersKey(date));
    const leaderboard = await readLeaderboard(date, 10);

    return c.json<InitResponse>({
      type: 'init',
      postId,
      username,
      daily,
      communityFloors,
      personalBest,
      streak,
      builders,
      leaderboard,
      streakAtRisk,
    });
  } catch (err) {
    console.error('init failed', err);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: err instanceof Error ? err.message : 'init failed',
      },
      500
    );
  }
});

api.post('/submit', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId missing from context' },
      400
    );
  }
  try {
    const body = (await c.req.json()) as ScoreSubmission;
    const floors = Math.max(0, Math.min(99, Math.floor(body.floors ?? 0)));
    const perfect = !!body.perfect && floors > 0;
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const date = todayUtc();

    // Mark the day so the key set is consistent, then add this run's floors to
    // the shared community total.
    await redis.set(dayKey(date), '1');
    await redis.expire(dayKey(date), DAILY_TTL_SECONDS);
    const after = await redis.incrBy(floorsKey(date), floors);
    await redis.expire(floorsKey(date), DAILY_TTL_SECONDS);

    // Personal best for the day.
    const pbRaw = await redis.get(personalKey(date, username));
    const prevPb = pbRaw ? parseInt(pbRaw, 10) : 0;
    const newPb = Math.max(prevPb, floors);
    const improvedPb = floors > prevPb;
    if (improvedPb) {
      await redis.set(personalKey(date, username), String(newPb));
      await redis.expire(personalKey(date, username), DAILY_TTL_SECONDS);
    }

    // Record the player as a builder, scored by their daily best. zAdd dedupes
    // by member so repeat runs update the same entry instead of stacking.
    if (floors > 0) {
      await redis.zAdd(buildersKey(date), { member: username, score: newPb });
      await redis.expire(buildersKey(date), DAILY_TTL_SECONDS);
    }
    if (perfect) {
      await redis.hSet(perfectKey(date), { [username.toLowerCase()]: '1' });
      await redis.expire(perfectKey(date), DAILY_TTL_SECONDS);
    }

    // Streak: bump only once per UTC day. Consecutive days increment; a skipped
    // day resets to 1. This is computed server-side from the stored last-play
    // date so it cannot be spoofed by the client.
    let streak = await readStreak(username);
    if (floors > 0) {
      const data = await redis.hGetAll(streakKey(username));
      const lastDay = data?.last;
      if (lastDay !== date) {
        if (lastDay === yesterdayUtc()) streak += 1;
        else streak = 1;
        await redis.hSet(streakKey(username), {
          count: String(streak),
          last: date,
        });
        await redis.expire(streakKey(username), STREAK_TTL_SECONDS);
      }
    }

    const goal = buildDailySeed(date, after).communityGoal;
    const goalReached = after >= goal;
    const builders = await redis.zCard(buildersKey(date));
    const leaderboard = await readLeaderboard(date, 10);

    return c.json<SubmitResponse>({
      type: 'submit',
      communityFloors: after,
      floorsAdded: floors,
      goalReached,
      personalBest: newPb,
      improvedPb,
      streak,
      builders,
      leaderboard,
    });
  } catch (err) {
    console.error('submit failed', err);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: err instanceof Error ? err.message : 'submit failed',
      },
      500
    );
  }
});

api.get('/leaderboard', async (c) => {
  try {
    const date = todayUtc();
    const entries = await readLeaderboard(date, 10);
    return c.json<LeaderboardResponse>({
      type: 'leaderboard',
      date,
      entries,
    });
  } catch (err) {
    console.error('leaderboard failed', err);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: err instanceof Error ? err.message : 'leaderboard failed',
      },
      500
    );
  }
});

export { api };
