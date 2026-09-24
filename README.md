# DocBen Public Documentation

Public-facing documentation for DocBen products and APIs. This repo is served as
a static site (e.g. via GitHub Pages).

## Contents

| Path | What it is |
|---|---|
| [`index.html`](index.html) | Landing page linking to everything below |
| [`cf4-api/`](cf4-api/) | **PhilHealth Claims API** — everything a 3rd-party integrator needs |
| [`cf4-api/README.md`](cf4-api/README.md) | Integration guide (auth, quotas, endpoints, attachments, samples, errors, FAQ) |
| [`cf4-api/openapi.yaml`](cf4-api/openapi.yaml) | OpenAPI 3.0 spec (generate SDKs, import to Postman, render docs) |
| [`cf4-api/examples/`](cf4-api/examples/) | JavaScript + TypeScript client examples |
| [`cf4-api/test-client/`](cf4-api/test-client/) | Browser-only manual test client |
| [`cf4-api/bruno/`](cf4-api/bruno/) | Bruno API collection |
| [`docben-dictation-app3/privacy-policy.html`](docben-dictation-app3/privacy-policy.html) | Privacy policy for the DocBen Dictation app |

## Publishing

This repo contains **no secrets and no real personal data** — the sample claim
payload uses placeholder values (e.g. "John Doe"). API keys are issued per
client and are never stored here.

To serve via GitHub Pages: enable **Settings → Pages → Deploy from branch**,
choose the default branch and the repository root. The included `_config.yml`
and `index.html` are all that's needed.

<!-- build nudge: re-trigger GitHub Pages DNS check for docs.docbenai.com -->
