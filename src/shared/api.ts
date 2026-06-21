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

export type ScoreSubmission = {
  // Number of floors the player stacked in their run.
  floors: number;
  // True when every block was placed with zero overhang (a "perfect" run).
  perfect: boolean;
};

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  daily: DailySeed;
  // Total community floors at the moment this player loaded the page.
  communityFloors: number;
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
  // Persistent achievements. Each is a 1-line definition the client renders
  // and a boolean `unlocked`. Progress is for the "almost there" case.
  achievements: AchievementState[];
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
  // Current state of every achievement (unlocked + progress) for the player.
  achievements: AchievementState[];
  // Achievement ids unlocked by THIS run. Empty when none.
  newlyUnlocked: string[];
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
