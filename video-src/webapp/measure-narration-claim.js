/*
 * Measures the duration (seconds) of every claim-demo narration clip and writes
 * demo/claim/durations.json. The recorder reads it so each on-screen beat holds
 * for exactly as long as its narration needs (no hand-measured constants).
 * Run from video-src/<folder> (after `npm install` in video-src):  node measure-narration-claim.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = require('ffmpeg-static');
const script = require('./claim-demo-script.json');
const DIR = path.join(__dirname, 'demo', 'claim');
const NARR = path.join(DIR, 'narration');

const durations = {};
for (const { key } of script.beats) {
  const file = path.join(NARR, `claim-${key}.mp3`);
  const r = spawnSync(FFMPEG, ['-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr || '');
  if (!m) throw new Error(`Could not read duration of ${file}`);
  durations[key] = +(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])).toFixed(2);
}
fs.writeFileSync(path.join(DIR, 'durations.json'), JSON.stringify(durations, null, 2));
const total = Object.values(durations).reduce((a, b) => a + b, 0);
console.log(durations);
console.log(`TOTAL narration: ${total.toFixed(1)}s`);
