# Video generation

Everything that generates the docs videos lives here. Final videos are written to [`../videos/`](../videos/), which is what the site serves. This folder is excluded from the published site (`exclude:` in `_config.yml`).

> **This is a public repo.** Never hardcode keys or passwords in these scripts â€” they are read from environment variables. Raw screen recordings (`videos/raw`, `webapp/demo`) are gitignored because they can capture credentials.

## Setup (once)

```powershell
cd video-src
npm install            # playwright + ffmpeg-static
npx playwright install chromium
pip install edge-tts   # narration (voice: en-US-JennyNeural)
```

## What makes what

| Folder | Output (`../videos/`) | Environment |
|---|---|---|
| `promo/` | `claims-api-promo.mp4` â€” motion-graphic promo (both adoption paths) | â€” |
| `api/` | `api-integration-test-client.mp4`, `api-integration-curl.mp4` | `DEMO_API_KEY` |
| `webapp/` | `docben-ai-create-claim-demo.mp4` â€” web app walkthrough | `DEMO_USERNAME`, `DEMO_PASSWORD` |

### Promo
```powershell
python promo/generate-promo-audio.py   # narration + music from promo/promo-script.json
node promo/build-promo.js              # scene durations at the top of build-promo.js must match the narration lengths
```

### API walkthroughs
```powershell
$env:DEMO_API_KEY = '<demo key>'
node api/record-api-integration-demo.js   # or record-curl-demo.js
python api/generate-narration-api.py
node api/mux-api-client-narration.js      # or mux-curl-narration.js
```

### Web app walkthrough (script: `webapp/claim-demo-script.json`)
Run from `video-src/webapp`, in order:
```powershell
node make-sample-attachments.js           # fictional lab/imaging report images
python generate-narration-claim.py        # one MP3 per beat
node measure-narration-claim.js           # durations.json (recorder holds each beat for its narration)
$env:DEMO_USERNAME = '<user>'; $env:DEMO_PASSWORD = '<password>'
node record-claim-demo.js                 # records the live app (add --dry to test without recording)
node mux-claim-narration.js               # builds the MP4 and copies it to ../../videos/
node verify-claim-sync.js                 # checks audio/video sync
```
Work files go to `webapp/demo/claim/` (gitignored).

## Not here
The admin-UI videos (onboard tenant, add user, rotate key) show the internal admin tool, so their scripts stay in `docben-ai3` and write to `docben-admin-ui3/demo`.
