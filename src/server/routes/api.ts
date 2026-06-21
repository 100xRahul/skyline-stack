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
  dailyChallengeName,
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
// Owners of milestone floors (hash floorNumber -> username). First player to
// cross a milestone floor owns it for the day.
const ownersKey = (date: string) => `skyline:${date}:owners`;
// Player-named labels for claimed milestone floors (hash floorNumber -> name).
// This is the user-contribution surface: the player can name the floor they
// claim with a single short word (max 12 chars, sanitised). Names render on
// the milestone tag in the tower for everyone in the sub.
const floorNamesKey = (date: string) => `skyline:${date}:floor-names`;
// Misc per-day flags (e.g. whether the goal-reached comment was posted).
const metaKey = (date: string) => `skyline:${date}:meta`;

// A floor number is a "milestone" worth claiming if it is a multiple of 5 or
// it is exactly the day's community goal.
function isMilestone(floor: number, goal: number): boolean {
  return floor > 0 && (floor % 5 === 0 || floor === goal);
}
const personalKey = (date: string, username: string) =>
  `skyline:${date}:pb:${username.toLowerCase()}`;
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
// Streak data is kept for 60 days of inactivity, then garbage-collected.
const STREAK_TTL_SECONDS = 60 * 24 * 60 * 60;
// Lifetime totals and achievements are permanent — no TTL is set on them.

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

async function readFloorOwners(date: string): Promise<Record<string, string>> {
  return (await redis.hGetAll(ownersKey(date))) ?? {};
}

async function readFloorNames(date: string): Promise<Record<string, string>> {
  return (await redis.hGetAll(floorNamesKey(date))) ?? {};
}

// Sanitise a player-supplied floor name. Returns the cleaned name (1-12
// chars, alphanumeric + a small set of safe punctuation) or null if the
// input is unusable. This is the only UGC surface in the game, so the
// filter is intentionally strict: any Unicode outside basic Latin letters,
// digits, spaces, hyphens, underscores, dots, and emoji ZWJ sequences is
// stripped. Control characters and zero-width joiners are dropped. The
// blocklist catches the obvious slurs and slurs-adjacent words a Reddit
// moderator would never want to see on a floor.
const BLOCKLIST = new Set([
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'dick', 'piss', 'nigger',
  'faggot', 'kike', 'spic', 'chink', 'tranny', 'retard',
]);
function sanitiseFloorName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Normalise, drop control chars, keep alnum + safe punct + space.
  const cleaned = raw
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N} _\-.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
  if (cleaned.length < 1) return null;
  if (BLOCKLIST.has(cleaned.toLowerCase())) return null;
  return cleaned;
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
  const top = await readLeaderboard(date, 1);
  const builders = await redis.zCard(buildersKey(date));
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
    // Per-user rate limit: 30 init calls per minute. Generous enough to
    // cover retries, hot-reloads, and dev-tools tinkering.
    if (await isRateLimited(username, 'init', 30)) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'Too many requests' },
        429
      );
    }
    const date = todayUtc();
    const communityFloorsRaw = await redis.get(floorsKey(date));
    const communityFloors = communityFloorsRaw
      ? parseInt(communityFloorsRaw, 10)
      : 0;
    const goalUnlocked = await goalReachedOn(yesterdayUtc());
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
    ] = await Promise.all([
      redis.get(personalKey(date, username)),
      readStreak(username),
      redis.hGetAll(streakKey(username)),
      redis.zCard(buildersKey(date)),
      readLeaderboard(date, 10),
      readFloorOwners(date),
      readFloorNames(date),
      readAchievements(username),
      redis.hGet(metaKey(yesterdayUtc()), 'basePalette'),
    ]);
    const previousBase =
      previousBaseRaw === '0' || previousBaseRaw === '1' || previousBaseRaw === '2'
        ? (parseInt(previousBaseRaw, 10) as 0 | 1 | 2)
        : null;
    const daily = buildDailySeed(date, communityFloors, goalUnlocked, previousBase);
    // Persist today's base palette for tomorrow's anti-repeat check. We
    // only record the base (0/1/2) — the aurora bonus (3) is overlaid at
    // draw time, never stored.
    await redis.hSet(metaKey(date), {
      basePalette: String(daily.paletteId === 3 ? 0 : daily.paletteId),
    });
    await redis.expire(metaKey(date), DAILY_TTL_SECONDS);
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
      personalBest,
      streak,
      builders,
      leaderboard,
      streakAtRisk,
      floorOwners,
      floorNames,
      achievements,
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
    const floors = Math.max(0, Math.min(99, Math.floor(body.floors ?? 0)));
    const perfect = !!body.perfect && floors > 0;
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
    const before = after - floors;

    // Claim any milestone floors this run crossed (community floors in the range
    // before < floor <= after). First player to cross a milestone owns it.
    const claimedFloors: number[] = [];
    if (floors > 0) {
      for (let floor = before + 1; floor <= after; floor++) {
        if (!isMilestone(floor, goal)) continue;
        const claimed = await redis.hSetNX(
          ownersKey(date),
          String(floor),
          username
        );
        if (claimed === 1) claimedFloors.push(floor);
      }
      if (claimedFloors.length > 0) {
        await redis.expire(ownersKey(date), DAILY_TTL_SECONDS);
      }
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
          const owners = await readFloorOwners(date);
          if (owners[String(requestedNameFloor)]?.toLowerCase() === username.toLowerCase()) {
            await redis.hSet(floorNamesKey(date), {
              [String(requestedNameFloor)]: clean,
            });
            await redis.expire(floorNamesKey(date), DAILY_TTL_SECONDS);
            nameAccepted = true;
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
        const first = await redis.hSetNX(metaKey(date), 'goalAnnounced', '1');
        if (first === 1) {
          await redis.expire(metaKey(date), DAILY_TTL_SECONDS);
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
        redis.zCard(buildersKey(date)),
        readLeaderboard(date, 10),
        readFloorOwners(date),
        readFloorNames(date),
        readAchievements(username),
      ]);

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
      claimedFloors,
      floorOwners,
      floorNames,
      nameAccepted,
      achievements,
      newlyUnlocked,
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

// Fixed comment templates for share-to-post. The player picks one of three
// tones; the rest of the comment is filled in by the server with their
// score and the day's name. Subreddit name is read from the server
// context at submission time.
const SHARE_TEMPLATES = [
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
    const floors = Math.max(0, Math.floor(Number(body.floors ?? 0)));
    const day = (body.dayName ?? '').trim() || dailyChallengeName(todayUtc());
    const text = SHARE_TEMPLATES[templateIdx]!(floors, day);

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

export { api };
