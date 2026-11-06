/*
 * Records the 3rd-party API integration flow using the public Browser Test
 * Client, with a visible cursor overlay, click ripples, and narration pacing.
 *
 * The demo API key is injected directly into the (password-type, masked) field
 * via JS so it is never visible on screen. The "Show" toggle is left off.
 *
 * Flow: open test client -> (key prefilled/masked) -> Check Quota -> Submit
 * sample CF4 -> auto-poll -> Completed result.
 *
 * Run from video-src/<folder> (after `npm install` in video-src):  node record-api-integration-demo.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CLIENT_URL = 'https://lrama1.github.io/docben-public-docs/cf4-api/test-client/';
const VIDEO_DIR = path.resolve(__dirname, '..', '..', 'videos', 'raw');
const TIMING_OUT = path.resolve(__dirname, '..', '..', 'videos', 'timing-api-client.json');
const VIEW = { width: 1440, height: 900 };

// Demo tenant key (rotated for this demo; masked on screen). NOT committed.
const API_KEY = process.env.DEMO_API_KEY;
if (!API_KEY) {
  console.error('Set DEMO_API_KEY in the environment (never hardcode it — this repo is public).');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Narration clip durations (s) — measured after generation.
const NARR = { intro: 9.7, connect: 10.9, quota: 11.7, sandbox: 13.7, submit: 12.3, submitxml: 15.6, poll: 9.8, result: 9.1, outro: 11.0 };

async function injectCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('__demo-cursor')) return;
    const style = document.createElement('style');
    style.id = '__demo-cursor-style';
    style.textContent = `
      #__demo-cursor { position: fixed; z-index: 2147483647; pointer-events: none;
        width: 26px; height: 26px; margin: -3px 0 0 -3px;
        transition: top 70ms linear, left 70ms linear; filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
      .__demo-ripple { position: fixed; z-index: 2147483646; pointer-events: none;
        border: 3px solid #ff3d00; border-radius: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px;
        animation: __demoRipple .55s ease-out forwards; }
      @keyframes __demoRipple { from { transform: scale(.4); opacity: 1; } to { transform: scale(3.2); opacity: 0; } }
    `;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = '__demo-cursor';
    cursor.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 2 L20 12 L13 13.5 L16.5 21 L13.8 22.2 L10.3 14.7 L4 19 Z" fill="#ff3d00" stroke="#ffffff" stroke-width="1.5"/></svg>';
    cursor.style.left = '0px'; cursor.style.top = '0px';
    document.body.appendChild(cursor);
    window.__demoMove = (x, y) => { cursor.style.left = x + 'px'; cursor.style.top = y + 'px'; };
    window.__demoClick = (x, y) => {
      const r = document.createElement('div');
      r.className = '__demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    };
  });
}

async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(220);
  const box = await locator.boundingBox();
  if (!box) return null;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const cur = await page.evaluate(() => {
    const el = document.getElementById('__demo-cursor');
    return el ? { x: parseInt(el.style.left) || 0, y: parseInt(el.style.top) || 0 } : { x: 0, y: 0 };
  });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const nx = Math.round(cur.x + ((x - cur.x) * i) / steps);
    const ny = Math.round(cur.y + ((y - cur.y) * i) / steps);
    await page.mouse.move(nx, ny);
    await page.evaluate((p) => window.__demoMove && window.__demoMove(p.x, p.y), { x: nx, y: ny });
    await sleep(26);
  }
  return { x, y };
}

async function clickAt(page, locator) {
  const pos = await moveTo(page, locator);
  if (!pos) { await locator.click(); return; }
  await page.evaluate((p) => window.__demoClick && window.__demoClick(p.x, p.y), pos);
  await page.mouse.click(pos.x, pos.y);
  await sleep(200);
}

(async () => {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: VIDEO_DIR, size: VIEW } });
  const page = await context.newPage();
  page.setDefaultTimeout(40000);

  const t0 = Date.now();
  const marks = {};
  const mark = (key) => { marks[key] = (Date.now() - t0) / 1000; };
  const dwell = async (key) => {
    const target = (NARR[key] + 1) * 1000;
    const spent = Date.now() - t0 - marks[key] * 1000;
    await sleep(Math.max(400, target - spent));
  };

  // Open the test client. Preload baseUrl + masked API key via localStorage so
  // the key is never typed/shown. The field is type=password (masked).
  await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((key) => {
    window.localStorage.setItem('docben.baseUrl', 'https://api.docbenai.com');
    window.localStorage.setItem('docben.apiKey', key);
  }, API_KEY);
  await page.reload({ waitUntil: 'networkidle' });
  await injectCursor(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log('[ok] Test client loaded (key masked).');

  // INTRO.
  mark('intro');
  await sleep((NARR.intro + 1) * 1000);

  // CONNECT — hover the (masked) API key field to show where the key goes.
  mark('connect');
  await moveTo(page, page.locator('#apiKey'));
  await sleep((NARR.connect + 1) * 1000);

  // QUOTA.
  mark('quota');
  await clickAt(page, page.locator('#btnQuota'));
  await page.locator('#quotaOut:not(.hidden)').waitFor({ timeout: 30000 });
  await sleep(1500);
  await dwell('quota');

  // SANDBOX note — pause while narration explains this is just a testing sandbox.
  // Hover the page header / tag to draw the eye, not a form control.
  mark('sandbox');
  await page.evaluate(() => window.scrollTo(0, 0));
  await moveTo(page, page.locator('header .tag').first());
  await dwell('sandbox');

  // SUBMIT — hover the sample claim (JSON path, brief).
  mark('submit');
  await page.locator('#btnSubmit').scrollIntoViewIfNeeded();
  await sleep(800);
  await dwell('submit');

  // SUBMITXML — switch to the eClaims 3.0 XML tab, then Submit.
  mark('submitxml');
  await clickAt(page, page.locator('.tab[data-tab="xml"]'));
  await page.locator('#tabXml:not(.hidden)').waitFor({ timeout: 10000 });
  await sleep(1200);
  // Hover the XML textarea to draw attention to the document.
  await moveTo(page, page.locator('#cf4Xml'));
  await sleep(2500);
  await clickAt(page, page.locator('#btnSubmit'));
  await dwell('submitxml');

  // POLL — wait for auto-poll to begin; sessionId populates.
  mark('poll');
  await page.locator('#sessionId').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('sessionId').value.trim().length > 0, { timeout: 30000 });
  await sleep(2000);
  await dwell('poll');

  // RESULT — wait for COMPLETED status.
  mark('result');
  await page.waitForFunction(
    () => /COMPLETED|Flagged|No Issues/i.test(document.getElementById('resultJson').textContent || ''),
    { timeout: 120000 },
  );
  await sleep(1500);
  // Scroll the result into view.
  await page.locator('#resultJson').scrollIntoViewIfNeeded();
  await sleep(1500);
  await dwell('result');

  // OUTRO.
  mark('outro');
  await sleep((NARR.outro + 1.5) * 1000);

  const video = page.video();
  await context.close();
  await browser.close();

  const videoPath = await video.path();
  marks.__videoPath = videoPath;
  marks.__totalSeconds = (Date.now() - t0) / 1000;
  fs.mkdirSync(require('path').dirname(TIMING_OUT), { recursive: true });
  fs.writeFileSync(TIMING_OUT, JSON.stringify(marks, null, 2));
  console.log('VIDEO_PATH=' + videoPath);
  console.log('TIMING=' + JSON.stringify(marks));
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(1);
});
