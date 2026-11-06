/*
 * Builds the final narrated claim-demo video from the raw Playwright recording:
 *   - cuts the recording into one segment per beat (timing.json)
 *   - "compress" beats (sign-in wait, AI validation waits) are sped up so they last
 *     only as long as their narration (or frozen on the last frame if shorter)
 *   - each narration clip starts exactly where its beat starts on the OUTPUT timeline
 * Run from video-src/<folder> (after `npm install` in video-src):  node mux-claim-narration.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = require('ffmpeg-static');
const DIR = path.join(__dirname, 'demo', 'claim');
const NARR = path.join(DIR, 'narration');
const script = require('./claim-demo-script.json');
const DUR = JSON.parse(fs.readFileSync(path.join(DIR, 'durations.json'), 'utf8'));
const TIMING = JSON.parse(fs.readFileSync(path.join(DIR, 'timing.json'), 'utf8'));
const OUT = path.join(DIR, 'docben-ai-create-claim-demo.mp4');

const compress = new Set(script.beats.filter((b) => b.compress).map((b) => b.key));
const LEAD = 0.25; // narration starts a hair after the beat's first frame
const FPS = 25;

// Output length of each beat. A "compress" beat that had no real wait (e.g. the
// sign-in finished inside the previous beat) is dropped along with its narration:
// there is nothing on screen for it to describe, and a 0-length trim yields no
// frames while its narration would still reserve time -> audio/video drift.
const MIN_REAL_WAIT = 0.5;
const beats = TIMING.beats
  .map((b) => {
    const real = b.end - b.start;
    const out = compress.has(b.key) ? Math.max(DUR[b.key] + 0.8, 1.5) : real;
    return { ...b, real, out };
  })
  .filter((b) => {
    const drop = compress.has(b.key) && b.real < MIN_REAL_WAIT;
    if (drop) console.log(`  (skipping "${b.key}": no real wait happened, ${b.real.toFixed(2)}s)`);
    return !drop;
  });

// The Playwright WebM is VARIABLE frame rate (a frame exists only when the screen
// changes). Cutting it directly is wrong: `trim` drops the still-displayed frame
// that predates a cut point and `setpts=PTS-STARTPTS` then re-zeroes the segment at
// its first *kept* frame, silently skipping any static stretch at the segment's
// start — the video drifts ahead of the narration. Convert to constant frame rate
// first so every cut is exact.
const CFR = path.join(DIR, 'video', 'raw-cfr.mp4');
console.log('Normalising recording to constant frame rate...');
execFileSync(FFMPEG, [
  '-y', '-hide_banner', '-loglevel', 'error', '-i', TIMING.videoPath,
  '-vf', `fps=${FPS}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', CFR,
], { stdio: 'inherit' });

const vf = [];
beats.forEach((b, i) => {
  let chain = `[0:v]trim=start=${b.start.toFixed(3)}:end=${b.end.toFixed(3)},setpts=PTS-STARTPTS`;
  if (compress.has(b.key)) {
    if (b.real > b.out) chain += `,setpts=PTS*${(b.out / b.real).toFixed(5)}`; // speed up
    else if (b.real < b.out) chain += `,tpad=stop_mode=clone:stop_duration=${(b.out - b.real).toFixed(3)}`; // hold last frame
  }
  chain += `,fps=${FPS},format=yuv420p[v${i}]`;
  vf.push(chain);
});
const concatIn = beats.map((_, i) => `[v${i}]`).join('');
vf.push(`${concatIn}concat=n=${beats.length}:v=1:a=0[vout]`);

// Narration placement on the output timeline.
const args = ['-y', '-i', CFR];
const af = [];
let cursor = 0;
beats.forEach((b, i) => {
  args.push('-i', path.join(NARR, `claim-${b.key}.mp3`));
  const ms = Math.round((cursor + LEAD) * 1000);
  af.push(`[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`);
  cursor += b.out;
});
const mixIns = beats.map((_, i) => `[a${i}]`).join('');
af.push(`${mixIns}amix=inputs=${beats.length}:normalize=0,volume=2.2,alimiter=limit=0.9,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[aout]`);

args.push(
  '-filter_complex', [...vf, ...af].join(';'),
  '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
  '-movflags', '+faststart',
  OUT,
);

console.log(`Beats: ${beats.length} | output length ≈ ${cursor.toFixed(1)}s (raw recording ${TIMING.totalSeconds.toFixed(1)}s)`);
beats.forEach((b) => console.log(`  ${b.key.padEnd(13)} real ${b.real.toFixed(1).padStart(6)}s -> out ${b.out.toFixed(1).padStart(6)}s${compress.has(b.key) ? '  (compressed)' : ''}`));
execFileSync(FFMPEG, args, { stdio: 'inherit' });
console.log('WROTE=' + OUT);
console.log('SIZE_MB=' + (fs.statSync(OUT).size / 1048576).toFixed(2));

// Publish: the site serves videos/ (the work folder demo/ is gitignored).
const PUBLISHED = path.resolve(__dirname, '..', '..', 'videos', path.basename(OUT));
fs.copyFileSync(OUT, PUBLISHED);
console.log('PUBLISHED=' + PUBLISHED);
