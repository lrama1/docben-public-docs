/*
 * Generates SYNTHETIC supporting documents for the claim demo video:
 *   - a Complete Blood Count (CBC) laboratory result
 *   - a Chest X-ray (PA) radiology report
 *
 * Both belong to the FICTIONAL demo patient (REYES, JUAN S.) used in
 * record-claim-demo.js. No real patient data. Rendered to PNG with Playwright
 * so the app (and Textract OCR on the backend) can read them like scanned forms.
 *
 * Run from video-src/<folder> (after `npm install` in video-src):  node make-sample-attachments.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'demo', 'claim', 'sample-attachments');

const css = `
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; background: #fff; }
  .page { width: 1000px; padding: 48px 56px; box-sizing: border-box; }
  .hdr { text-align: center; border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 18px; }
  .hdr .h1 { font-size: 26px; font-weight: 700; letter-spacing: 1px; }
  .hdr .h2 { font-size: 15px; margin-top: 4px; }
  .title { text-align: center; font-size: 24px; font-weight: 700; margin: 14px 0 18px; text-decoration: underline; }
  .meta { font-size: 19px; line-height: 1.75; margin-bottom: 16px; }
  .meta b { display: inline-block; min-width: 190px; }
  table { width: 100%; border-collapse: collapse; font-size: 19px; margin-top: 6px; }
  th, td { border: 1.5px solid #222; padding: 9px 12px; text-align: left; }
  th { background: #eee; }
  .sec { font-size: 20px; font-weight: 700; margin: 20px 0 6px; }
  .body { font-size: 19px; line-height: 1.6; }
  .sig { margin-top: 56px; font-size: 18px; line-height: 1.7; }
  .sig .line { border-top: 1.5px solid #111; width: 340px; margin-top: 44px; padding-top: 4px; }
`;

const header = `
  <div class="hdr">
    <div class="h1">DEMO RIVERSIDE HOSPITAL</div>
    <div class="h2">123 Sample Avenue, Quezon City, Metro Manila &bull; Tel. (02) 8000-0000</div>
  </div>`;

const cbc = `
<html><head><style>${css}</style></head><body><div class="page">
  ${header}
  <div class="title">CLINICAL LABORATORY REPORT &mdash; COMPLETE BLOOD COUNT</div>
  <div class="meta">
    <div><b>Name:</b> REYES, JUAN S.</div>
    <div><b>Age:</b> 50 years</div>
    <div><b>Sex:</b> Male</div>
    <div><b>Date:</b> 06/10/2025</div>
    <div><b>Requesting Physician:</b> Dr. Maria Dela Pena, MD</div>
  </div>
  <table>
    <tr><th>Test</th><th>Result</th><th>Reference Range</th><th>Flag</th></tr>
    <tr><td>White Blood Cell (WBC)</td><td>15.8 x10^9/L</td><td>4.5 - 11.0</td><td>HIGH</td></tr>
    <tr><td>Red Blood Cell (RBC)</td><td>4.9 x10^12/L</td><td>4.5 - 5.9</td><td></td></tr>
    <tr><td>Hemoglobin</td><td>14.2 g/dL</td><td>13.5 - 17.5</td><td></td></tr>
    <tr><td>Hematocrit</td><td>0.42</td><td>0.41 - 0.53</td><td></td></tr>
    <tr><td>Platelet Count</td><td>310 x10^9/L</td><td>150 - 450</td><td></td></tr>
    <tr><td>Neutrophils</td><td>0.82</td><td>0.50 - 0.70</td><td>HIGH</td></tr>
    <tr><td>Lymphocytes</td><td>0.14</td><td>0.20 - 0.40</td><td>LOW</td></tr>
  </table>
  <div class="sig">
    <div class="line">Medical Technologist &mdash; License No. 0123456</div>
    <div class="line">Pathologist &mdash; License No. 0234567</div>
  </div>
</div></body></html>`;

const xray = `
<html><head><style>${css}</style></head><body><div class="page">
  ${header}
  <div class="title">RADIOLOGY REPORT &mdash; CHEST X-RAY (PA VIEW)</div>
  <div class="meta">
    <div><b>Name:</b> REYES, JUAN S.</div>
    <div><b>Age:</b> 50 years</div>
    <div><b>Sex:</b> Male</div>
    <div><b>Date:</b> 06/10/2025</div>
    <div><b>Requesting Physician:</b> Dr. Maria Dela Pena, MD</div>
  </div>
  <div class="sec">FINDINGS</div>
  <div class="body">
    Patchy airspace consolidation with air bronchograms is seen in the right lower
    lung zone. No pleural effusion. The costophrenic angles are sharp. The heart is
    not enlarged. The trachea is midline. The visualized bony thorax is unremarkable.
  </div>
  <div class="sec">IMPRESSION</div>
  <div class="body">
    Right lower lobe pneumonia. Clinical correlation and follow-up chest X-ray
    after treatment are suggested.
  </div>
  <div class="sig">
    <div class="line">Radiologist &mdash; License No. 0345678</div>
  </div>
</div></body></html>`;

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1.5 });
  const docs = [
    ['CBC-Result-Reyes-Juan.png', cbc],
    ['Chest-XRay-Report-Reyes-Juan.png', xray],
  ];
  for (const [name, html] of docs) {
    await page.setContent(html, { waitUntil: 'load' });
    const file = path.join(OUT_DIR, name);
    await page.screenshot({ path: file, fullPage: true });
    console.log('wrote', file, Math.round(fs.statSync(file).size / 1024) + ' KB');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
