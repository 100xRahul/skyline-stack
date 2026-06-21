import { requestExpandedMode } from '@devvit/web/client';
import { dailyChallengeName } from '../shared/seed';
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
  const { communityFloors, daily, builders } = init;
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

  if (dayNameEl) {
    dayNameEl.textContent = dailyChallengeName(daily.date);
  }
}

void setSubLabel();
void showLiveProgress();
