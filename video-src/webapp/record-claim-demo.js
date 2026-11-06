/*
 * Records the "Create a CF4 claim, attach documents, validate, fix, re-validate"
 * demo against the LIVE app (https://lrama1.github.io/docben-ai3/) with a visible
 * cursor overlay, narration-paced beats, and a timing log for the mux step.
 *
 * Flow: sign in -> new claim -> fill the six CF4 sections (with planted defects)
 *       -> attach a document -> Validate (AI flags issues) -> correct them
 *       -> attach the missing document -> Validate again (passes).
 *
 * SECURITY: credentials come from the environment — never hardcode them here
 * (this repo has a public GitHub remote).
 *     $env:DEMO_USERNAME = '<user id>'
 *     $env:DEMO_PASSWORD = '<password>'
 *
 * Fictional patient + synthetic documents only (see make-sample-attachments.js).
 *
 * Prereqs (run from video-src/webapp, in order):
 *     node make-sample-attachments.js
 *     python generate-narration-claim.py ; node measure-narration-claim.js
 * Then:
 *     node record-claim-demo.js          # records video + timing.json
 *     node record-claim-demo.js --dry    # no video, no pacing: verifies the flow
 *                                          and prints what the AI flagged
 * Then:  node mux-claim-narration.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const APP_URL = 'https://lrama1.github.io/docben-ai3/';
const DIR = path.join(__dirname, 'demo', 'claim');
const VIDEO_DIR = path.join(DIR, 'video');
const SHOTS_DIR = path.join(DIR, 'shots');
const TIMING_OUT = path.join(DIR, 'timing.json');
const ATTACH_DIR = path.join(DIR, 'sample-attachments');
const VIEW = { width: 1440, height: 900 };

const USERNAME = process.env.DEMO_USERNAME;
const PASSWORD = process.env.DEMO_PASSWORD;
if (!USERNAME || !PASSWORD) {
  console.error('Set DEMO_USERNAME and DEMO_PASSWORD in the environment (never hardcode them).');
  process.exit(2);
}

const script = require('./claim-demo-script.json');
const DUR = JSON.parse(fs.readFileSync(path.join(DIR, 'durations.json'), 'utf8'));
const BEATS = script.beats;
const COMPRESS = new Set(BEATS.filter((b) => b.compress).map((b) => b.key));
const PAD = 1.0; // seconds of breathing room after each narrated beat

const FILE_CBC = path.join(ATTACH_DIR, 'CBC-Result-Reyes-Juan.png');
const FILE_XRAY = path.join(ATTACH_DIR, 'Chest-XRay-Report-Reyes-Juan.png');

// ── The claim (fictional). Based on a pneumonia case the validator passes at
// 100%; three defects are planted, then corrected on camera.
const CLAIM = {
  hciName: 'Demo Riverside Hospital',
  accreditationNumber: 'HCI-DEMO-2025-001',
  hciAddress: '123 Sample Avenue, Quezon City, Metro Manila',
  patientLastName: 'REYES',
  patientFirstName: 'JUAN',
  patientMiddleName: 'SANTOS',
  pin: '12-34567890-1',
  age: '50',
  sex: 'male',
  firstCaseRateCode: 'J18.9',
  chiefComplaint: 'Fever, productive cough, and difficulty breathing for 4 days',
  admittingDiagnosis: 'Community-acquired pneumonia, moderate severity',
  dischargeDiagnosis: 'Community-acquired pneumonia, resolved',
  admit: { month: '06', day: '10', year: '2025', hour: '09', minute: '30', ampm: 'AM' },
  discharge: { month: '06', day: '17', year: '2025', hour: '02', minute: '00', ampm: 'PM' },
  historyPresentIllness:
    'Patient is a 50-year-old male who presents with 4 days of progressive fever up to 39.2 C, ' +
    'productive cough with yellowish-green sputum, and dyspnea on exertion. Symptoms began with ' +
    'mild coryza and malaise, then worsened with pleuritic chest pain on the right side. No hemoptysis. ' +
    'No prior similar episodes. No recent travel. No sick contacts at home. Patient is a non-smoker ' +
    'with no chronic lung disease. On presentation, oxygen saturation was 92% on room air, improving ' +
    'to 97% with 2L nasal cannula oxygen.',
  pastMedicalHistory:
    'Hypertension diagnosed 8 years ago, well-controlled on amlodipine 10mg daily. ' +
    'No prior surgeries. No known drug allergies. No diabetes mellitus.',
  vitals: { height: '170', weight: '72', bp: '128/82', hr: '98', rr: '24', temp: '39.2' },
  // DEFECT 2 (part 1): only one symptom ticked; fixed later (+ Cough, Dyspnea, Chest pain).
  symptoms: ['symptom-fever'],
  // Doctor's orders — DEFECT 1: 06/12 and 06/13 are missing; added later.
  doctorsOrders: [
    { date: '06/10/2025', action: 'Admit to ward. IV fluids, CBC, chest X-ray PA, start ceftriaxone 1g IV q12h, paracetamol prn fever.' },
    { date: '06/11/2025', action: 'Continue IV antibiotics. Fever down to 38.1 C. Monitor vitals q4h. Encourage hydration.' },
    { date: '06/14/2025', action: 'Switched to oral levofloxacin 750mg daily. Afebrile, no respiratory distress.' },
    { date: '06/15/2025', action: 'Stable, afebrile. Tolerating regular diet. Continue oral antibiotics.' },
    { date: '06/16/2025', action: 'Continued improvement. Vitals stable. Discharge planned for tomorrow.' },
    { date: '06/17/2025', action: 'Discharge home on oral levofloxacin. Follow-up in 1 week with repeat chest X-ray.' },
  ],
  missingOrders: [
    { date: '06/12/2025', action: 'Afebrile since last night. Improving dyspnea. Continue current antibiotics. Repeat CBC improving.' },
    { date: '06/13/2025', action: 'Clinically improved. O2 sat 98% on room air. Stop oxygen. Plan oral antibiotics tomorrow.' },
  ],
  medicines: [
    { genericName: 'Ceftriaxone', dosage: '1g IV q12h x 5 days', cost: '750.00', cont: 'Empiric coverage' },
    { genericName: 'Azithromycin', dosage: '500mg IV q24h x 3 days', cost: '420.00', cont: 'Atypical coverage' },
    { genericName: 'Levofloxacin', dosage: '750mg PO q24h x 5 days', cost: '380.00', cont: 'Oral step-down' },
    { genericName: 'Paracetamol', dosage: '500mg PO q6h prn fever', cost: '60.00', cont: 'Antipyretic' },
  ],
  outcomeReason: 'Responded well to IV antibiotics. Fever resolved, oxygenation improved. Discharged on oral antibiotics.',
};

// The issues the narration describes. The recorder verifies the AI really flags
// them so the voice-over never contradicts the screen.
const EXPECTED_ISSUES = [
  { name: "doctor's orders", re: /doctor|order|06\/12|06\/13/i },
  { name: 'symptoms / chest findings', re: /symptom|chest|pneumonia|hallmark|lung|crackle|breath/i },
  { name: 'attachments (chest X-ray)', re: /attachment|x-?ray|radiolog|imaging|document/i },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pace = (ms) => (DRY ? 0 : ms);
let pageRef = null; // for the failure screenshot in the top-level catch

// ── Visible cursor + click ripples + "sped up" badge ───────────────────────
async function injectOverlay(page) {
  await page.evaluate(() => {
    if (document.getElementById('__demo-cursor')) return;
    const style = document.createElement('style');
    style.textContent = `
      #__demo-cursor { position: fixed; z-index: 2147483647; pointer-events: none;
        width: 26px; height: 26px; margin: -3px 0 0 -3px;
        transition: top 70ms linear, left 70ms linear; filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
      .__demo-ripple { position: fixed; z-index: 2147483646; pointer-events: none;
        border: 3px solid #ff3d00; border-radius: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px;
        animation: __demoRipple .55s ease-out forwards; }
      @keyframes __demoRipple { from { transform: scale(.4); opacity: 1; } to { transform: scale(3.2); opacity: 0; } }
      #__demo-badge { position: fixed; z-index: 2147483645; right: 18px; bottom: 18px; pointer-events: none;
        background: rgba(15,23,42,.88); color: #fff; font: 600 16px Arial, sans-serif; padding: 10px 16px;
        border-radius: 999px; box-shadow: 0 2px 10px rgba(0,0,0,.35); display: none; }
    `;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = '__demo-cursor';
    cursor.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 2 L20 12 L13 13.5 L16.5 21 L13.8 22.2 L10.3 14.7 L4 19 Z" fill="#ff3d00" stroke="#ffffff" stroke-width="1.5"/></svg>';
    cursor.style.left = '700px'; cursor.style.top = '420px';
    document.body.appendChild(cursor);
    const badge = document.createElement('div');
    badge.id = '__demo-badge';
    document.body.appendChild(badge);
    window.__demoMove = (x, y) => { cursor.style.left = x + 'px'; cursor.style.top = y + 'px'; };
    window.__demoClick = (x, y) => {
      const r = document.createElement('div');
      r.className = '__demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    };
    window.__demoBadge = (text) => {
      badge.textContent = text || '';
      badge.style.display = text ? 'block' : 'none';
    };
  });
}

async function ensureOverlay(page) {
  const ok = await page.evaluate(() => !!document.getElementById('__demo-cursor')).catch(() => false);
  if (!ok) await injectOverlay(page);
}

async function badge(page, text) {
  await ensureOverlay(page);
  await page.evaluate((t) => window.__demoBadge && window.__demoBadge(t), text);
}

async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(pace(200));
  const box = await locator.boundingBox();
  if (!box) return null;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await ensureOverlay(page);
  const cur = await page.evaluate(() => {
    const el = document.getElementById('__demo-cursor');
    return el ? { x: parseInt(el.style.left) || 0, y: parseInt(el.style.top) || 0 } : { x: 0, y: 0 };
  });
  const steps = DRY ? 2 : 12;
  for (let i = 1; i <= steps; i++) {
    const nx = Math.round(cur.x + ((x - cur.x) * i) / steps);
    const ny = Math.round(cur.y + ((y - cur.y) * i) / steps);
    await page.mouse.move(nx, ny);
    await page.evaluate((p) => window.__demoMove && window.__demoMove(p.x, p.y), { x: nx, y: ny });
    await sleep(pace(24));
  }
  return { x, y };
}

async function clickAt(page, locator) {
  const pos = await moveTo(page, locator);
  if (!pos) { await locator.click(); return; }
  await page.evaluate((p) => window.__demoClick && window.__demoClick(p.x, p.y), pos);
  await page.mouse.click(pos.x, pos.y);
  await sleep(pace(160));
}

async function typeInto(page, locator, text, delay = 5, { verify = true } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await clickAt(page, locator);
    if (attempt > 1) await page.keyboard.press('Control+A'); // replace whatever is there
    await page.keyboard.type(text, { delay: DRY ? 0 : delay });
    await sleep(pace(120));
    if (!verify) return;
    // The form can reset itself shortly after mounting ("new claim"), which
    // silently drops early keystrokes — confirm the value actually stuck.
    if ((await locator.inputValue()) === text) return;
    console.log(`[retry] value did not stick, retyping (${text.slice(0, 24)}...)`);
    await sleep(500);
  }
  throw new Error(`Could not enter value into field: ${text.slice(0, 40)}`);
}

// Click a checkbox/radio only if it is not already in the wanted state.
async function setChecked(page, locator, want = true) {
  const now = await locator.isChecked();
  if (now !== want) await clickAt(page, locator);
}

// Switch form tab and CONFIRM it took (a click can be swallowed while the page is
// busy re-rendering, e.g. right after a validation result lands). Retries, then
// fails loudly with the tab that was expected.
const TAB_PROOF = {
  'tab-hci-info': (p) => p.locator('#hciName'),
  'tab-patient-data': (p) => p.locator('#patientLastName'),
  'tab-admission-reason': (p) => p.locator('#historyPresentIllness'),
  'tab-course-ward': (p) => p.getByRole('button', { name: 'Add Row' }).first(),
  'tab-drugs': (p) => p.locator('#medicine-genericName-0'),
  'tab-outcome': (p) => p.locator('#outcome-improved'),
};
async function gotoTab(page, tabId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await clickAt(page, page.locator(`#${tabId}`));
    try {
      await TAB_PROOF[tabId](page).waitFor({ state: 'visible', timeout: 4000 });
      return;
    } catch {
      console.log(`[retry] tab ${tabId} did not open (attempt ${attempt})`);
    }
  }
  throw new Error(`Tab ${tabId} never opened`);
}

// "Essentially normal" etc. exist once per exam subsection — scope by heading.
function examSection(page, heading) {
  return page.getByText(heading, { exact: true }).locator('..');
}

// ── Beat pacing ─────────────────────────────────────────────────────────────
// Video time zero == page creation; t0 is re-anchored there (see main) so the
// beat marks line up with the recording rather than with script start-up.
let t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const timing = [];
let current = null;

async function beat(key, fn) {
  if (current) current.end = now();
  current = { key, start: now(), end: null };
  timing.push(current);
  console.log(`[beat] ${key} @ ${current.start.toFixed(1)}s`);
  await fn();
  if (!COMPRESS.has(key)) {
    // Hold until the narration has had time to finish (+ breathing room).
    const need = (DUR[key] + PAD) * 1000 - (now() - current.start) * 1000;
    if (need > 0) await sleep(pace(need));
  }
}

async function analysisPanel(page) {
  return page.locator('div.MuiPaper-root', { has: page.locator('h6', { hasText: /^AI Analysis$/ }) }).first();
}

// Wait for the AI Analysis panel to leave "running" and return what it says.
async function waitForResult(page, label) {
  const panel = await analysisPanel(page);
  const deadline = Date.now() + 240_000;
  let text = '';
  while (Date.now() < deadline) {
    text = (await panel.innerText().catch(() => '')) || '';
    const running = /running in the background/i.test(text);
    const items = await panel.locator('li').allInnerTexts().catch(() => []);
    if (!running && (items.length > 0 || /likely valid/i.test(text))) {
      return { text, items };
    }
    if (!running && /failed|error/i.test(text) && !/AI Analysis\s*$/i.test(text.trim())) {
      throw new Error(`${label}: validation FAILED — ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    await sleep(2000);
  }
  throw new Error(`${label}: timed out waiting for validation result. Last panel text: ${text.slice(0, 200)}`);
}

async function dismissSubmitDialog(page) {
  const heading = page.getByRole('heading', { name: 'Validation Started' });
  try {
    await heading.waitFor({ timeout: 30000 });
  } catch (err) {
    // Surface whatever the app is actually telling the user (form error, failed
    // submission dialog, ...) instead of a bare timeout.
    await page.screenshot({ path: path.join(SHOTS_DIR, 'validate-error.png'), fullPage: true }).catch(() => {});
    const alerts = await page.locator('[role="alert"], [role="dialog"]').allInnerTexts().catch(() => []);
    throw new Error(`"Validation Started" dialog never appeared. Visible alerts/dialogs: ${JSON.stringify(alerts)}`);
  }
  await sleep(pace(1600));
  await clickAt(page, page.getByRole('button', { name: 'OK', exact: true }));
  await heading.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
}

// When a validation finishes the app pops a "Validation Completed" modal over the
// results. Dismiss it (on camera) so the findings are visible and clicks land.
async function dismissCompletedDialog(page) {
  const heading = page.getByRole('heading', { name: 'Validation Completed' });
  const shown = await heading.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  if (!shown) return;
  await sleep(pace(900));
  await clickAt(page, page.getByRole('button', { name: 'OK', exact: true }));
  await heading.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await sleep(pace(300));
}

(async () => {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEW,
    ...(DRY ? {} : { recordVideo: { dir: VIDEO_DIR, size: VIEW } }),
  });
  const page = await context.newPage();
  t0 = Date.now(); // video starts here
  pageRef = page;
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  const shot = (name) => page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });

  // Open a file chooser by clicking "Select Files" (visible cursor), then upload.
  const uploadVia = async (file, expectedCount) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickAt(page, page.locator('#select-files-btn')),
    ]);
    await chooser.setFiles(file);
    await page.getByText(new RegExp(`Uploaded Attachments \\(${expectedCount}\\)`)).waitFor({ timeout: 90000 });
    await sleep(pace(900));
  };

  const clickValidate = async () => {
    if (DRY) {
      // Diagnostic: the HCI tab unmounts when we leave it, so go look at it.
      await gotoTab(page, 'tab-hci-info');
      console.log('[diag] HCI just before validate:', await hciValues());
    }
    await gotoTab(page, 'tab-outcome');
    await clickAt(page, page.locator('#validate-claim-btn'));
  };

  // ── INTRO: the live site, signed out ──────────────────────────────────────
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Sign In' }).waitFor({ timeout: 45000 });
  await injectOverlay(page);

  await beat('intro', async () => { await sleep(pace(500)); });

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  await beat('login', async () => {
    await typeInto(page, page.getByLabel('User ID'), USERNAME, 40);
    await typeInto(page, page.getByLabel('Password'), PASSWORD, 40); // masked on screen
    await clickAt(page, page.getByRole('button', { name: 'Sign In' }));
  });

  await beat('loginwait', async () => {
    await badge(page, '⏩ Sped up');
    await page.getByRole('heading', { name: 'Alpha Testing Notice' }).waitFor({ timeout: 90000 });
    await badge(page, '');
  });

  // ── WELCOME: dismiss notice, start a new claim ───────────────────────────
  await beat('welcome', async () => {
    await ensureOverlay(page);
    await sleep(pace(1500)); // let the notice be read
    await clickAt(page, page.getByRole('button', { name: 'I Understand' }));
    await sleep(pace(500));
    await clickAt(page, page.getByRole('button', { name: 'Create Claims(CF4)' }));
    const yes = page.getByRole('button', { name: 'Yes', exact: true });
    if (await yes.isVisible().catch(() => false)) await clickAt(page, yes);
    await page.getByText('I. HEALTH CARE INSTITUTION (HCI) INFORMATION').waitFor({ timeout: 20000 });
    // Let the "new claim" reset effect finish before anything is typed.
    await page.waitForTimeout(900);
    await ensureOverlay(page);
  });

  // ── SECTION I ─────────────────────────────────────────────────────────────
  const hciValues = () => page.evaluate(() => ['hciName', 'accreditationNumber', 'hciAddress']
    .map((id) => `${id}=${JSON.stringify((document.getElementById(id) || {}).value)}`).join(' '));
  await beat('hci', async () => {
    await typeInto(page, page.locator('#hciName'), CLAIM.hciName);
    await typeInto(page, page.locator('#accreditationNumber'), CLAIM.accreditationNumber);
    await typeInto(page, page.locator('#hciAddress'), CLAIM.hciAddress);
    if (DRY) console.log('[diag] HCI right after typing:', await hciValues());
  });

  // ── SECTION II ────────────────────────────────────────────────────────────
  await beat('patient', async () => {
    await gotoTab(page, 'tab-patient-data');
    await typeInto(page, page.locator('#patientLastName'), CLAIM.patientLastName);
    await typeInto(page, page.locator('#patientFirstName'), CLAIM.patientFirstName);
    await typeInto(page, page.locator('#patientMiddleName'), CLAIM.patientMiddleName);
    await typeInto(page, page.locator('#pin'), CLAIM.pin);
    await typeInto(page, page.locator('#age'), CLAIM.age);
    await setChecked(page, page.locator(`input[name="sex"][value="${CLAIM.sex}"]`));
    await typeInto(page, page.locator('#firstCaseRateCode'), CLAIM.firstCaseRateCode);
    await typeInto(page, page.locator('#chiefComplaint'), CLAIM.chiefComplaint);
    await typeInto(page, page.locator('#admittingDiagnosis'), CLAIM.admittingDiagnosis);
    await typeInto(page, page.locator('#dischargeDiagnosis'), CLAIM.dischargeDiagnosis);
    for (const [prefix, d] of [['admit', CLAIM.admit], ['discharge', CLAIM.discharge]]) {
      await typeInto(page, page.locator(`#${prefix}Month`), d.month);
      await typeInto(page, page.locator(`#${prefix}Day`), d.day);
      await typeInto(page, page.locator(`#${prefix}Year`), d.year);
      await typeInto(page, page.locator(`#${prefix}Hour`), d.hour);
      await typeInto(page, page.locator(`#${prefix}Minute`), d.minute);
      await setChecked(page, page.locator(`input[name="${prefix}AmPm"][value="${d.ampm}"]`));
    }
  });

  // ── SECTION III ───────────────────────────────────────────────────────────
  await beat('reason', async () => {
    await gotoTab(page, 'tab-admission-reason');
    await typeInto(page, page.locator('#historyPresentIllness'), CLAIM.historyPresentIllness, 3);
    await typeInto(page, page.locator('#pastMedicalHistory'), CLAIM.pastMedicalHistory, 3);
    await setChecked(page, page.locator('#obgynNA'));
    for (const id of CLAIM.symptoms) await setChecked(page, page.locator(`#${id}`));
    await setChecked(page, page.getByRole('checkbox', { name: 'Awake and alert', exact: true }).first());
    const v = CLAIM.vitals;
    for (const [label, val] of [['Height', v.height], ['Weight', v.weight], ['BP', v.bp], ['HR', v.hr], ['RR', v.rr], ['Temp', v.temp]]) {
      await typeInto(page, page.getByRole('textbox', { name: label }), val);
    }
    // Physical exam. DEFECT 2 (part 2): chest is left "Essentially normal".
    await setChecked(page, page.getByRole('checkbox', { name: 'Dry mucous membrane', exact: true }).first());
    for (const heading of ['CHEST/LUNGS:', 'CVS:', 'ABDOMEN:', 'GU (OB):', 'SKIN/EXTREMITIES:', 'NEURO EXAM:']) {
      await setChecked(page, examSection(page, heading).getByRole('checkbox', { name: 'Essentially normal', exact: true }).first());
    }
    await setChecked(page, page.getByRole('radio', { name: 'No' }).last());
  });

  // ── SECTION IV ────────────────────────────────────────────────────────────
  await beat('course', async () => {
    await gotoTab(page, 'tab-course-ward');
    const orders = CLAIM.doctorsOrders;
    for (let i = 0; i < orders.length; i++) {
      if (i > 0) await clickAt(page, page.getByRole('button', { name: 'Add Row' }).first());
      await page.getByPlaceholder('MM/DD/YYYY').nth(i).fill(orders[i].date);
      await page.getByPlaceholder("Enter doctor's order or action taken").nth(i).fill(orders[i].action);
    }
    await page.getByPlaceholder("Enter doctor's order or action taken").first().scrollIntoViewIfNeeded();
  });

  // ── SECTIONS V + VI ───────────────────────────────────────────────────────
  await beat('drugs', async () => {
    await gotoTab(page, 'tab-drugs');
    for (let i = 0; i < CLAIM.medicines.length; i++) {
      const m = CLAIM.medicines[i];
      if (i > 0) await clickAt(page, page.getByRole('button', { name: 'Add Row' }).last());
      await typeInto(page, page.locator(`#medicine-genericName-${i}`), m.genericName, 3);
      await typeInto(page, page.locator(`#medicine-dosage-${i}`), m.dosage, 3);
      await typeInto(page, page.locator(`#medicine-cost-${i}`), m.cost, 3);
      await page.locator(`#medicine-genericNameCont-${i}`).fill(m.cont);
    }
    await gotoTab(page, 'tab-outcome');
    await setChecked(page, page.locator('#outcome-improved'));
    await typeInto(page, page.locator('#outcomeReason'), CLAIM.outcomeReason, 3);
  });

  // ── ATTACH (first document only — the X-ray report is the missing one) ───
  await beat('attach', async () => {
    await page.getByText('Supporting Documents', { exact: true }).scrollIntoViewIfNeeded();
    await sleep(pace(400));
    await uploadVia(FILE_CBC, 1);
  });

  // ── VALIDATE #1 ───────────────────────────────────────────────────────────
  await beat('validate', async () => {
    await clickValidate();
    await dismissSubmitDialog(page);
  });

  let findings;
  await beat('validating', async () => {
    await badge(page, '⏩ Sped up — validation usually takes under a minute');
    findings = await waitForResult(page, 'validation #1');
    await badge(page, '');
  });

  // ── FINDINGS: show what the AI flagged ───────────────────────────────────
  console.log('\n=== AI FINDINGS (validation #1) ===');
  findings.items.forEach((t, i) => console.log(`  ${i + 1}. ${t.replace(/\s+/g, ' ')}`));
  const joined = findings.items.join(' ');
  const missing = EXPECTED_ISSUES.filter((e) => !e.re.test(joined)).map((e) => e.name);
  console.log(missing.length ? `!! NOT FLAGGED: ${missing.join('; ')}` : 'OK: all three expected issue types were flagged');
  if (missing.length && !DRY) throw new Error(`The AI did not flag: ${missing.join('; ')} — narration would not match. Aborting.`);

  await beat('findings', async () => {
    await dismissCompletedDialog(page);
    await shot('findings');
    const panel = await analysisPanel(page);
    await panel.scrollIntoViewIfNeeded();
    await sleep(pace(1200));
    const items = panel.locator('li');
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      await moveTo(page, items.nth(i));
      await sleep(pace(Math.max(900, (DUR.findings * 1000 - 2500) / Math.max(n, 1))));
    }
  });

  // ── FIX 1: missing doctor's orders ───────────────────────────────────────
  await beat('fixorders', async () => {
    await gotoTab(page, 'tab-course-ward');
    for (const o of CLAIM.missingOrders) {
      await clickAt(page, page.getByRole('button', { name: 'Add Row' }).first());
      const dates = page.getByPlaceholder('MM/DD/YYYY');
      const acts = page.getByPlaceholder("Enter doctor's order or action taken");
      const idx = (await dates.count()) - 1;
      await typeInto(page, dates.nth(idx), o.date, 25);
      await typeInto(page, acts.nth(idx), o.action, 2);
    }
  });

  // ── FIX 2: symptoms + chest exam ─────────────────────────────────────────
  await beat('fixsymptoms', async () => {
    await gotoTab(page, 'tab-admission-reason');
    for (const id of ['symptom-cough', 'symptom-dyspnea', 'symptom-chest-pain-discomfort']) {
      await setChecked(page, page.locator(`#${id}`));
    }
    const chest = examSection(page, 'CHEST/LUNGS:');
    await setChecked(page, chest.getByRole('checkbox', { name: 'Essentially normal', exact: true }).first(), false);
    await setChecked(page, chest.getByRole('checkbox', { name: 'Rales/crackles/rhonchi', exact: true }).first());
    await setChecked(page, chest.getByRole('checkbox', { name: 'Decreased breath sounds', exact: true }).first());
  });

  // ── FIX 3: the missing chest X-ray report ────────────────────────────────
  await beat('fixattach', async () => {
    await page.getByText('Supporting Documents', { exact: true }).scrollIntoViewIfNeeded();
    await sleep(pace(300));
    await uploadVia(FILE_XRAY, 2);
  });

  // ── VALIDATE #2 ───────────────────────────────────────────────────────────
  await beat('revalidate', async () => {
    await clickValidate();
    await dismissSubmitDialog(page);
  });

  let final;
  await beat('revalidating', async () => {
    await badge(page, '⏩ Sped up');
    final = await waitForResult(page, 'validation #2');
    await badge(page, '');
  });

  console.log('\n=== RESULT (validation #2) ===');
  console.log(final.items.length
    ? final.items.map((t, i) => `  ${i + 1}. ${t.replace(/\s+/g, ' ')}`).join('\n')
    : '  (no issues)  ' + final.text.replace(/\s+/g, ' ').slice(0, 200));
  if (final.items.length && !DRY) throw new Error('Corrected claim still has issues — narration says it passes. Aborting.');

  await beat('success', async () => {
    await dismissCompletedDialog(page);
    await shot('success');
    const panel = await analysisPanel(page);
    await panel.scrollIntoViewIfNeeded();
    await window_scrollTop(page);
    await moveTo(page, panel.getByText(/likely valid/i).first()).catch(() => {});
  });

  await beat('outro', async () => { await sleep(pace(300)); });
  current.end = now() + (DRY ? 0 : 0.5);
  await sleep(pace(600));

  const video = page.video();
  await context.close();
  await browser.close();

  if (DRY) {
    console.log('\n[dry run complete — no video recorded]');
    return;
  }
  const videoPath = await video.path();
  fs.writeFileSync(TIMING_OUT, JSON.stringify({ videoPath, totalSeconds: now(), beats: timing }, null, 2));
  console.log('VIDEO_PATH=' + videoPath);
  console.log('TIMING=' + TIMING_OUT);
})().catch(async (e) => {
  console.error('SCRIPT ERROR:', e);
  if (pageRef) {
    const f = path.join(SHOTS_DIR, 'error.png');
    await pageRef.screenshot({ path: f, fullPage: false }).then(() => console.error('Screenshot of failure:', f)).catch(() => {});
  }
  process.exit(1);
});

async function window_scrollTop(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await sleep(pace(300));
}
