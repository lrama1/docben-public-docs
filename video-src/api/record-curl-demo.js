/*
 * Records the curl/code API integration walkthrough. Renders a styled
 * "terminal" in a headless browser page (no OS cursor needed) that types out
 * curl commands and shows live API responses. The API key is masked as
 * $API_KEY / YOUR_API_KEY everywhere; the real key is only used server-side
 * (in Node) to fetch real responses, never rendered.
 *
 * Run from video-src/<folder> (after `npm install` in video-src):  node record-curl-demo.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const VIDEO_DIR = path.resolve(__dirname, '..', '..', 'videos', 'raw');
const TIMING_OUT = path.resolve(__dirname, '..', '..', 'videos', 'timing-curl.json');
const VIEW = { width: 1440, height: 900 };
const API = 'https://api.docbenai.com';
const API_KEY = process.env.DEMO_API_KEY;
if (!API_KEY) {
  console.error('Set DEMO_API_KEY in the environment (never hardcode it — this repo is public).');
  process.exit(1);
}
const SAMPLE_CF4 = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'cf4-api', 'sample-cf4.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NARR = { intro: 7.6, auth: 9.8, quota: 5.3, submit: 9.5, poll: 6.4, result: 7.6, outro: 11.1 };

// Minimal CF4 message for the JSON submit (the test client uses the same sample).
const MESSAGE = SAMPLE_CF4.message || SAMPLE_CF4;

const TERMINAL_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#0d1117; color:#c9d1d9; font-family:'Cascadia Code',Consolas,monospace; }
  #term { padding:28px; font-size:20px; line-height:1.55; white-space:pre-wrap; word-break:break-word; }
  .p { color:#7ee787; } .c { color:#8b949e; } .cmd { color:#79c0ff; } .out { color:#c9d1d9; }
  .key { color:#ffa657; } .cursor { display:inline-block; width:11px; background:#c9d1d9; animation:b 1s steps(1) infinite; }
  @keyframes b { 50% { opacity: 0; } }
</style></head><body><div id="term"></div><script>
  const term = document.getElementById('term');
  window.__lines = [];
  window.renderTerm = (html) => { term.innerHTML = html + '<span class="cursor">&nbsp;</span>'; };
  window.renderTerm('');
</script></body></html>`;

(async () => {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: VIDEO_DIR, size: VIEW } });
  const page = await context.newPage();

  const t0 = Date.now();
  const marks = {};
  const mark = (k) => { marks[k] = (Date.now() - t0) / 1000; };
  const dwell = async (k) => {
    const target = (NARR[k] + 1) * 1000;
    const spent = Date.now() - t0 - marks[k] * 1000;
    await sleep(Math.max(300, target - spent));
  };

  await page.setContent(TERMINAL_HTML, { waitUntil: 'load' });
  let buf = '';
  const render = () => page.evaluate((h) => window.renderTerm(h), buf);
  const line = (html) => { buf += html + '\n'; return render(); };
  const typeCmd = async (text) => {
    // Type the command character by character for realism.
    buf += '<span class="p">$ </span><span class="cmd"></span>';
    let shown = '';
    for (const ch of text) {
      shown += ch;
      buf = buf.replace(/<span class="cmd">.*?<\/span>$/, '<span class="cmd">' + shown.replace(/</g, '&lt;') + '</span>');
      await render();
      await sleep(18);
    }
    buf += '\n';
    await render();
    await sleep(300);
  };
  const out = (text) => line('<span class="out">' + text.replace(/</g, '&lt;') + '</span>');
  const comment = (text) => line('<span class="c">' + text.replace(/</g, '&lt;') + '</span>');

  const api = async (method, p, body) => {
    const res = await fetch(API + p, {
      method,
      headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  };

  // INTRO
  mark('intro');
  await comment('# DocBen CF4 Validation API — curl integration walkthrough');
  await sleep((NARR.intro + 1) * 1000);

  // AUTH
  mark('auth');
  await comment('# All requests send your key in the x-api-key header:');
  await comment('#   export API_KEY="YOUR_API_KEY"   # issued once by DocBen');
  await dwell('auth');

  // QUOTA
  mark('quota');
  await typeCmd('curl -H "x-api-key: $API_KEY" \\');
  await typeCmd('  https://api.docbenai.com/public/v1/quota');
  const quota = await api('GET', '/public/v1/quota');
  await out(JSON.stringify(quota, null, 2).split('\n').slice(0, 8).join('\n'));
  await dwell('quota');

  // SUBMIT
  mark('submit');
  await typeCmd('curl -X POST -H "x-api-key: $API_KEY" \\');
  await typeCmd('  -H "Content-Type: application/json" \\');
  await typeCmd('  -d @claim.json  https://api.docbenai.com/public/v1/validations');
  const submit = await api('POST', '/public/v1/validations', { message: MESSAGE });
  await out(JSON.stringify(submit, null, 2));
  const sessionId = submit.sessionId;
  await dwell('submit');

  // POLL
  mark('poll');
  await typeCmd('curl -H "x-api-key: $API_KEY" \\');
  await typeCmd(`  https://api.docbenai.com/public/v1/validations/${sessionId}`);
  let status = null;
  let result = null;
  for (let i = 0; i < 30; i++) {
    const s = await api('GET', `/public/v1/validations/${sessionId}`);
    status = s.status;
    if (status === 'COMPLETED' || status === 'FAILED') { result = s; break; }
    await sleep(3000);
  }
  await out(`{ "sessionId": "${sessionId}", "status": "${status}", ... }`);
  await dwell('poll');

  // RESULT
  mark('result');
  if (result && result.result) {
    const r = result.result;
    const summary = {
      status: result.status,
      claimStatus: result.claimStatus,
      qualityPercentage: r.qualityPercentage,
      rejectionReasons: (r.rejectionReason || []).length,
      drgClassification: r.drgClassification,
      drgClassificationDesc: r.drgClassificationDesc,
      drgSystem: r.drgSystem,
    };
    await out(JSON.stringify(summary, null, 2));
  } else {
    await out(`{ "status": "${status}" }`);
  }
  await dwell('result');

  // OUTRO
  mark('outro');
  await comment('# Copy ready-made JS/TS clients from cf4-api/examples/,');
  await comment('# or import cf4-api/openapi.yaml into Postman. See the guide.');
  await sleep((NARR.outro + 1.5) * 1000);

  const video = page.video();
  await context.close();
  await browser.close();

  const videoPath = await video.path();
  marks.__videoPath = videoPath;
  marks.__totalSeconds = (Date.now() - t0) / 1000;
  fs.mkdirSync(path.dirname(TIMING_OUT), { recursive: true });
  fs.writeFileSync(TIMING_OUT, JSON.stringify(marks, null, 2));
  console.log('VIDEO_PATH=' + videoPath);
  console.log('TIMING=' + JSON.stringify(marks));
  console.log('sessionId=' + sessionId + ' status=' + status);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(1);
});
