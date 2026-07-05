import { requestExpandedMode } from '@devvit/web/client';
import {
  TOWER_MIN_WIDTH,
  TOWER_START_WIDTH,
  dailyChallengeName,
} from '../shared/seed';
import type { InitResponse } from '../shared/api';

const startButton = document.getElementById('start-button') as HTMLButtonElement;
const subredditTag = document.getElementById('subreddit-tag') as HTMLSpanElement;
const dayNameEl = document.getElementById('day-name');

startButton.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

// Label the current subreddit on the post card.
async function setSubLabel() {
  try {
    const mod = await import('@devvit/web/client');
    const ctx = mod.context as { subredditName?: string };
    if (ctx && ctx.subredditName) {
      subredditTag.textContent = `r/${ctx.subredditName}`;
    }
  } catch {
    // Devvit client context unavailable — keep the default label.
  }
}

// Pull today's live community progress so the inline post card itself is the
// hook: scrollers see how close the sub is to today's goal before they tap in.
// If the call fails we simply leave the live block hidden — we never show
// placeholder numbers.
async function showLiveProgress() {
  let init: InitResponse;
  try {
    const res = await fetch('/api/init');
    if (!res.ok) return;
    init = (await res.json()) as InitResponse;
  } catch {
    return;
  }
  const { communityFloors, daily, builders, achievements } = init;
  const goal = Math.max(1, daily.communityGoal);
  const pct = Math.min(100, (communityFloors / goal) * 100);

  const wrap = document.getElementById('live-stats');
  const fill = document.getElementById('live-fill');
  const floorsEl = document.getElementById('live-floors');
  const buildersEl = document.getElementById('live-builders');
  if (!wrap || !fill || !floorsEl || !buildersEl) return;

  fill.style.width = `${pct}%`;
  floorsEl.textContent =
    communityFloors >= daily.communityGoal
      ? `Goal reached — ${communityFloors} floors`
      : `${communityFloors} / ${daily.communityGoal} floors today`;
  buildersEl.textContent =
    builders > 0
      ? `${builders} builder${builders === 1 ? '' : 's'}`
      : 'Be the first today';
  wrap.hidden = false;

  startButton.textContent =
    communityFloors >= daily.communityGoal
      ? 'Push it higher'
      : "Add to today's stack";

  // The hand-to-hand hook, right on the feed card: how the sub has left the
  // shared tower and who touched it last. Text only — no free-form input.
  const towerEl = document.getElementById('live-tower');
  if (towerEl && typeof init.towerWidth === 'number') {
    const span = TOWER_START_WIDTH - TOWER_MIN_WIDTH;
    const pct = span > 0 ? (init.towerWidth - TOWER_MIN_WIDTH) / span : 1;
    const status =
      init.towerWidth >= TOWER_START_WIDTH - 4
        ? 'wide open'
        : pct > 0.66
          ? 'still wide'
          : pct > 0.4
            ? 'narrowing'
            : pct > 0.15
              ? 'getting narrow'
              : 'razor-thin';
    const last = init.lastBuilder;
    const mins = last ? Math.floor(last.agoMs / 60_000) : 0;
    const ago = !last ? '' : mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
    const lastLine = last
      ? ` — u/${last.username} ${last.perfect ? 'repaired it' : 'left it'} ${ago}`
      : '';
    towerEl.textContent = `Tower is ${status}${lastLine}`;
    towerEl.hidden = false;
  }

  if (dayNameEl) {
    dayNameEl.textContent = dailyChallengeName(daily.date);
  }

  // Surface lifetime achievement progress on the splash so first-time
  // visitors see a long-term goal they can chase.
  const achWrap = document.getElementById('live-achievements');
  const achValue = document.getElementById('live-achievements-value');
  if (achWrap && achValue && achievements && achievements.length > 0) {
    const unlocked = achievements.filter((a) => a.unlocked).length;
    achValue.textContent = `${unlocked} / ${achievements.length} unlocked`;
    achWrap.hidden = false;
  }
}

void setSubLabel();
void showLiveProgress();
