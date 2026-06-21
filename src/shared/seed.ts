import type { DailySeed } from './api';

// Tiny seeded PRNG (mulberry32) so we get a deterministic value per (date, salt)
// without bringing in a dependency.
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a string to a 32-bit integer using FNV-1a.
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Today's UTC date as YYYY-MM-DD.
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Yesterday's UTC date as YYYY-MM-DD. Used for the skip-day streak check.
export function yesterdayUtc(now: Date = new Date()): string {
  const d = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// Seconds in 36 hours. Daily keys expire after the UTC day plus a buffer so a
// player loading late in the day (or just after midnight) still sees the day's
// data, but nothing lingers forever in Redis.
export const DAILY_TTL_SECONDS = 36 * 60 * 60;

// Derive the full DailySeed from a date string and the current community state.
// Pure function — safe to call from server or client.
//
// `goalUnlocked` is true when the community hit yesterday's goal: it swaps in
// the special "aurora" palette as a visible reward for everyone today. The RNG
// is consumed in a fixed order regardless of the unlock so swingSpeed and
// communityGoal stay deterministic for the day (init and submit must agree).
//
// `previousBase` is the base palette (0/1/2) used by the previous day, if
// known. When supplied, the function guarantees the returned base palette
// is different so the sky colour always changes day-to-day.
export function buildDailySeed(
  date: string,
  communityFloors: number,
  goalUnlocked = false,
  previousBase: 0 | 1 | 2 | null = null
): DailySeed {
  const rng = mulberry32(hashString(date));
  // Base palette is one of 0/1/2 (the aurora bonus is layered on top later).
  let basePalette: 0 | 1 | 2 = Math.floor(rng() * 3) as 0 | 1 | 2;
  if (previousBase !== null && basePalette === previousBase) {
    // Bump to the next palette in the cycle. The modulo wraps the small
    // 3-element cycle so we never return the same value.
    basePalette = ((basePalette + 1) % 3) as 0 | 1 | 2;
  }
  // Swing speed ramps from 70 (easy) to 160 (hard) and back.
  const swingSpeed = 70 + rng() * 90;
  // Block width shrinks slightly as the tower grows so perfects feel earned.
  const blockWidth = Math.max(140, 280 - Math.floor(communityFloors * 1.5));
  // Daily community target: 12 to 30 floors, depending on the seed.
  const communityGoal = 12 + Math.floor(rng() * 19);
  // Hitting yesterday's goal unlocks the bonus palette (index 3) for everyone.
  const paletteId: 0 | 1 | 2 | 3 = goalUnlocked ? 3 : basePalette;
  return {
    date,
    paletteId,
    swingSpeed,
    communityFloors,
    communityGoal,
    blockWidth,
    goalUnlocked,
  };
}

// Pick a base palette id (0/1/2) for a date such that it's not the same as
// the previous day's effective palette. Used by the server to enforce the
// "no two days in a row share a palette" promise. Returns one of 0/1/2.
// `previousBase` is the previous day's base palette (0/1/2) or null when
// the player has never loaded the game before.
export function nextBasePalette(
  date: string,
  previousBase: 0 | 1 | 2 | null
): 0 | 1 | 2 {
  const rng = mulberry32(hashString(date));
  let pick: 0 | 1 | 2 = Math.floor(rng() * 3) as 0 | 1 | 2;
  if (previousBase !== null && pick === previousBase) {
    // Bump to the next palette in the cycle. The modulo wraps the small
    // 3-element cycle so we never return the same value.
    pick = ((pick + 1) % 3) as 0 | 1 | 2;
  }
  return pick;
}

// A short, memorable challenge name per UTC day. Each date deterministically
// gets a 2-word name like "Stardrop Monday" so the day has personality and is
// easier to refer to in conversation ("did you finish Stardrop?").

const ADJECTIVES = [
  'Stardrop',
  'Brickstorm',
  'Sunvault',
  'Cloudburst',
  'Hexline',
  'Emberglow',
  'Quietude',
  'Pebbleshade',
  'Skylark',
  'Brassbeam',
  'Marblefall',
  'Polaris',
];

const NOUNS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'Hour',
  'Rush',
  'Crane',
  'Lull',
  'Drip',
  'Shift',
];

export function dailyChallengeName(date: string): string {
  const rng = mulberry32(hashString('challenge-name:' + date));
  const adj = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(rng() * NOUNS.length)]!;
  return `${adj} ${noun}`;
}

// Palette definitions. Each palette has a sky, mid, and block color.
// Background gradients are built from these in the Phaser scene.
// Index 3 (aurora) is the bonus palette unlocked by hitting the daily goal.
export const PALETTES = [
  { sky: '#ffb88c', mid: '#de6262', block: '#fdfdfd', shadow: '#1a1a2e' }, // sunrise
  { sky: '#a1c4fd', mid: '#c2e9fb', block: '#fafafa', shadow: '#243949' }, // daylight
  { sky: '#3a1c71', mid: '#d76d77', block: '#fff1c2', shadow: '#0a0a1a' }, // dusk
  { sky: '#0b3d3a', mid: '#1f9d8f', block: '#caffbf', shadow: '#04161f' }, // aurora (unlocked)
] as const;

export type Palette = (typeof PALETTES)[number];
