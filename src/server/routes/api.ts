import { Hono } from 'hono';
import { context, redis, reddit, realtime } from '@devvit/web/server';
import type {
  ErrorResponse,
  HeartbeatResponse,
  InitResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  RealtimeMessage,
  ScoreSubmission,
  SubmitResponse,
} from '../../shared/api';
import { FLOOR_NAME_CHOICES, realtimeChannel } from '../../shared/api';
import {
  DAILY_TTL_SECONDS,
  TOWER_START_WIDTH,
  buildDailySeed,
  dailyChallengeName,
  reshapeTower,
  todayUtc,
  yesterdayUtc,
} from '../../shared/seed';

const api = new Hono();

// Redis key helpers. We namespace by the UTC day so that:
// - Every player in the subreddit shares the same community tower for the day.
// - The daily seed resets at UTC midnight.
// - Per-user personal best is per (user, day) so daily leaderboards are honest.
const postScope = (postId: string) => postId.replace(/[^a-zA-Z0-9_-]/g, '_');
const scopedDailyKey = (postId: string, date: string, suffix: string) =>
  `skyline:${postScope(postId)}:${date}:${suffix}`;
const floorsKey = (postId: string, date: string) =>
  scopedDailyKey(postId, date, 'floors');
// Current width of the shared tower's top floor for the day. The sub narrows
// this single value across the day; every builder inherits it and narrows it a
// little more. Absent until the first run, where it defaults to the start width.
const widthKey = (postId: string, date: string) =>
  scopedDailyKey(postId, date, 'topwidth');
// Today's builders, stored as a sorted set keyed by username with the player's
// best floor count for the day as the score. zAdd dedupes by member, so each
// player appears once and their score tracks their personal best for the day.
const buildersKey = (postId: string, date: string) =>
  scopedDailyKey(postId, date, 'builders');
// Tracks which players landed a perfect run today (hash username -> "1").
const perfectKey = (postId: string, date: string) =>
  scopedDailyKey(postId, date, 'perfect');
// Owners of milestone floors (hash floorNumber -> username). First player to
// cross a milestone floor owns it for the day.
const ownersKey = (postId: string, date: string) =>
  scopedDailyKey(postId, date, 'owners');
// Player-named labels for claimed milestone floors (hash floorNumber -> name).
// This is the user-contribution surface: the player can name the floor they
// claim with a single short word (max 12 chars, sanitised). Names render on
// the milestone tag in the tower for everyone in the sub.
const floorNamesKey = (postId: string, date: string) =>
  scopedDailyKey(postId, date, 'floor-names');
// Id of today's sticky "activity" comment on the post (t1_...). Every
// generic/automated per-run comment (floor tags, score shares) is posted as
// a reply to this comment, authored as the player, so it is reportable and
// actionable through Reddit's normal comment tooling instead of living only
// inside the game canvas.
const stickyCommentKey = (postId: string, date: string) =>
  scopedDailyKey(postId, date, 'stickycomment');
// Sparse width history: hash of communityFloorCount -> tower width after the
// run that ended at that count. The client interpolates between samples to
// draw the shared tower's true carved silhouette for the day.
const widthHistoryKey = (postId: string, date: string) =>
  scopedDailyKey(postId, date, 'widthhist');
// Misc per-day flags (e.g. whether the goal-reached comment was posted) plus
// the last-builder handoff fields (lastBuilder / lastBuilderAt /
// lastBuilderPerfect) that drive the "u/X handed you the tower" line.
const metaKey = (postId: string, date: string) =>
  scopedDailyKey(postId, date, 'meta');
// Live presence: hash of sessionId -> last-seen epoch ms. Drives the "N
// building now" pill. Self-cleaning — stale fields are pruned on each
// heartbeat and the whole key expires shortly after the last heartbeat.
const presenceKey = (postId: string, date: string) =>
  scopedDailyKey(postId, date, 'presence');
// A session counts as "active" if it has pinged within this window.
const PRESENCE_ACTIVE_MS = 35_000;
// The presence hash expires this long after the last heartbeat touches it.
const PRESENCE_TTL_SECONDS = 120;

// A floor number is a "milestone" worth claiming if it is a multiple of 5 or
// it is exactly the day's community goal.
function isMilestone(floor: number, goal: number): boolean {
  return floor > 0 && (floor % 5 === 0 || floor === goal);
}
const personalKey = (postId: string, date: string, username: string) =>
  scopedDailyKey(postId, date, `pb:${username.toLowerCase()}`);
// Streak survives across days, so it is stored as a hash with the run count and
// the last UTC day the player contributed. It is not part of the daily reset.
const streakKey = (username: string) =>
  `skyline:streak:${username.toLowerCase()}`;
// Lifetime totals (all-time floors, perfects, runs). Persistent across days.
const lifetimeFloorsKey = (username: string) =>
  `skyline:lt:floors:${username.toLowerCase()}`;
const lifetimePerfectsKey = (username: string) =>
  `skyline:lt:perfects:${username.toLowerCase()}`;
// Hash of unlocked achievement ids (field = achievement id, value = "1").
// Using a hash because Devvit's Redis doesn't expose the SET data type.
const achievementsKey = (username: string) =>
  `skyline:ach:${username.toLowerCase()}`;
// Per-user rolling rate-limit bucket. We use a 1-minute window with a
// counter that auto-expires. The window is a per-(minute, endpoint) key
// so the limit is independent across endpoints.
const rateLimitKey = (username: string, endpoint: string) =>
  `skyline:rl:${endpoint}:${username.toLowerCase()}:${Math.floor(Date.now() / 60_000)}`;
const runTokenKey = (
  postId: string,
  date: string,
  username: string,
  token: string
) => scopedDailyKey(
  postId,
  date,
  `run:${username.toLowerCase()}:${token}`
);
// Streak data is kept for 60 days of inactivity, then garbage-collected.
const STREAK_TTL_SECONDS = 60 * 24 * 60 * 60;
// Lifetime totals and achievements are permanent — no TTL is set on them.
const RUN_TOKEN_TTL_SECONDS = 180;

// Cheap per-minute rate limiter. Returns true when the user is over the
// limit. We use Redis incrBy + a 70s TTL on the bucket so the counter
// self-cleans even if the player goes idle. The TTL is slightly longer
// than the window so a request that lands at the very end of one window
// and the start of the next still observes a consistent count.
async function isRateLimited(
  username: string,
  endpoint: string,
  limit: number
): Promise<boolean> {
  const key = rateLimitKey(username, endpoint);
  const count = await redis.incrBy(key, 1);
  if (count === 1) {
    await redis.expire(key, 70);
  }
  return count > limit;
}

function newToken(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid.replace(/-/g, '');
  } catch {
    // fall through to simple token
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function issueRunToken(
  postId: string,
  date: string,
  username: string
): Promise<string> {
  const token = newToken().replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  await redis.set(runTokenKey(postId, date, username, token), String(Date.now()));
  await redis.expire(runTokenKey(postId, date, username, token), RUN_TOKEN_TTL_SECONDS);
  return token;
}

async function validateRunToken(
  postId: string,
  date: string,
  username: string,
  token: unknown
): Promise<{ ok: true; maxFloors: number } | { ok: false; message: string }> {
  if (typeof token !== 'string') {
    return { ok: false, message: 'Run expired. Start a fresh stack.' };
  }
  const clean = token.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  if (!clean) return { ok: false, message: 'Run expired. Start a fresh stack.' };
  const key = runTokenKey(postId, date, username, clean);
  const raw = await redis.get(key);
  if (!raw || raw === 'used') {
    return { ok: false, message: 'Run expired. Start a fresh stack.' };
  }
  await redis.set(key, 'used');
  await redis.expire(key, 15);
  const startedAt = parseInt(raw, 10);
  const elapsedMs = Number.isFinite(startedAt) ? Date.now() - startedAt : 0;
  // A real run needs a visible swing + landing animation per floor. The buffer
  // keeps the check generous for fast players and device jitter while making
  // instant 99-floor submissions ineligible.
  const maxFloors = Math.max(1, Math.min(99, Math.floor(elapsedMs / 260) + 6));
  return { ok: true, maxFloors };
}

// Read the top contributors for a day, joining the builders sorted set with the
// perfect-run hash so the leaderboard can flag perfect players.
async function readLeaderboard(
  postId: string,
  date: string,
  limit: number
): Promise<LeaderboardEntry[]> {
  const rows = await redis.zRange(buildersKey(postId, date), 0, limit - 1, {
    reverse: true,
    by: 'score',
  });
  if (rows.length === 0) return [];
  const perfects = await redis.hGetAll(perfectKey(postId, date));
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

// Read the shared tower's current top-floor width. Defaults to the start width
// before anyone has played today.
async function readTowerWidth(postId: string, date: string): Promise<number> {
  const raw = await redis.get(widthKey(postId, date));
  const w = raw ? parseInt(raw, 10) : TOWER_START_WIDTH;
  return Number.isFinite(w) ? w : TOWER_START_WIDTH;
}

async function readFloorOwners(
  postId: string,
  date: string
): Promise<Record<string, string>> {
  return (await redis.hGetAll(ownersKey(postId, date))) ?? {};
}

async function readFloorNames(
  postId: string,
  date: string
): Promise<Record<string, string>> {
  return (await redis.hGetAll(floorNamesKey(postId, date))) ?? {};
}

// Validate a player-selected floor label. This is the only UGC surface in the
// game, so it is intentionally curated rather than free-form: the client sends
// one of FLOOR_NAME_CHOICES, and the server canonicalises it before storage.
function sanitiseFloorName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    .toLowerCase();
  const canonical = FLOOR_NAME_CHOICES.find(
    (choice) => choice.toLowerCase() === cleaned
  );
  return canonical ?? null;
}

// Returns the id of today's sticky "activity" comment on this post, creating
// it (as the app account, distinguished + stickied) on first use. Every
// generic/automated per-run comment we post on a player's behalf (floor tags,
// score shares) replies to this comment as the player, so the content is
// reportable and actionable through Reddit's normal comment tooling — not
// only visible inside the game canvas. Best-effort: returns null on failure
// so callers can skip the reply instead of failing the run.
async function getOrCreateStickyComment(
  postId: `t3_${string}`,
  date: string
): Promise<`t1_${string}` | null> {
  try {
    const key = stickyCommentKey(postId, date);
    const existing = await redis.get(key);
    if (existing) return existing as `t1_${string}`;
    const comment = await reddit.submitComment({
      id: postId,
      text:
        "📌 Today's Skyline activity. Floor tags and shared scores from " +
        'players reply here — report or remove any reply the same way you ' +
        'would any other comment.',
      runAs: 'APP',
    });
    try {
      await comment.distinguish(true);
    } catch (e) {
      console.error('sticky comment distinguish failed', e);
    }
    await redis.set(key, comment.id);
    await redis.expire(key, DAILY_TTL_SECONDS);
    return comment.id;
  } catch (e) {
    console.error('sticky comment creation failed', e);
    return null;
  }
}

// Achievement definitions. The thresholds match the copy in the client UI
// so the server is the source of truth.
export const ACHIEVEMENT_DEFS: {
  id: 'first-stack' | 'ten-perfect' | 'week-streak' | 'fifty-floors';
  emoji: string;
  title: string;
  blurb: string;
}[] = [
  {
    id: 'first-stack',
    emoji: '🧱',
    title: 'First Stack',
    blurb: 'Add your first floor to the skyline',
  },
  {
    id: 'ten-perfect',
    emoji: '🎯',
    title: 'Sharpshooter',
    blurb: 'Finish 10 flawless runs across your career',
  },
  {
    id: 'week-streak',
    emoji: '🔥',
    title: 'On Fire',
    blurb: 'Stack on 7 different days in a row',
  },
  {
    id: 'fifty-floors',
    emoji: '🏙️',
    title: 'High-Rise',
    blurb: 'Stack 50 floors across your career',
  },
];

// Compute the current state of every achievement for a player. Cheap reads
// of streak + lifetime counters + the achievement set itself.
async function readAchievements(username: string): Promise<
  {
    id: (typeof ACHIEVEMENT_DEFS)[number]['id'];
    emoji: string;
    title: string;
    blurb: string;
    unlocked: boolean;
    progress: number;
    current: number;
    goal: number;
  }[]
> {
  const [streak, ltFloors, ltPerfects, achHash] = await Promise.all([
    readStreak(username),
    redis.get(lifetimeFloorsKey(username)),
    redis.get(lifetimePerfectsKey(username)),
    redis.hGetAll(achievementsKey(username)),
  ]);
  const set = new Set(Object.keys(achHash ?? {}));
  const floors = ltFloors ? parseInt(ltFloors, 10) : 0;
  const perfects = ltPerfects ? parseInt(ltPerfects, 10) : 0;
  // Return both the raw current count and the target so the client can
  // render a real "5/10" progress label and a proportional bar.
  return ACHIEVEMENT_DEFS.map((def) => {
    const unlockedNow = set.has(def.id);
    let prog = 0;
    let current = 0;
    let target = 1;
    if (def.id === 'first-stack') {
      const done = unlockedNow || floors > 0;
      current = done ? 1 : 0;
      target = 1;
      prog = done ? 1 : 0;
    } else if (def.id === 'ten-perfect') {
      current = perfects;
      target = 10;
      prog = Math.max(0, Math.min(1, current / target));
    } else if (def.id === 'week-streak') {
      current = streak;
      target = 7;
      prog = Math.max(0, Math.min(1, current / target));
    } else if (def.id === 'fifty-floors') {
      current = floors;
      target = 50;
      prog = Math.max(0, Math.min(1, current / target));
    }
    return {
      ...def,
      unlocked: unlockedNow || prog >= 1,
      progress: prog,
      current,
      goal: target,
    };
  });
}

// Post the once-per-day "goal reached" comment on the post, as the app account.
// Names the top builder so the announcement is recognisably community-driven.
async function announceGoal(
  postId: string,
  date: string,
  floors: number
): Promise<void> {
  const top = await readLeaderboard(postId, date, 1);
  const builders = await redis.zCard(buildersKey(postId, date));
  const topLine =
    top.length > 0 ? ` Top builder: u/${top[0]!.username} (${top[0]!.floors} floors).` : '';
  const text =
    `🏙️ The skyline topped out! Together you stacked ${floors} floors today` +
    ` and reached the goal — ${builders} builder${builders === 1 ? '' : 's'} so far.` +
    `${topLine} A fresh challenge unlocks at 00:00 UTC. Tap the post to add your floors.`;
  await reddit.submitComment({ id: postId as `t3_${string}`, text, runAs: 'APP' });
}

// True if the community reached its goal on the given UTC date. Used to unlock
// the bonus palette the next day. Yesterday's floors key is still readable
// because daily keys carry a 36h TTL.
async function goalReachedOn(postId: string, date: string): Promise<boolean> {
  const raw = await redis.get(floorsKey(postId, date));
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
    // Per-user rate limit: 30 init calls per minute. Generous enough to
    // cover retries, hot-reloads, and dev-tools tinkering.
    if (await isRateLimited(username, 'init', 30)) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'Too many requests' },
        429
      );
    }
    const date = todayUtc();
    const communityFloorsRaw = await redis.get(floorsKey(postId, date));
    const communityFloors = communityFloorsRaw
      ? parseInt(communityFloorsRaw, 10)
      : 0;
    const goalUnlocked = await goalReachedOn(postId, yesterdayUtc());
    // Fan out the remaining independent reads in parallel — they don't depend
    // on each other. The previous day's base palette lives in the daily
    // meta hash; we read it here so the base-palette "no repeats" check
    // is correct on a single round-trip.
    const [
      pbRaw,
      streak,
      streakData,
      builders,
      leaderboard,
      floorOwners,
      floorNames,
      achievements,
      previousBaseRaw,
      towerWidth,
      widthHistRaw,
      todayMeta,
    ] = await Promise.all([
      redis.get(personalKey(postId, date, username)),
      readStreak(username),
      redis.hGetAll(streakKey(username)),
      redis.zCard(buildersKey(postId, date)),
      readLeaderboard(postId, date, 10),
      readFloorOwners(postId, date),
      readFloorNames(postId, date),
      readAchievements(username),
      redis.hGet(metaKey(postId, yesterdayUtc()), 'basePalette'),
      readTowerWidth(postId, date),
      redis.hGetAll(widthHistoryKey(postId, date)),
      redis.hGetAll(metaKey(postId, date)),
    ]);
    // Parse the width history into numbers, dropping anything malformed.
    const towerHistory: Record<string, number> = {};
    for (const [floor, w] of Object.entries(widthHistRaw ?? {})) {
      const f = parseInt(floor, 10);
      const width = parseInt(w, 10);
      if (Number.isFinite(f) && f > 0 && Number.isFinite(width)) {
        towerHistory[String(f)] = width;
      }
    }
    // Last-builder handoff: who reshaped the tower last and how long ago.
    const lastAt = parseInt(todayMeta?.lastBuilderAt ?? '', 10);
    const lastBuilder =
      todayMeta?.lastBuilder && Number.isFinite(lastAt)
        ? {
            username: todayMeta.lastBuilder,
            agoMs: Math.max(0, Date.now() - lastAt),
            perfect: todayMeta.lastBuilderPerfect === '1',
          }
        : null;
    const previousBase =
      previousBaseRaw === '0' || previousBaseRaw === '1' || previousBaseRaw === '2'
        ? (parseInt(previousBaseRaw, 10) as 0 | 1 | 2)
        : null;
    const daily = buildDailySeed(date, communityFloors, goalUnlocked, previousBase);
    // Persist today's base palette for tomorrow's anti-repeat check. We
    // only record the base (0/1/2) — the aurora bonus (3) is overlaid at
    // draw time, never stored.
    await redis.hSet(metaKey(postId, date), {
      basePalette: String(daily.basePalette),
    });
    await redis.expire(metaKey(postId, date), DAILY_TTL_SECONDS);
    const runToken = await issueRunToken(postId, date, username);
    const personalBest = pbRaw ? parseInt(pbRaw, 10) : 0;
    // Streak is at risk if the player has an active streak and yesterday is
    // the most recent day they played — i.e. the streak expires at UTC midnight.
    const lastDay = streakData?.last;
    const streakAtRisk =
      !!lastDay && lastDay === yesterdayUtc() && streak > 0;

    return c.json<InitResponse>({
      type: 'init',
      postId,
      username,
      subredditName: context.subredditName ?? '',
      daily,
      communityFloors,
      towerWidth,
      towerHistory,
      lastBuilder,
      personalBest,
      streak,
      builders,
      leaderboard,
      streakAtRisk,
      floorOwners,
      floorNames,
      achievements,
      runToken,
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
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    // Rate limit: 20 submits per minute. A normal player submits once
    // per run (30s) and a fast double-tap stack is the worst case, so
    // 20 is well above the human ceiling and well below a script.
    if (await isRateLimited(username, 'submit', 20)) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'Too many runs. Slow down.' },
        429
      );
    }
    const body = (await c.req.json()) as ScoreSubmission;
    const date = todayUtc();
    const requestedFloors = Math.max(
      0,
      Math.min(99, Math.floor(body.floors ?? 0))
    );
    let floors = requestedFloors;
    let perfect = !!body.perfect && floors > 0;
    if (requestedFloors > 0) {
      const tokenCheck = await validateRunToken(
        postId,
        date,
        username,
        body.runToken
      );
      if (!tokenCheck.ok) {
        return c.json<ErrorResponse>(
          { status: 'error', message: tokenCheck.message },
          400
        );
      }
      floors = Math.min(requestedFloors, tokenCheck.maxFloors);
      if (floors < requestedFloors) {
        console.warn('capped implausible skyline score', {
          username,
          requestedFloors,
          acceptedFloors: floors,
        });
        perfect = false;
      }
    }
    // Opaque session id, echoed in the live broadcast so the submitting tab can
    // ignore its own run. Strictly sanitised (it is reflected to other clients).
    const clientId =
      typeof body.clientId === 'string'
        ? body.clientId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
        : '';

    // Add this run's floors to the shared community total.
    const after = await redis.incrBy(floorsKey(postId, date), floors);
    await redis.expire(floorsKey(postId, date), DAILY_TTL_SECONDS);

    // Personal best for the day.
    const pbRaw = await redis.get(personalKey(postId, date, username));
    const prevPb = pbRaw ? parseInt(pbRaw, 10) : 0;
    const newPb = Math.max(prevPb, floors);
    const improvedPb = floors > prevPb;
    if (improvedPb) {
      await redis.set(personalKey(postId, date, username), String(newPb));
      await redis.expire(personalKey(postId, date, username), DAILY_TTL_SECONDS);
    }

    // Record the player as a builder, scored by their daily best. zAdd dedupes
    // by member so repeat runs update the same entry instead of stacking.
    if (floors > 0) {
      await redis.zAdd(buildersKey(postId, date), { member: username, score: newPb });
      await redis.expire(buildersKey(postId, date), DAILY_TTL_SECONDS);
    }
    if (perfect) {
      await redis.hSet(perfectKey(postId, date), { [username.toLowerCase()]: '1' });
      await redis.expire(perfectKey(postId, date), DAILY_TTL_SECONDS);
    }

    // Reshape the shared tower. The new width is computed entirely server-side
    // from floors added (never trusted from the client) and clamped to the
    // playable range. An ordinary run erodes the tower for the next builder; a
    // perfect run REPAIRS it — widens the top back out — so clean play is a
    // gift to the rest of the sub, not just a personal score.
    const currentWidth = await readTowerWidth(postId, date);
    const towerWidth = reshapeTower(currentWidth, floors, perfect);
    if (towerWidth !== currentWidth) {
      await redis.set(widthKey(postId, date), String(towerWidth));
      await redis.expire(widthKey(postId, date), DAILY_TTL_SECONDS);
    }
    // Record this run's mark on the tower: a width sample at the floor count
    // it ended at (so the carved silhouette is real history, not decoration)
    // and the handoff fields for the "u/X handed you the tower" line.
    if (floors > 0) {
      try {
        await redis.hSet(widthHistoryKey(postId, date), {
          [String(after)]: String(towerWidth),
        });
        await redis.expire(widthHistoryKey(postId, date), DAILY_TTL_SECONDS);
        await redis.hSet(metaKey(postId, date), {
          lastBuilder: username,
          lastBuilderAt: String(Date.now()),
          lastBuilderPerfect: perfect ? '1' : '0',
        });
        await redis.expire(metaKey(postId, date), DAILY_TTL_SECONDS);
      } catch (e) {
        // Cosmetic history — never fail the run over it.
        console.error('width history write failed', e);
      }
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
    const before = after - floors;

    // Claim any milestone floors this run crossed (community floors in the range
    // before < floor <= after). First player to cross a milestone owns it.
    const claimedFloors: number[] = [];
    if (floors > 0) {
      for (let floor = before + 1; floor <= after; floor++) {
        if (!isMilestone(floor, goal)) continue;
        const claimed = await redis.hSetNX(
          ownersKey(postId, date),
          String(floor),
          username
        );
        if (claimed === 1) claimedFloors.push(floor);
      }
      // Refresh the TTL after the writes so the key actually exists when we set
      // it (EXPIRE on a missing key is a no-op and would leave it immortal).
      await redis.expire(ownersKey(postId, date), DAILY_TTL_SECONDS);
    }

    // Player can optionally name a milestone floor they own (claimed in
    // this run or a previous run today). The server only persists the
    // name if the requesting player is the recorded owner. Names are
    // sanitised; see `sanitiseFloorName` for the rules.
    let nameAccepted = false;
    const requestedNameFloor = body.nameFloor;
    const requestedName = body.name;
    if (
      typeof requestedNameFloor === 'number' &&
      Number.isInteger(requestedNameFloor) &&
      requestedNameFloor > 0 &&
      typeof requestedName === 'string'
    ) {
      const clean = sanitiseFloorName(requestedName);
      if (clean) {
        try {
          const owners = await readFloorOwners(postId, date);
          if (owners[String(requestedNameFloor)]?.toLowerCase() === username.toLowerCase()) {
            await redis.hSet(floorNamesKey(postId, date), {
              [String(requestedNameFloor)]: clean,
            });
            // Refresh the TTL after the write — EXPIRE before the key exists is
            // a no-op and would leave the names hash immortal.
            await redis.expire(floorNamesKey(postId, date), DAILY_TTL_SECONDS);
            nameAccepted = true;
            // Floor tags are the game's only free-choice UGC surface (still
            // curated to FLOOR_NAME_CHOICES). Mirror the tag as a real reply
            // to today's sticky comment, authored as the player, so it has a
            // reportable/actionable home via Reddit's normal comment tooling
            // instead of living only inside the game canvas.
            try {
              const sticky = await getOrCreateStickyComment(
                postId as `t3_${string}`,
                date
              );
              if (sticky) {
                await reddit.submitComment({
                  id: sticky,
                  text: `Tagged floor ${requestedNameFloor} of today's skyline as "${clean}".`,
                  runAs: 'USER',
                });
              }
            } catch (e) {
              console.error('floor-tag comment failed', e);
            }
          }
        } catch (e) {
          console.error('floor-name write failed', e);
        }
      }
    }

    // Goal-reached celebration comment, posted once per day by the app account.
    // hSetNX guarantees only the first run that tips the tower over the goal
    // triggers it. Best-effort: a failure here never fails the run.
    if (goalReached) {
      try {
        const first = await redis.hSetNX(metaKey(postId, date), 'goalAnnounced', '1');
        if (first === 1) {
          await redis.expire(metaKey(postId, date), DAILY_TTL_SECONDS);
          await announceGoal(postId, date, after);
        }
      } catch (e) {
        console.error('goal announce failed', e);
      }
    }

    // Week-streak unlock happens once the streak reaches 7. The streak itself
    // is computed during the streak-update block above, so re-read it.
    const newlyUnlocked: string[] = [];
    if (streak >= 7) {
      try {
        const achHash = await redis.hGetAll(achievementsKey(username));
        if (!achHash || !achHash['week-streak']) {
          await redis.hSet(achievementsKey(username), { 'week-streak': '1' });
          newlyUnlocked.push('week-streak');
        }
      } catch (e) {
        console.error('week-streak check failed', e);
      }
    }

    // Lifetime counters and achievement checks. These are best-effort and
    // never fail the run — the player still gets their score saved.
    if (floors > 0 || perfect) {
      try {
        // Fire the two increments and the existing lifetime reads in parallel
        // so we don't wait for one before kicking off the other.
        const [newFloors, newPerfects] = await Promise.all([
          floors > 0
            ? redis.incrBy(lifetimeFloorsKey(username), floors)
            : redis.get(lifetimeFloorsKey(username)).then((v) => parseInt(v ?? '0', 10)),
          perfect
            ? redis.incrBy(lifetimePerfectsKey(username), 1)
            : redis
                .get(lifetimePerfectsKey(username))
                .then((v) => parseInt(v ?? '0', 10)),
        ]);
        const achHash = await redis.hGetAll(achievementsKey(username));
        const have = new Set(Object.keys(achHash ?? {}));
        const toUnlock: Record<string, string> = {};
        if (!have.has('first-stack') && newFloors > 0) toUnlock['first-stack'] = '1';
        if (!have.has('ten-perfect') && newPerfects >= 10) toUnlock['ten-perfect'] = '1';
        if (!have.has('fifty-floors') && newFloors >= 50) toUnlock['fifty-floors'] = '1';
        if (Object.keys(toUnlock).length > 0) {
          await redis.hSet(achievementsKey(username), toUnlock);
          newlyUnlocked.push(...Object.keys(toUnlock));
        }
      } catch (e) {
        console.error('lifetime update failed', e);
      }
    }

    // Independent reads — fire in parallel. The week-streak hGetAll above
    // already touched the achievements hash; the readAchievements call here
    // will reflect the just-applied unlocks.
    const [builders, leaderboard, floorOwners, floorNames, achievements] =
      await Promise.all([
        redis.zCard(buildersKey(postId, date)),
        readLeaderboard(postId, date, 10),
        readFloorOwners(postId, date),
        readFloorNames(postId, date),
        readAchievements(username),
      ]);

    // Broadcast the live tower update to everyone viewing this post so the
    // shared tower grows and narrows in real time. Best-effort: a realtime
    // failure must never fail the run — the submitter already holds the
    // authoritative result in the JSON response below.
    try {
      const message: RealtimeMessage = {
        kind: 'run',
        from: clientId,
        user: username,
        floors,
        perfect,
        communityFloors: after,
        towerWidth,
        builders,
        goalReached,
      };
      await realtime.send(realtimeChannel(postId), message);
    } catch (e) {
      console.error('realtime broadcast failed', e);
    }

    const nextRunToken = await issueRunToken(postId, date, username);

    return c.json<SubmitResponse>({
      type: 'submit',
      communityFloors: after,
      floorsAdded: floors,
      towerWidth,
      goalReached,
      personalBest: newPb,
      improvedPb,
      streak,
      builders,
      leaderboard,
      claimedFloors,
      floorOwners,
      floorNames,
      nameAccepted,
      achievements,
      newlyUnlocked,
      nextRunToken,
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

// Live presence ping. The client calls this on load and every ~15s while the
// game is open. We record the session's last-seen time, prune stale sessions,
// and return how many sessions are currently active on this post's tower. The
// pill it feeds is purely informational, so every failure path soft-returns a
// count of 1 (just you) rather than erroring.
api.post('/heartbeat', async (c) => {
  try {
    const { postId } = context;
    if (!postId) return c.json<HeartbeatResponse>({ active: 1 }, 200);
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    // 30/min is well above the ~4/min a real client produces but stops a
    // script from hammering the presence hash.
    if (await isRateLimited(username, 'heartbeat', 30)) {
      return c.json<HeartbeatResponse>({ active: 1 }, 200);
    }
    const body = (await c.req.json().catch(() => ({}))) as { clientId?: string };
    const id =
      typeof body.clientId === 'string'
        ? body.clientId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
        : '';
    const date = todayUtc();
    const key = presenceKey(postId, date);
    const now = Date.now();
    if (id) {
      await redis.hSet(key, { [id]: String(now) });
      await redis.expire(key, PRESENCE_TTL_SECONDS);
    }
    // Count active sessions and collect stale ones to prune so the hash stays
    // bounded to whoever is genuinely here.
    const all = (await redis.hGetAll(key)) ?? {};
    let active = 0;
    const stale: string[] = [];
    for (const [field, val] of Object.entries(all)) {
      if (now - parseInt(val, 10) < PRESENCE_ACTIVE_MS) active++;
      else stale.push(field);
    }
    if (stale.length > 0) {
      try {
        await redis.hDel(key, stale);
      } catch {
        // Best-effort prune; stale fields will expire with the key regardless.
      }
    }
    return c.json<HeartbeatResponse>({ active: Math.max(active, id ? 1 : 0) }, 200);
  } catch (err) {
    console.error('heartbeat failed', err);
    return c.json<HeartbeatResponse>({ active: 1 }, 200);
  }
});

api.get('/leaderboard', async (c) => {
  try {
    const { postId } = context;
    if (!postId) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'postId missing from context' },
        400
      );
    }
    const date = todayUtc();
    const entries = await readLeaderboard(postId, date, 10);
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

// Fixed comment templates for share-to-post. The player picks one of three
// tones; the rest of the comment is filled in by the server with their
// score and the day's name. Subreddit name is read from the server
// context at submission time.
const SHARE_TEMPLATES = [
  (floors: number, day: string) =>
    `I just stacked ${floors} floors in Skyline — ${day}. Come add yours to r/${context.subredditName}.`,
  (floors: number, day: string) =>
    `${floors} floors on ${day}. I'm on the Skyline board — your turn to raise the tower.`,
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
api.post('/share-result', async (c) => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    // Rate limit: 6 shares per minute. A player can only share one
    // template per run, and at most one run per 30s, so 6/min is well
    // above the honest ceiling.
    if (await isRateLimited(username, 'share', 6)) {
      return c.json({ ok: false, error: 'too many shares' }, 429);
    }
    const body = (await c.req.json()) as ShareResultBody;
    const templateIdx = Math.floor(Number(body.template ?? 1)) - 1;
    if (
      !Number.isInteger(templateIdx) ||
      templateIdx < 0 ||
      templateIdx >= SHARE_TEMPLATES.length
    ) {
      return c.json({ ok: false, error: 'invalid template' }, 400);
    }
    // The comment is posted as the APP account, so every value in it must be
    // server-authoritative. We ignore client-supplied floors/dayName entirely:
    // floors comes from the player's stored daily best, and the day name is
    // derived from the UTC date. The client only chooses which fixed template.
    const date = todayUtc();
    const postId = context.postId as `t3_${string}` | undefined;
    if (!postId) {
      return c.json({ ok: false, error: 'no post context' }, 400);
    }
    const pbRaw = await redis.get(personalKey(postId, date, username));
    const floors = pbRaw ? Math.max(0, Math.min(99, parseInt(pbRaw, 10))) : 0;
    const day = dailyChallengeName(date);
    const text = SHARE_TEMPLATES[templateIdx]!(floors, day);

    // This is a generic/automated score-share comment (fixed template, no
    // free-form player commentary), so it is posted as the player, in reply
    // to today's sticky activity comment rather than top-level on the post.
    const sticky = await getOrCreateStickyComment(postId, date);
    if (!sticky) {
      return c.json({ ok: false, error: 'share failed' }, 500);
    }
    await reddit.submitComment({ id: sticky, text, runAs: 'USER' });
    return c.json({ ok: true, posted: text }, 200);
  } catch (err) {
    console.error('share-result failed', err);
    return c.json({ ok: false, error: 'share failed' }, 500);
  }
});

export { api };
