# DocBen PhilHealth Claims API — Test Client

A zero-dependency, browser-only app for manually exercising the public PhilHealth
Claims API exactly the way a 3rd-party integrator would. No build step, no
server — open it and point it at the API.

## Run it

Open `index.html` directly in your browser, or serve the folder (recommended,
so the browser treats it as a clean origin):

```powershell
# from this folder — any static server works
npx serve .
# or
python -m http.server 8080
```

Then open the printed URL (e.g. http://localhost:8080 or http://localhost:3000).

## Use it

1. **Connection** — enter the Base URL (pre-filled with the dev endpoint) and
   your API key, click **Save**. The key is stored only in your browser's
   `localStorage` and is sent only in the `x-api-key` header to the API.
2. **Quota** — click **Check Quota** to verify connectivity and see your
   monthly request/token usage and rate limit.
3. **Attachments (optional)** — pick one or more files. They upload via the
   3-step multipart flow (init → chunk → complete) and are referenced in the
   validation.
4. **Submit** — use the pre-loaded sample claim or switch to **Edit JSON**
   to customize it, then click **Submit for validation**.
5. **Result** — the app auto-polls every 4s until the validation is
   `COMPLETED` or `FAILED`, then shows the result JSON (quality %, rejection
   reasons) and refreshes your quota.

Every request is logged in the **Request log** panel so you can see the exact
`METHOD path → status` for each call.

## Notes

- The sample claim is the same one in `../sample-cf4.json`.
- Attachments are uploaded in 5 MB chunks (configurable via `CHUNK_SIZE` in `app.js`).
- This tool is for **manual** testing. For scripted integration, use the
  JavaScript/TypeScript clients in `../examples/` instead.
- Your API key is sensitive — this app keeps it local, but treat the machine
  you run it on as trusted.
