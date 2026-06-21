// Capture the splash screen (with the new demo block animation) and the
// game-over overlay for the verify record.

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { existsSync } from 'node:fs';

const DIST = new URL('../dist/client/', import.meta.url).pathname;
const PORT = 4322;

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
    if (urlPath === '/') urlPath = '/splash.html';
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

const server = serve();
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

try {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 14'],
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const stub = {
      appName: 'skyline-subreddit-stack',
      appVersion: { major: 0, minor: 1, patch: 0 },
      postId: 't3_smoketest',
      subredditName: 'SkylineDemo',
      userId: 't2_smoke',
      username: 'smoketester',
    };
    Object.defineProperty(globalThis, 'devvit', {
      configurable: true,
      get: () => stub,
    });
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (url, opts) => {
      const path = typeof url === 'string' ? url : url.url;
      if (path.endsWith('/api/init')) {
        return new Response(
          JSON.stringify({
            type: 'init',
            postId: 't3_smoketest',
            username: 'smoketester',
            communityFloors: 5,
            personalBest: 0,
            streak: 1,
            builders: 7,
            streakAtRisk: false,
            leaderboard: [
              { username: 'skyfan', floors: 12, perfect: true },
              { username: 'builder42', floors: 9, perfect: true },
              { username: 'jane_dev', floors: 6, perfect: false },
              { username: 'pixelqueen', floors: 4, perfect: true },
            ],
            daily: {
              date: '2026-06-21',
              paletteId: 0,
              goalUnlocked: false,
              swingSpeed: 90,
              blockWidth: 260,
              communityFloors: 5,
              communityGoal: 20,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return realFetch(url, opts);
    };
  });

  await page.goto(`http://127.0.0.1:${PORT}/splash.html`, { waitUntil: 'load' });
  // Wait for the live progress to populate so the screenshot shows it.
  await page
    .waitForFunction(
      () => {
        const wrap = document.getElementById('live-stats');
        return wrap && !wrap.hidden;
      },
      { timeout: 4_000 }
    )
    .catch(() => {});

  // Demo block animation cycles every 2.6s; sample at the midpoint so the
  // block is roughly in the middle of its travel.
  await page.waitForTimeout(1100);
  await page.screenshot({
    path: 'notes/skyline-splash-mobile.png',
    fullPage: false,
  });

  // Desktop splash for completeness.
  const dcontext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const dpage = await dcontext.newPage();
  await dpage.addInitScript(() => {
    const stub = {
      appName: 'skyline-subreddit-stack',
      postId: 't3_smoketest',
      subredditName: 'SkylineDemo',
      userId: 't2_smoke',
      username: 'smoketester',
    };
    Object.defineProperty(globalThis, 'devvit', {
      configurable: true,
      get: () => stub,
    });
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (url, opts) => {
      const path = typeof url === 'string' ? url : url.url;
      if (path.endsWith('/api/init')) {
        return new Response(
          JSON.stringify({
            type: 'init',
            postId: 't3_smoketest',
            username: 'smoketester',
            communityFloors: 5,
            personalBest: 0,
            streak: 1,
            builders: 7,
            streakAtRisk: false,
            leaderboard: [
              { username: 'skyfan', floors: 12, perfect: true },
              { username: 'builder42', floors: 9, perfect: true },
            ],
            daily: {
              date: '2026-06-21',
              paletteId: 0,
              goalUnlocked: false,
              swingSpeed: 90,
              blockWidth: 260,
              communityFloors: 5,
              communityGoal: 20,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return realFetch(url, opts);
    };
  });
  await dpage.goto(`http://127.0.0.1:${PORT}/splash.html`, { waitUntil: 'load' });
  await dpage
    .waitForFunction(
      () => document.getElementById('live-stats') && !document.getElementById('live-stats').hidden,
      { timeout: 4_000 }
    )
    .catch(() => {});
  await dpage.waitForTimeout(1100);
  await dpage.screenshot({
    path: 'notes/skyline-splash-desktop.png',
    fullPage: false,
  });

  await browser.close();
} finally {
  server.close();
}

console.log('splash captures complete');
