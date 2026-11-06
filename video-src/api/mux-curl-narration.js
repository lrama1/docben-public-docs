/*
 * Muxes the curl narration into the recorded curl/code integration video.
 * Run from video-src/<folder> (after `npm install` in video-src):  node mux-curl-narration.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = require('ffmpeg-static');
const BASE = path.resolve(__dirname, '..', '..', 'videos');
const NARR_DIR = path.join(BASE, 'narration');
const TIMING = JSON.parse(fs.readFileSync(path.join(BASE, 'timing-curl.json'), 'utf8'));
const VIDEO = TIMING.__videoPath;
const OUT = path.join(BASE, 'api-integration-curl.mp4');

const order = ['intro', 'auth', 'quota', 'submit', 'poll', 'result', 'outro'];

const args = ['-y', '-i', VIDEO];
order.forEach((k) => args.push('-i', path.join(NARR_DIR, `curl-${k}.mp3`)));

const delays = order.map((k, i) => `[${i + 1}:a]adelay=${Math.round(TIMING[k] * 1000)}|${Math.round(TIMING[k] * 1000)}[a${i}]`);
const mixIns = order.map((_, i) => `[a${i}]`).join('');
const filter = `${delays.join(';')};${mixIns}amix=inputs=${order.length}:normalize=0,volume=2.2,alimiter=limit=0.9,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[aout]`;

args.push(
  '-filter_complex', filter,
  '-map', '0:v', '-map', '[aout]',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
  '-movflags', '+faststart', '-shortest',
  OUT,
);

console.log('Running ffmpeg mux...');
execFileSync(FFMPEG, args, { stdio: 'inherit' });
console.log('WROTE=' + OUT);
console.log('SIZE_KB=' + Math.round(fs.statSync(OUT).size / 1024));
