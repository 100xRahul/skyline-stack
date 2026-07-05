// Shared types for the Skyline game API.
// A daily seed is derived from the current UTC day so every player on
// the subreddit gets the same challenge for 24 hours.

export type DailySeed = {
  // YYYY-MM-DD UTC date string used as the daily key
  date: string;
  // Visual palette id for the day (0-2 normally, 3 = bonus "aurora" palette
  // unlocked when the community hit yesterday's goal). Drives background and
  // block colors.
  paletteId: 0 | 1 | 2 | 3;
  // The underlying base palette (0-2) before the aurora bonus is applied.
  // Stored server-side to drive the next day's anti-repeat check.
  basePalette: 0 | 1 | 2;
  // True when today's palette is the bonus one earned by hitting yesterday's goal.
  goalUnlocked: boolean;
  // Block swing speed in degrees/sec. Higher = harder.
  swingSpeed: number;
  // Stack of "ghost floors" the community has contributed so far.
  // New players see the shared tower as a ghost before they start playing.
  communityFloors: number;
  // Today's target number of community floors. The bar fills as players contribute.
  communityGoal: number;
  // Block widths are derived from the seed so it stays consistent across the day.
  blockWidth: number;
};

// Curated milestone-floor labels. This keeps the user-contribution mechanic
// expressive but bounded: players still choose how to mark a claimed floor,
// while moderators and judges do not have to reason about arbitrary free text.
export const FLOOR_NAME_CHOICES = [
  'Apex',
  'Beacon',
  'Bolt',
  'Crown',
  'Glow',
  'Launch',
  'Rally',
  'Signal',
  'Spark',
  'Vault',
] as const;

export type ScoreSubmission = {
  // Number of floors the player stacked in their run.
  floors: number;
  // True when every block was placed with zero overhang (a "perfect" run).
  perfect: boolean;
  // Opaque per-page-load session id (random, not a user identifier). Echoed
  // back in the live broadcast as `from` so the submitting tab can suppress
  // its own toast while every other player in the post still sees it.
  clientId?: string;
  // Server-issued token from /api/init or the previous /api/submit. Required
  // for positive-floor score submissions so scripts cannot spam arbitrary
  // scores without first starting a real run window.
  runToken?: string;
  // Optional: the player can tag a milestone floor they own in this run
  // (or a milestone floor they already own from a previous run today).
  // The server only accepts curated FLOOR_NAME_CHOICES and only persists one
  // if the player is the recorded owner of that floor. Floor + label travel
  // together.
  nameFloor?: number;
  name?: string;
};

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  // Subreddit this post lives in. Used for the HUD pill and the share
  // comment template. Read on the server from the post context.
  subredditName: string;
  daily: DailySeed;
  // Total community floors at the moment this player loaded the page.
  communityFloors: number;
  // Current width of the shared tower's top floor (px). The sub reshapes this
  // one tower across the day — ordinary runs erode it, perfect runs repair it —
  // and the player's first block inherits this width, so every builder
  // continues the tower exactly as the sub left it.
  towerWidth: number;
  // Sparse record of the tower's width after each accepted run, keyed by the
  // community floor count that run ended at. The client interpolates between
  // samples to draw the shared tower's TRUE carved silhouette — pinched where
  // sloppy runs eroded it, swelling back where perfect runs repaired it. This
  // is the day's collaboration made visible.
  towerHistory: Record<string, number>;
  // Who last reshaped the tower, how long ago, and whether their run was a
  // perfect (a repair). Null before the first run of the day. Drives the
  // "u/X handed you the tower 4m ago" line so the hand-to-hand mechanic is
  // legible even when the player is alone in the post.
  lastBuilder: { username: string; agoMs: number; perfect: boolean } | null;
  // Caller's personal best floor count for today's seed.
  personalBest: number;
  // Caller's active streak (consecutive days with at least 1 floor).
  streak: number;
  // Number of distinct players who have contributed to today's tower.
  builders: number;
  // Today's top contributors (highest floors first).
  leaderboard: LeaderboardEntry[];
  // True if the player has a streak that needs playing today to keep alive.
  streakAtRisk: boolean;
  // Owners of milestone floors in the shared tower: floor number -> username.
  // Rendered as named tags on the ghost tower so contributions are visible
  // and "owned". Only milestone floors (every 5th + the goal floor) are kept.
  floorOwners: Record<string, string>;
  // Player-named labels for the milestone floors: floor number -> name.
  // This is the user-contribution surface — every claimer can name their
  // floor with a single short word, and the name renders on the tower for
  // the rest of the sub to see.
  floorNames: Record<string, string>;
  // Persistent achievements. Each is a 1-line definition the client renders
  // and a boolean `unlocked`. Progress is for the "almost there" case.
  achievements: AchievementState[];
  // Token the client must send with its next positive-floor /api/submit.
  runToken: string;
};

export type AchievementDef = {
  id: 'first-stack' | 'ten-perfect' | 'week-streak' | 'fifty-floors';
  emoji: string;
  title: string;
  blurb: string;
};

export type AchievementState = AchievementDef & {
  unlocked: boolean;
  // Best-effort progress (0-1). For boolean achievements this stays at 0/1.
  progress: number;
  // Raw current count for display ("3/10 perfects").
  current: number;
  // The target value the player is racing to.
  goal: number;
};

export type SubmitResponse = {
  type: 'submit';
  // The community floor total after this run was merged.
  communityFloors: number;
  // Floors added to the community by this run.
  floorsAdded: number;
  // Shared tower width after this run reshaped it (eroded, or repaired by a
  // perfect run). The next builder (and this player's own retry) inherits it.
  towerWidth: number;
  // Whether the community reached its daily goal as a result of this run.
  goalReached: boolean;
  // Caller's personal best after this run.
  personalBest: number;
  // True when this run set a new personal best for the day.
  improvedPb: boolean;
  // Caller's updated streak.
  streak: number;
  // Number of distinct players who have contributed to today's tower.
  builders: number;
  // Today's top contributors after this run was merged.
  leaderboard: LeaderboardEntry[];
  // Milestone floor numbers this run claimed for the player (first to cross
  // each milestone owns it). Empty when the run claimed nothing.
  claimedFloors: number[];
  // Updated owners of milestone floors after this run: floor number -> username.
  floorOwners: Record<string, string>;
  // Updated floor-name map: floor number -> name. The map is the
  // server's record of what every claimed floor is named.
  floorNames: Record<string, string>;
  // True when the player's name was accepted and stored for the requested
  // floor. False when the floor isn't owned by them or the name was
  // rejected by the sanitiser.
  nameAccepted: boolean;
  // Current state of every achievement (unlocked + progress) for the player.
  achievements: AchievementState[];
  // Achievement ids unlocked by THIS run. Empty when none.
  newlyUnlocked: string[];
  // Fresh token for the player's next positive-floor run.
  nextRunToken: string;
};

export type LeaderboardEntry = {
  username: string;
  floors: number;
  perfect: boolean;
};

export type LeaderboardResponse = {
  type: 'leaderboard';
  date: string;
  entries: LeaderboardEntry[];
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};

// --- Realtime (live shared tower) -----------------------------------------
//
// Every player viewing the same post subscribes to one channel. When a run
// lands, the server broadcasts an authoritative snapshot so everyone else sees
// the tower grow and narrow live — the collaboration happens in real time, not
// only on the next reload.

// Devvit realtime channels may contain ONLY letters, numbers, and underscores
// (connectRealtime throws otherwise). The post id carries a `t3_` style prefix,
// so we sanitise to be safe. Server and client both derive the channel from
// this single helper so they always agree.
export function realtimeChannel(postId: string): string {
  return `skyline_${postId}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

// Broadcast when a run is merged. All numbers are server-authoritative
// snapshots taken AFTER the run was applied, so a receiver can adopt them
// directly. communityFloors only ever grows, so receivers use it as the
// sequence guard: a snapshot with fewer floors than what they already hold is
// stale and its towerWidth (which can move both ways now that perfect runs
// repair the tower) is ignored.
export type TowerRunMessage = {
  kind: 'run';
  // Submitter's session id (see ScoreSubmission.clientId). Lets the submitting
  // tab skip toasting its own run; it is not a user identifier.
  from: string;
  // Display name of the builder whose run this was.
  user: string;
  // Floors that run added to the shared tower.
  floors: number;
  perfect: boolean;
  // Shared tower totals after the run.
  communityFloors: number;
  towerWidth: number;
  builders: number;
  goalReached: boolean;
};

export type RealtimeMessage = TowerRunMessage;

// Response to POST /api/heartbeat: how many sessions are actively building this
// post's tower right now (a live presence count, including the caller).
export type HeartbeatResponse = {
  active: number;
};
