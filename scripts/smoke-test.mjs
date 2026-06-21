// Smoke test for Skyline game bundle.
// Serves dist/client/ statically and verifies the Phaser game mounts,
// HUD renders, and the first gameplay action (tap to drop) is reachable.
// We inject a fake window.devvit so the bundle's imports resolve without
// the actual Devvit webview.

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { existsSync } from 'node:fs';

const DIST = new URL('../dist/client/', import.meta.url).pathname;
const PORT = 4321;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};

function serve() {
  return createServer(async (req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/game.html';
    const filePath = join(DIST, urlPath);
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = extname(filePath);
    const mime = MIME[ext] ?? 'application/octet-stream';
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.end(body);
  });
}

async function runChecks(label, contextOptions) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  // Stub the Devvit runtime so the bundle's requestExpandedMode / context
  // references don't blow up. The bundle only calls context.* lazily.
  await page.addInitScript(() => {
    const stub = {
      appName: 'skyline-subreddit-stack',
      appVersion: { major: 0, minor: 1, patch: 0 },
      postId: 't3_smoketest',
      subredditName: 'SkylineDemo',
      userId: 't2_smoke',
      username: 'smoketester',
      appPermissionState: { consentStatus: 1, grantedScopes: [], requestedScopes: [] },
      share: { userData: undefined },
      webViewMode: 'expanded',
    };
    Object.defineProperty(globalThis, 'devvit', {
      configurable: true,
      get: () => stub,
    });
    // Also stub the /api/init + /api/submit + /api/leaderboard so the game
    // can boot without a Devvit server.
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (url, opts) => {
      const path = typeof url === 'string' ? url : url.url;
      const leaderboard = [
        { username: 'smoketester', floors: 5, perfect: true },
        { username: 'somebody', floors: 3, perfect: false },
      ];
      if (path.endsWith('/api/init')) {
        return new Response(
          JSON.stringify({
            type: 'init',
            postId: 't3_smoketest',
            username: 'smoketester',
            communityFloors: 3,
            personalBest: 0,
            streak: 2,
            builders: 4,
            streakAtRisk: true,
            leaderboard,
            floorOwners: { 5: 'somebody', 10: 'smoketester' },
            daily: {
              date: '2026-06-21',
              paletteId: 0,
              goalUnlocked: false,
              swingSpeed: 90,
              blockWidth: 260,
              communityFloors: 3,
              communityGoal: 12,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (path.endsWith('/api/submit')) {
        return new Response(
          JSON.stringify({
            type: 'submit',
            communityFloors: 5,
            floorsAdded: 2,
            goalReached: false,
            personalBest: 2,
            improvedPb: true,
            streak: 1,
            builders: 2,
            leaderboard,
            claimedFloors: [5],
            floorOwners: { 5: 'smoketester', 10: 'smoketester' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (path.endsWith('/api/leaderboard')) {
        return new Response(
          JSON.stringify({
            type: 'leaderboard',
            date: '2026-06-21',
            entries: [
              { username: 'smoketester', floors: 5, perfect: true },
              { username: 'somebody', floors: 3, perfect: false },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return realFetch(url, opts);
    };
  });

  await page.goto(`http://127.0.0.1:${PORT}/game.html`, { waitUntil: 'load' });
  // Wait for Phaser canvas + HUD.
  await page.waitForSelector('#game-container canvas', { timeout: 10_000 });
  await page.waitForSelector('#overlay', { state: 'attached', timeout: 5_000 });

  // Wait until bootstrap has finished (overlay-title switches away from
  // "Loading…" to "Today's Skyline"). Bail out cleanly if not.
  await page
    .waitForFunction(
      () => {
        const t = document.getElementById('overlay-title');
        return t && t.textContent && !t.textContent.startsWith('Loading');
      },
      { timeout: 8_000 }
    )
    .catch(() => {});

  const overlayVisible = await page.evaluate(() => {
    const o = document.getElementById('overlay');
    return !!o && !o.classList.contains('overlay-hidden');
  });
  const hudState = await page.evaluate(() => ({
    score: document.getElementById('score-value')?.textContent,
    community: document.getElementById('community-value')?.textContent,
    goal: document.getElementById('community-goal')?.textContent,
    streak: document.getElementById('streak-value')?.textContent,
    subreddit: document.getElementById('subreddit-name')?.textContent,
    nextClaim: document.getElementById('next-claim-value')?.textContent,
    nextClaimHidden: document.getElementById('next-claim-pill')?.hidden,
    canvas: !!document.querySelector('#game-container canvas'),
    canvasWidth: document.querySelector('#game-container canvas')?.width,
    canvasHeight: document.querySelector('#game-container canvas')?.height,
    comboVisible: document
      .getElementById('combo-banner')
      ?.classList.contains('is-visible'),
    streakWarningVisible: !document
      .getElementById('streak-warning')
      ?.hidden,
    tapHintHidden: document.getElementById('tap-hint')?.hidden,
    goalBannerHidden: document.getElementById('goal-banner')?.hidden,
  }));

  await page.screenshot({ path: `notes/skyline-${label}-start.png`, fullPage: false });

  // Tap START.
  await page.click('#overlay-button');
  await page.waitForTimeout(400);
  const overlayAfterStart = await page.evaluate(() =>
    document.getElementById('overlay')?.classList.contains('overlay-hidden')
  );
  const tapHintVisibleAfterStart = await page.evaluate(
    () => !document.getElementById('tap-hint')?.hidden
  );
  await page.screenshot({ path: `notes/skyline-${label}-playing.png`, fullPage: false });

  // Drop a block by tapping the canvas.
  const cv = await page.$('#game-container canvas');
  if (cv) {
    const box = await cv.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
    }
  }
  await page.waitForTimeout(500);
  await page.mouse.click(640, 320);
  await page.waitForTimeout(500);

  // After the first tap, the tap-hint should hide and the combo banner should
  // not be visible (combo only appears on 2+ perfects).
  const tapHintHiddenAfterTap = await page.evaluate(
    () => document.getElementById('tap-hint')?.hidden
  );

  await page.screenshot({ path: `notes/skyline-${label}-after-drop.png`, fullPage: false });

  await browser.close();

  return {
    label,
    overlayVisible,
    overlayAfterStart,
    tapHintVisibleAfterStart,
    tapHintHiddenAfterTap,
    hudState,
    consoleErrors,
    pageErrors,
  };
}

const server = serve();
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const results = [];
try {
  results.push(
    await runChecks('desktop', { viewport: { width: 1280, height: 900 } })
  );
  results.push(
    await runChecks('mobile', {
      ...devices['iPhone 14'],
      hasTouch: true,
      isMobile: true,
    })
  );
} finally {
  server.close();
}

for (const r of results) {
  console.log(`\n=== ${r.label} ===`);
  console.log('overlay visible at start:', r.overlayVisible);
  console.log('overlay hidden after start:', r.overlayAfterStart);
  console.log('tap-hint visible after start:', r.tapHintVisibleAfterStart);
  console.log('tap-hint hidden after first tap:', r.tapHintHiddenAfterTap);
  console.log('hud:', r.hudState);
  console.log('console errors:', r.consoleErrors.length);
  for (const e of r.consoleErrors) console.log('  -', e);
  console.log('page errors:', r.pageErrors.length);
  for (const e of r.pageErrors) console.log('  -', e);
}

const fatal = results.flatMap((r) => r.pageErrors).length > 0;
process.exit(fatal ? 1 : 0);
