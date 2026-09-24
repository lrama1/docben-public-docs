/**
 * DocBen PhilHealth Claims API — TypeScript client (Node 18+).
 * Set DOCBEN_API_KEY before running. Compile with tsc or run via ts-node.
 */

import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.DOCBEN_BASE_URL ?? 'https://api.docbenai.com';
const API_KEY = process.env.DOCBEN_API_KEY;
const CHUNK_SIZE = 5 * 1024 * 1024;

if (!API_KEY) throw new Error('Set the DOCBEN_API_KEY environment variable.');

// ── Types ─────────────────────────────────────────────────────
export interface Cf4Message {
  [key: string]: unknown;
}

export interface AttachmentMeta {
  attachmentId: string;
  s3Key: string;
  fileName: string;
  size: number;
  contentType: string;
}

export interface RejectionReason {
  fieldName: string;
  reason: string;
}

export interface ValidationResult {
  qualityPercentage: number | null;
  rejectionReason: RejectionReason[];
  drgClassification: string | null;
  drgClassificationDesc: string | null;
  drgSystem: string | null;
}

export interface ValidationStatus {
  sessionId: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  claimStatus: string | null;
  error: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  result: ValidationResult | null;
  attachments: AttachmentMeta[];
}

export interface SubmitResponse {
  message: string;
  sessionId: string;
  validationStatus: string;
  validationRequestId: string;
}

export interface QuotaResponse {
  clientId: string;
  status: string;
  monthlyRequestQuota: number | null;
  requestsUsed: number;
  requestsRemaining: number | null;
  monthlyTokenCap: number | null;
  tokensUsed: number;
  tokensRemaining: number | null;
  rateLimitRps: number | null;
  cycleStartDate: string | null;
  resetsOn: string;
}

export class DocbenApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'DocbenApiError';
  }
}

// ── HTTP helper ───────────────────────────────────────────────
const headers: Record<string, string> = {
  'x-api-key': API_KEY,
  'Content-Type': 'application/json',
};

async function request<T>(method: string, urlPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new DocbenApiError(data.message ?? `HTTP ${res.status}`, res.status, data.code, data);
  }
  return data as T;
}

// ── API methods ───────────────────────────────────────────────
export async function getQuota(): Promise<QuotaResponse> {
  return request<QuotaResponse>('GET', '/public/v1/quota');
}

export async function uploadAttachment(filePath: string): Promise<AttachmentMeta> {
  const fileName = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  const size = buffer.length;
  const contentType = fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';

  const init = await request<{ uploadId: string; attachmentId: string; s3Key: string }>(
    'POST', '/public/v1/uploads/init', { fileName, size, contentType },
  );
  const { uploadId, attachmentId, s3Key } = init;

  const parts: Array<{ partNumber: number; etag: string }> = [];
  const totalParts = Math.max(1, Math.ceil(size / CHUNK_SIZE));
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    const chunk = buffer.subarray((partNumber - 1) * CHUNK_SIZE, partNumber * CHUNK_SIZE);
    const resp = await request<{ etag: string }>('PUT', '/public/v1/uploads/chunk', {
      uploadId, attachmentId, s3Key, partNumber, chunkData: chunk.toString('base64'),
    });
    parts.push({ partNumber, etag: resp.etag });
  }

  const done = await request<{ attachment: AttachmentMeta }>('POST', '/public/v1/uploads/complete', {
    uploadId, attachmentId, s3Key, parts, fileName, size, contentType,
  });
  return done.attachment;
}

export async function submitValidation(
  message: Cf4Message,
  attachmentsMeta: AttachmentMeta[] = [],
): Promise<SubmitResponse> {
  return request<SubmitResponse>('POST', '/public/v1/validations', { message, attachmentsMeta });
}

/**
 * Submit a validation as a raw PhilHealth eClaims 3.0 XML document.
 * Attachments may be embedded as base64 <ATTACHMENTS><DOCUMENT> entries
 * (~6 MB combined inline limit).
 */
export async function submitValidationXml(xmlString: string): Promise<SubmitResponse> {
  const xmlHeaders: Record<string, string> = { 'x-api-key': API_KEY as string, 'Content-Type': 'application/xml' };
  const res = await fetch(`${BASE_URL}/public/v1/validations`, {
    method: 'POST',
    headers: xmlHeaders,
    body: xmlString,
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new DocbenApiError(data.message ?? `HTTP ${res.status}`, res.status, data.code, data);
  }
  return data as SubmitResponse;
}

export async function getValidation(sessionId: string): Promise<ValidationStatus> {
  return request<ValidationStatus>('GET', `/public/v1/validations/${sessionId}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForResult(
  sessionId: string,
  { intervalMs = 4000, timeoutMs = 180000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<ValidationStatus> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await getValidation(sessionId);
    if (status.status === 'COMPLETED' || status.status === 'FAILED') return status;
    if (Date.now() > deadline) throw new Error('Timed out waiting for validation result.');
    await sleep(intervalMs);
  }
}

// ── Example usage ─────────────────────────────────────────────
async function main(): Promise<void> {
  const cf4Message = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'sample-cf4.json'), 'utf8'),
  ) as Cf4Message;

  const quota = await getQuota();
  console.log(`Quota: ${quota.requestsRemaining} requests, ${quota.tokensRemaining} tokens remaining`);

  const submitted = await submitValidation(cf4Message);
  console.log('Submitted. sessionId =', submitted.sessionId);

  const result = await waitForResult(submitted.sessionId);
  console.log('Status:', result.status, '| claimStatus:', result.claimStatus);
  console.log('Quality:', result.result?.qualityPercentage);
  console.log('DRG:', result.result?.drgClassification, '-', result.result?.drgClassificationDesc);
  console.log('Rejections:', result.result?.rejectionReason);
}

main().catch((err) => {
  if (err instanceof DocbenApiError) {
    console.error(`API error ${err.status} ${err.code ?? ''}: ${err.message}`);
  } else {
    console.error('Error:', err);
  }
  process.exit(1);
});
