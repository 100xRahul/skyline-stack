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
export function buildDailySeed(
  date: string,
  communityFloors: number,
  goalUnlocked = false
): DailySeed {
  const rng = mulberry32(hashString(date));
  // Palette cycles 3 ways so the same color never appears two days in a row.
  const basePalette = Math.floor(rng() * 3) as 0 | 1 | 2;
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
