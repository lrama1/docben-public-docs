/**
 * DocBen CF4 Validation API — minimal JavaScript client (Node 18+).
 * No external dependencies. Set DOCBEN_API_KEY before running.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.DOCBEN_BASE_URL || 'https://api.docbenai.com';
const API_KEY = process.env.DOCBEN_API_KEY; // set this env var — never hardcode your key
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

if (!API_KEY) {
  throw new Error('Set the DOCBEN_API_KEY environment variable.');
}

const headers = {
  'x-api-key': API_KEY,
  'Content-Type': 'application/json',
};

async function request(method, urlPath, body) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    err.body = data;
    throw err;
  }
  return data;
}

// ── Quota ──────────────────────────────────────────────────────
async function getQuota() {
  return request('GET', '/public/v1/quota');
}

// ── Attachment upload (init -> chunk(s) -> complete) ──────────
async function uploadAttachment(filePath) {
  const fileName = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  const size = buffer.length;
  const contentType = fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';

  const init = await request('POST', '/public/v1/uploads/init', { fileName, size, contentType });
  const { uploadId, attachmentId, s3Key } = init;

  const parts = [];
  const totalParts = Math.max(1, Math.ceil(size / CHUNK_SIZE));
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    const start = (partNumber - 1) * CHUNK_SIZE;
    const chunk = buffer.subarray(start, start + CHUNK_SIZE);
    const resp = await request('PUT', '/public/v1/uploads/chunk', {
      uploadId, attachmentId, s3Key, partNumber,
      chunkData: chunk.toString('base64'),
    });
    parts.push({ partNumber, etag: resp.etag });
  }

  const done = await request('POST', '/public/v1/uploads/complete', {
    uploadId, attachmentId, s3Key, parts, fileName, size, contentType,
  });
  return done.attachment;
}

// ── Submit validation ─────────────────────────────────────────
async function submitValidation(cf4Message, attachmentsMeta = []) {
  return request('POST', '/public/v1/validations', { message: cf4Message, attachmentsMeta });
}

// ── Poll for result ───────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForResult(sessionId, { intervalMs = 4000, timeoutMs = 180000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await request('GET', `/public/v1/validations/${sessionId}`);
    if (status.status === 'COMPLETED' || status.status === 'FAILED') return status;
    if (Date.now() > deadline) throw new Error('Timed out waiting for validation result.');
    await sleep(intervalMs);
  }
}

// ── Example usage ─────────────────────────────────────────────
async function main() {
  const cf4Message = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-cf4.json'), 'utf8'));

  const quota = await getQuota();
  console.log('Quota:', quota.requestsRemaining, 'requests left,', quota.tokensRemaining, 'tokens left');

  const attachments = [];
  // attachments.push(await uploadAttachment('./cbc-result.pdf'));

  const submitted = await submitValidation(cf4Message, attachments);
  console.log('Submitted. sessionId =', submitted.sessionId);

  const result = await waitForResult(submitted.sessionId);
  console.log('Status:', result.status, '| claimStatus:', result.claimStatus);
  console.log('Quality:', result.result && result.result.qualityPercentage);
  console.log('Rejections:', JSON.stringify(result.result && result.result.rejectionReason, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.status || '', err.code || '', err.message);
    process.exit(1);
  });
}

module.exports = { getQuota, uploadAttachment, submitValidation, waitForResult };
