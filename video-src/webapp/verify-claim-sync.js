/*
 * Objective sync check for the claim demo: for every NON-compressed beat, compare a
 * frame 1.5s into the beat in the FINAL video (at its cumulative output time) with
 * the same moment in the RAW recording. Cuts are exact only if they match (small
 * PSNR-style difference). Prints a table; exit code 1 if any beat is off.
 * Run from video-src/<folder> (after `npm install` in video-src):  node verify-claim-sync.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = require('ffmpeg-static');
const DIR = path.join(__dirname, 'demo', 'claim');
const script = require('./claim-demo-script.json');
const DUR = JSON.parse(fs.readFileSync(path.join(DIR, 'durations.json'), 'utf8'));
const TIMING = JSON.parse(fs.readFileSync(path.join(DIR, 'timing.json'), 'utf8'));
const FINAL = path.join(DIR, 'docben-ai-create-claim-demo.mp4');
const RAW = path.join(DIR, 'video', 'raw-cfr.mp4');
const TMP = path.join(DIR, 'shots', 'sync');
fs.mkdirSync(TMP, { recursive: true });

const compress = new Set(script.beats.filter((b) => b.compress).map((b) => b.key));
// Compare the FIRST frames of each beat: that is where cut accuracy is decided, and
// it avoids false alarms from fast animation later in the beat. 0.12s = 3 frames in,
// so a frame of rounding at the boundary cannot tip the comparison.
const OFFSET = 0.12;

function frame(file, t, out) {
  spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=360:-1', out]);
}
function psnr(a, b) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /average:([\d.]+|inf)/.exec(r.stderr || '');
  return m ? (m[1] === 'inf' ? 99 : Number(m[1])) : NaN;
}

let cursor = 0;
let bad = 0;
let maxOffset = 0;
const starts = []; // output-timeline start of each beat (for the audio check)
console.log('beat           raw_t   final_t   PSNR(dB)   verdict');
for (const b of TIMING.beats) {
  const real = b.end - b.start;
  const skip = compress.has(b.key) && real < 0.5;
  if (skip) continue;
  const out = compress.has(b.key) ? Math.max(DUR[b.key] + 0.8, 1.5) : real;
  starts.push({ key: b.key, at: cursor });
  if (!compress.has(b.key) && real > OFFSET + 0.5) {
    const rawT = b.start + OFFSET;
    const finT = cursor + OFFSET;
    frame(FINAL, finT, path.join(TMP, `${b.key}_fin.png`));
    const score = (d) => {
      frame(RAW, Math.max(0, rawT + d), path.join(TMP, `${b.key}_raw.png`));
      return psnr(path.join(TMP, `${b.key}_raw.png`), path.join(TMP, `${b.key}_fin.png`));
    };
    const p0 = score(0); // the claim: final frame == raw frame at the same beat-relative moment
    // Search +-0.4s at 40ms (1 frame) steps for the best match.
    let best = { p: p0, d: 0 };
    for (let k = -10; k <= 10; k++) {
      if (k === 0) continue;
      const d = k * 0.04;
      const p = score(d);
      if (p > best.p) best = { p, d: Number(d.toFixed(2)) };
    }
    // Acceptable if the best-matching raw frame is within 2 frames (80ms) of the
    // intended moment AND the match is a good one. One frame (40ms) of boundary
    // rounding is expected from the 25fps grid and is below perceptual A/V sync
    // tolerance (ITU-R BT.1359: detectable at ~+45ms / -125ms). Static screens,
    // where many offsets tie, pass via the tolerance.
    // A beat passes if EITHER the intended moment itself is an excellent match
    // (>=45dB ~ visually identical; this is what a static screen looks like, where
    // many offsets tie and "best" is arbitrary) OR the best-matching moment is
    // within tolerance. It fails only when the intended moment is a poor match AND
    // the real match sits further away — i.e. a genuine offset.
    const ok = p0 >= 45 || (Math.abs(best.d) <= 0.08 + 1e-9 && best.p >= 28);
    maxOffset = Math.max(maxOffset, Math.abs(best.d));
    if (!ok) bad++;
    console.log(`${b.key.padEnd(13)} ${rawT.toFixed(2).padStart(7)} ${finT.toFixed(2).padStart(8)}  PSNR@0 ${p0.toFixed(1).padStart(5)}  best ${best.p.toFixed(1).padStart(5)} @${String(best.d).padStart(5)}s  ${ok ? 'OK' : 'MISMATCH'}`);
  } else {
    console.log(`${b.key.padEnd(13)} ${'-'.padStart(6)} ${cursor.toFixed(1).padStart(9)} ${'-'.padStart(10)}   (${compress.has(b.key) ? 'compressed' : 'short'} - not compared)`);
  }
  cursor += out;
}
console.log(bad
  ? `\nVIDEO: ${bad} beat(s) out of tolerance`
  : `\nVIDEO: all compared beats match the raw recording (max offset ${maxOffset.toFixed(2)}s)`);

// ── AUDIO: does each narration clip begin where its beat begins? ─────────────
// Detect speech onsets in the final mix (silence_end == speech starts) and compare
// each beat's nearest onset with where the mux was told to place it (beat start +
// LEAD). edge-tts clips carry a little leading silence, so allow a small positive lag.
const LEAD = 0.25;
const sd = spawnSync(FFMPEG, ['-hide_banner', '-i', FINAL, '-af', 'silencedetect=noise=-32dB:d=0.3', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
const onsets = [...(sd.stderr || '').matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
console.log('\nbeat           beat_start  expected_onset  detected_onset   lag(s)');
let audioBad = 0;
for (const s of starts) {
  const expected = s.at + LEAD;
  const det = onsets.find((t) => t >= s.at - 0.05);
  if (det === undefined) { console.log(`${s.key.padEnd(13)} ${s.at.toFixed(2).padStart(10)}  no speech onset found`); audioBad++; continue; }
  const lag = det - expected;
  // Speech may start up to ~0.5s after the clip's nominal start (leading silence in
  // the MP3) but must never precede the beat, and must belong to THIS beat.
  const ok = lag >= -0.15 && lag <= 0.6;
  if (!ok) audioBad++;
  console.log(`${s.key.padEnd(13)} ${s.at.toFixed(2).padStart(10)} ${expected.toFixed(2).padStart(14)} ${det.toFixed(2).padStart(15)} ${lag.toFixed(2).padStart(9)}   ${ok ? 'OK' : 'OFF'}`);
}
console.log(audioBad ? `\nAUDIO: ${audioBad} narration clip(s) misplaced` : '\nAUDIO: every narration clip starts with its beat');
process.exit(bad || audioBad ? 1 : 0);
