/*
 * Builds the DocBen claim-validation promo video (web app + API):
 * branded motion-graphic slides (one per scene), cross-faded, with per-scene
 * Jenny narration + a soft music bed. Output: 1920x1080 H.264 + AAC MP4.
 *
 * Scene durations are synced to the measured narration clip lengths.
 * Run from video-src/<folder> (after `npm install` in video-src):  node build-promo.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = require('ffmpeg-static');
const ROOT = path.resolve(__dirname, '..', '..');           // docben-public-docs
const BASE = path.join(ROOT, 'videos', 'promo');
const OUT = path.join(ROOT, 'videos', 'claims-api-promo.mp4');
const FONT = 'C\\:/Windows/Fonts/arialbd.ttf';
const FONT_REG = 'C\\:/Windows/Fonts/arial.ttf';
const LOGO = path.join(ROOT, 'assets', 'img', 'docben_wordmark.png');
const ICONS = path.join(ROOT, 'assets', 'icons');
const SHOT_RESULT = path.join(ROOT, 'assets', 'img', 'shot-client-result.png');
const W = 1920, H = 1080, FPS = 30, XF = 0.6; // crossfade seconds

// Measured narration durations (s) + a small tail pause per scene.
const TAIL = 0.7;
const scenes = [
  { id: 'hook',      narr: 3.24, bg: '0x0B1220', accent: '0xE57373', icon: 'doc.png',    headline: '1 in 5 claims\\ndenied.', sub: 'Every denial means rework, delay, and lost revenue.' },
  { id: 'pain',      narr: 7.42, bg: '0x0B1220', accent: '0xE57373', icon: 'wave.png',   headline: 'The cost of a\\ndirty claim', sub: 'Missing fields  ·  inconsistent data  ·  weeks of delay' },
  { id: 'turn',      narr: 3.65, bg: '0x1976D2', accent: 'white',    icon: 'shield.png', headline: 'Catch it before\\nPhilHealth does.', sub: '' },
  { id: 'product',   narr: 7.61, bg: '0x1976D2', accent: 'white',    icon: 'shield.png', headline: 'Validate every claim,\\nbefore you submit.', sub: 'Completeness  ·  consistency  ·  PhilHealth rules — in seconds' },
  { id: 'proof',     narr: 9.60, bg: '0x0B1220', accent: '0x66BB6A', icon: 'chart.png',  headline: 'Score  ·  reasons  ·  DRG', sub: 'Fix it once. Submit clean the first time.', shot: SHOT_RESULT },
  { id: 'integrate', narr: 7.99, bg: '0x0B1220', accent: '0x64B5F6', icon: 'edit.png',   headline: 'Two ways to use DocBen', sub: 'A  ·  Web app      B  ·  API' },
  { id: 'cta',       narr: 7.63, bg: '0x1976D2', accent: 'white',    headline: 'Stop reacting to denials.\\nStart preventing them.', sub: 'docs.docbenai.com', logo: true },
];

const escDraw = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\''").replace(/,/g, '\\,').replace(/;/g, '\\;');

// Per-scene slide video. `icon`/`shot` (if present) are composited as extra inputs.
function slideFilter(sc, dur) {
  const headlineLines = sc.headline.split('\\n');
  const f = [];
  const white = sc.accent === 'white';
  const headColor = white ? 'white' : sc.accent;
  const subColor = white ? '0xE3F2FD' : '0x9FB3C8';
  const n = headlineLines.length;

  // Layout: when a screenshot is present, text goes on the left, shot on the right.
  const withShot = Boolean(sc.shot);
  const textX = withShot ? 'x=110' : 'x=(w-text_w)/2';
  const headY = (i) => (n === 1 ? '(h-text_h)/2-40' : `(h-text_h)/2-${80 - i * 110}`);

  headlineLines.forEach((ln, i) => {
    f.push(`drawtext=fontfile=${FONT}:text='${escDraw(ln)}':fontsize=${withShot ? 68 : 92}:fontcolor=${headColor}:${textX}:y=${headY(i)}:alpha='if(lt(t,0.4),t/0.4,1)'`);
  });
  if (sc.sub) {
    f.push(`drawtext=fontfile=${FONT_REG}:text='${escDraw(sc.sub)}':fontsize=${withShot ? 34 : 40}:fontcolor=${subColor}:${textX}:y=(h-text_h)/2+${n === 1 ? 90 : 150}:alpha='if(lt(t,0.7),max(0,(t-0.3)/0.4),1)'`);
  }
  // thin accent underline just above the headline block
  f.push(`drawbox=x=${withShot ? '110' : '(w-560)/2'}:y=(h)/2-${n === 1 ? 120 : 150}:w=560:h=6:color=${headColor}@0.9:t=fill`);
  return f.join(',');
}

(async () => {
  const tmp = path.join(BASE, 'build');
  fs.mkdirSync(tmp, { recursive: true });

  // 1. Render each scene slide to its own mp4 (video only).
  const slideFiles = [];
  scenes.forEach((sc, i) => {
    const dur = sc.narr + TAIL;
    const f = path.join(tmp, `slide-${i}.mp4`);
    const vf = slideFilter(sc, dur);
    let cmd;
    if (sc.logo) {
      // brand bg + centered wordmark (top ~58%, tagline fully cropped off) above the text
      cmd = ['-y', '-f', 'lavfi', '-i', `color=c=${sc.bg}:s=${W}x${H}:r=${FPS}:d=${dur}`,
        '-i', LOGO, '-filter_complex',
        `[1:v]crop=iw:ih*0.58:0:0,scale=860:-1[logo];[0:v][logo]overlay=(W-w)/2:110,${vf}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS), f];
    } else if (sc.shot) {
      // text on the left + product screenshot on the right (sized/positioned to clear text)
      cmd = ['-y', '-f', 'lavfi', '-i', `color=c=${sc.bg}:s=${W}x${H}:r=${FPS}:d=${dur}`,
        '-i', sc.shot, '-i', `${ICONS}\\${sc.icon}`, '-filter_complex',
        `[1:v]scale=760:-1,format=rgba,colorchannelmixer=aa=0.98[shot];` +
        `[2:v]scale=96:-1[ic];` +
        `[0:v][shot]overlay=W-w-60:(H-h)/2+90[tmp1];` +
        `[tmp1][ic]overlay=110:110,${vf}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS), f];
    } else {
      // centered text + the scene icon centered above the headline
      cmd = ['-y', '-f', 'lavfi', '-i', `color=c=${sc.bg}:s=${W}x${H}:r=${FPS}:d=${dur}`,
        '-i', `${ICONS}\\${sc.icon}`, '-filter_complex',
        `[1:v]scale=110:-1[ic];[0:v][ic]overlay=(W-w)/2:(H/2)-260,${vf}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS), f];
    }
    execFileSync(FFMPEG, cmd, { stdio: 'pipe' });
    slideFiles.push({ f, dur });
    console.log(`slide ${i} (${sc.id}) ${dur.toFixed(2)}s`);
  });

  // 2. Chain crossfades across slides.
  let inputs = [];
  slideFiles.forEach((s) => inputs.push('-i', s.f));
  // narration inputs
  scenes.forEach((sc) => inputs.push('-i', path.join(BASE, `narr-${sc.id}.mp3`)));
  // music input
  inputs.push('-i', path.join(BASE, 'music.wav'));

  const nS = slideFiles.length;
  // video xfade chain
  let vchain = '';
  let offset = 0;
  let prev = '[0:v]';
  let cumDur = slideFiles[0].dur;
  for (let i = 1; i < nS; i++) {
    offset = cumDur - XF;
    const out = i === nS - 1 ? '[vout]' : `[vx${i}]`;
    vchain += `${prev}[${i}:v]xfade=transition=fade:duration=${XF}:offset=${offset.toFixed(2)}${out};`;
    prev = out === '[vout]' ? '[vout]' : `[vx${i}]`;
    cumDur = offset + slideFiles[i].dur;
  }
  const totalVideo = cumDur;

  // audio: narration sequential (each starts at the cumulative offset of its scene), music looped under.
  const nA = scenes.length;
  const musicIdx = nS + nA; // video inputs (0..nS-1) + narration inputs (nS..nS+nA-1) => music is next
  let achain = '';
  // narration delays
  let t = 0;
  const narrIdx = scenes.map((_, i) => nS + i); // input index of each narration
  const delays = [];
  scenes.forEach((sc, i) => {
    delays.push(`[${narrIdx[i]}:a]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)}[na${i}]`);
    t += slideFiles[i].dur - XF; // scenes overlap by XF; narration plays per scene start
  });
  const narrMixIns = scenes.map((_, i) => `[na${i}]`).join('');
  achain += delays.join(';') + ';';
  achain += `${narrMixIns}amix=inputs=${nA}:normalize=0[narrmix];`;
  // music: loop to video length, duck volume
  achain += `[${musicIdx}:a]aloop=loop=-1:size=2e9,atrim=0:${totalVideo.toFixed(2)},volume=0.18[mus];`;
  achain += `[narrmix][mus]amix=inputs=2:normalize=0,alimiter=limit=0.95,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[aout]`;

  const filter = vchain + achain;

  const finalArgs = ['-y', ...inputs,
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', '-shortest', OUT];

  console.log('combining', nS, 'slides, total ~' + totalVideo.toFixed(1) + 's ...');
  execFileSync(FFMPEG, finalArgs, { stdio: 'inherit' });
  console.log('WROTE=' + OUT);
  console.log('SIZE_KB=' + Math.round(fs.statSync(OUT).size / 1024));
})().catch((e) => { console.error('BUILD ERROR:', e); process.exit(1); });
