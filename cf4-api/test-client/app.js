/**
 * DocBen CF4 Validation API — browser test client.
 *
 * A dependency-free, client-side-only app that talks to the live public API
 * exactly like a 3rd-party integrator: x-api-key auth, multipart attachment
 * uploads, async validation submit, and result polling. No build step, no
 * server — the API key stays in the browser (localStorage) and is only sent
 * to the API in the x-api-key header.
 */

(() => {
  'use strict';

  const DEFAULT_BASE = 'https://api.docbenai.com';
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB, matching the docs

  const $ = (id) => document.getElementById(id);
  const els = {
    baseUrl: $('baseUrl'), apiKey: $('apiKey'), baseUrlTag: $('baseUrlTag'),
    toggleKey: $('toggleKey'), saveConn: $('saveConn'), connStatus: $('connStatus'),
    btnQuota: $('btnQuota'), quotaOut: $('quotaOut'),
    qReq: $('qReq'), qReqBar: $('qReqBar'), qTok: $('qTok'), qTokBar: $('qTokBar'),
    qRps: $('qRps'), qReset: $('qReset'), qClient: $('qClient'),
    fileInput: $('fileInput'), fileList: $('fileList'),
    cf4Json: $('cf4Json'), tabEdit: $('tabEdit'), tabSample: $('tabSample'),
    btnSubmit: $('btnSubmit'),
    resultStatus: $('resultStatus'), resultJson: $('resultJson'),
    sessionId: $('sessionId'), btnPoll: $('btnPoll'), btnAutoPoll: $('btnAutoPoll'), btnCopySession: $('btnCopySession'),
    log: $('log'), btnClearLog: $('btnClearLog'),
  };

  // ── State ──────────────────────────────────────────────────────
  const state = {
    attachments: [], // [{ attachmentId, s3Key, fileName, size, contentType, status }]
    sessionId: null,
    autoPollTimer: null,
  };

  // ── Persistence ────────────────────────────────────────────────
  function loadConn() {
    els.baseUrl.value = localStorage.getItem('docben.baseUrl') || DEFAULT_BASE;
    els.apiKey.value = localStorage.getItem('docben.apiKey') || '';
    els.baseUrlTag.textContent = els.baseUrl.value.replace(/^https?:\/\//, '');
  }
  function saveConn() {
    localStorage.setItem('docben.baseUrl', els.baseUrl.value.trim());
    localStorage.setItem('docben.apiKey', els.apiKey.value.trim());
    els.baseUrlTag.textContent = els.baseUrl.value.replace(/^https?:\/\//, '');
    setConnStatus('Saved.', 'ok');
  }

  // ── Logging ────────────────────────────────────────────────────
  function log(msg, cls = 'info') {
    const line = document.createElement('div');
    line.className = 'line';
    const t = new Date().toLocaleTimeString();
    line.innerHTML = `<span class="t">${t}</span><span class="${cls}">${escapeHtml(msg)}</span>`;
    els.log.prepend(line);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── HTTP helper ────────────────────────────────────────────────
  async function api(method, path, body) {
    const base = els.baseUrl.value.trim().replace(/\/$/, '');
    const key = els.apiKey.value.trim();
    if (!base || !key) throw new Error('Set the Base URL and API key first.');
    const url = `${base}${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    log(`${method} ${path} → ${res.status}`, res.ok ? 'ok' : 'err');
    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data.code;
      err.body = data;
      throw err;
    }
    return data;
  }

  function setConnStatus(msg, cls) {
    els.connStatus.innerHTML = msg ? `<span class="pill ${cls}">${escapeHtml(msg)}</span>` : '';
  }

  function setResultStatus(html) { els.resultStatus.innerHTML = html; }
  function pill(text, cls) { return `<span class="pill ${cls}">${escapeHtml(text)}</span>`; }

  // ── Quota ──────────────────────────────────────────────────────
  async function checkQuota() {
    els.btnQuota.disabled = true;
    try {
      const q = await api('GET', '/public/v1/quota');
      els.quotaOut.classList.remove('hidden');
      const reqUsed = q.requestsUsed ?? 0, reqQuota = q.monthlyRequestQuota;
      const tokUsed = q.tokensUsed ?? 0, tokCap = q.monthlyTokenCap;
      els.qReq.textContent = `${fmt(reqUsed)} / ${fmt(reqQuota)}`;
      els.qTok.textContent = `${fmt(tokUsed)} / ${fmt(tokCap)}`;
      els.qReqBar.style.width = pct(reqUsed, reqQuota);
      els.qTokBar.style.width = pct(tokUsed, tokCap);
      els.qRps.textContent = q.rateLimitRps ?? '—';
      els.qReset.textContent = q.resetsOn ?? '—';
      els.qClient.innerHTML = `clientId <span class="mono">${escapeHtml(q.clientId)}</span> · status <b>${escapeHtml(q.status)}</b>`;
      setConnStatus('Connected — quota retrieved', 'ok');
    } catch (e) {
      setConnStatus(`${e.status || ''} ${e.code || ''} ${e.message}`, 'err');
    } finally {
      els.btnQuota.disabled = false;
    }
  }
  const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString() : '—');
  const pct = (used, cap) => (Number.isFinite(cap) && cap > 0 ? `${Math.min(100, (used / cap) * 100)}%` : '0%');

  // ── Attachments ────────────────────────────────────────────────
  function renderFiles() {
    els.fileList.innerHTML = '';
    state.attachments.forEach((a, i) => {
      const item = document.createElement('div');
      item.className = 'fileitem';
      const statusPill = a.status === 'done' ? pill('uploaded', 'ok')
        : a.status === 'error' ? pill('error', 'err')
        : a.status === 'uploading' ? '<span class="spinner"></span>'
        : pill('pending', 'info');
      item.innerHTML = `
        <div>
          <div>${escapeHtml(a.fileName)}</div>
          <div class="meta">${fmt(a.size)} bytes · ${escapeHtml(a.contentType)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${statusPill}
          <button class="secondary small" data-i="${i}" ${a.status === 'uploading' ? 'disabled' : ''}>✕</button>
        </div>`;
      item.querySelector('button').addEventListener('click', () => {
        state.attachments.splice(i, 1);
        renderFiles();
      });
      els.fileList.appendChild(item);
    });
  }

  async function uploadOne(file) {
    const rec = {
      fileName: file.name,
      size: file.size,
      contentType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
      status: 'uploading',
    };
    state.attachments.push(rec);
    renderFiles();
    try {
      // 1. init
      const init = await api('POST', '/public/v1/uploads/init', {
        fileName: rec.fileName, size: rec.size, contentType: rec.contentType,
      });
      const { uploadId, attachmentId, s3Key } = init;

      // 2. chunk(s)
      const parts = [];
      const totalParts = Math.max(1, Math.ceil(rec.size / CHUNK_SIZE));
      for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
        const blob = file.slice((partNumber - 1) * CHUNK_SIZE, partNumber * CHUNK_SIZE);
        const buf = await blob.arrayBuffer();
        const chunkData = base64FromBuffer(buf);
        // eslint-disable-next-line no-await-in-loop
        const resp = await api('PUT', '/public/v1/uploads/chunk', {
          uploadId, attachmentId, s3Key, partNumber, chunkData,
        });
        parts.push({ partNumber, etag: resp.etag });
      }

      // 3. complete
      const done = await api('POST', '/public/v1/uploads/complete', {
        uploadId, attachmentId, s3Key, parts,
        fileName: rec.fileName, size: rec.size, contentType: rec.contentType,
      });
      Object.assign(rec, done.attachment, { status: 'done' });
      log(`Uploaded ${rec.fileName}`, 'ok');
    } catch (e) {
      rec.status = 'error';
      rec.error = e.message;
      log(`Upload failed for ${rec.fileName}: ${e.message}`, 'err');
    }
    renderFiles();
  }

  function base64FromBuffer(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  // ── Submit + poll ──────────────────────────────────────────────
  async function submitValidation() {
    let message;
    try {
      message = JSON.parse(els.cf4Json.value);
    } catch (e) {
      setResultStatus(pill('Invalid CF4 JSON: ' + e.message, 'err'));
      return;
    }
    const failed = state.attachments.filter((a) => a.status === 'error');
    const pending = state.attachments.filter((a) => a.status === 'uploading' || a.status === 'pending');
    if (pending.length) {
      setResultStatus(pill(`Wait — ${pending.length} attachment(s) still uploading`, 'warn'));
      return;
    }
    const attachmentsMeta = state.attachments
      .filter((a) => a.status === 'done')
      .map((a) => ({
        attachmentId: a.attachmentId, s3Key: a.s3Key, fileName: a.fileName,
        size: a.size, contentType: a.contentType,
      }));
    if (failed.length) log(`${failed.length} attachment(s) had errors and were excluded.`, 'err');

    els.btnSubmit.disabled = true;
    setResultStatus('<span class="spinner"></span> ' + pill('Submitting…', 'info'));
    try {
      const resp = await api('POST', '/public/v1/validations', { message, attachmentsMeta });
      state.sessionId = resp.sessionId;
      els.sessionId.value = resp.sessionId;
      els.btnPoll.disabled = false;
      els.btnAutoPoll.disabled = false;
      els.btnCopySession.disabled = false;
      setResultStatus(pill('PROCESSING', 'info') + ` <span class="hint">sessionId ${escapeHtml(resp.sessionId)}</span>`);
      els.resultJson.textContent = JSON.stringify(resp, null, 2);
      log(`Validation submitted (${attachmentsMeta.length} attachment(s))`, 'ok');
      startAutoPoll(); // auto-start polling for convenience
    } catch (e) {
      setResultStatus(pill(`${e.status || ''} ${e.code || ''}`, 'err') + ` <span class="hint">${escapeHtml(e.message)}</span>`);
      els.resultJson.textContent = JSON.stringify(e.body || { error: e.message }, null, 2);
    } finally {
      els.btnSubmit.disabled = false;
    }
  }

  async function pollOnce() {
    if (!state.sessionId) return;
    try {
      const s = await api('GET', `/public/v1/validations/${state.sessionId}`);
      els.resultJson.textContent = JSON.stringify(s, null, 2);
      if (s.status === 'COMPLETED') {
        const rr = (s.result && s.result.rejectionReason) || [];
        setResultStatus(
          pill(`COMPLETED · ${s.claimStatus}`, rr.length ? 'warn' : 'ok') +
          ` <span class="hint">quality ${s.result?.qualityPercentage ?? '—'} · ${rr.length} rejection(s)</span>`
        );
        stopAutoPoll();
        checkQuota(); // refresh usage after a completed run
      } else if (s.status === 'FAILED') {
        setResultStatus(pill('FAILED', 'err') + ` <span class="hint">${escapeHtml(s.error || '')}</span>`);
        stopAutoPoll();
      } else {
        setResultStatus('<span class="spinner"></span> ' + pill('PROCESSING', 'info'));
      }
    } catch (e) {
      setResultStatus(pill(`${e.status || ''} ${e.code || ''}`, 'err') + ` <span class="hint">${escapeHtml(e.message)}</span>`);
      stopAutoPoll();
    }
  }

  function startAutoPoll() {
    stopAutoPoll();
    els.btnAutoPoll.textContent = 'Stop auto-poll';
    state.autoPollTimer = setInterval(pollOnce, 4000);
    pollOnce();
  }
  function stopAutoPoll() {
    if (state.autoPollTimer) clearInterval(state.autoPollTimer);
    state.autoPollTimer = null;
    els.btnAutoPoll.textContent = 'Start auto-poll';
  }

  // ── Sample CF4 payload ─────────────────────────────────────────
  const SAMPLE = {
    hciName: 'Sample Hospital', accreditationNumber: 'H12345',
    patientLastName: 'Doe', patientFirstName: 'John', patientMiddleName: 'A',
    pin: '12-3456789-0', patientBirthDate: '1980-01-15',
    patientAddress: '123 Sample St.', patientZipCode: '1000',
    patientMobile: '09171234567', patientEmail: 'john.doe@example.com',
    age: '45', sex: 'male', membershipType: 'Direct Contributor',
    admitMonth: '01', admitDay: '15', admitYear: '2025',
    admitHour: '10', admitMinute: '30', admitAmPm: 'AM',
    dischargeMonth: '01', dischargeDay: '20', dischargeYear: '2025',
    dischargeHour: '14', dischargeMinute: '00', dischargeAmPm: 'PM',
    firstCaseRateCode: 'PNE', secondCaseRateCode: '',
    chiefComplaint: 'Fever and cough for 3 days',
    admittingDiagnosis: 'Community-acquired pneumonia',
    dischargeDiagnosis: 'Community-acquired pneumonia, resolved',
    historyPresentIllness: 'Patient is a 45-year-old male who presents with 3 days of fever, productive cough with yellowish sputum, and dyspnea. Symptoms began gradually with mild fever that progressed to 39°C. No chest pain or hemoptysis. No prior similar episodes.',
    pastMedicalHistory: 'Hypertension diagnosed 5 years ago, on amlodipine. No prior surgeries. No known drug allergies.',
    symptoms: ['Fever', 'Cough', 'Dyspnea'],
    physicalExam: {
      generalSurvey: ['Awake and alert'], heent: ['Essentially normal'],
      chest: ['Rales/crackles/rhonchi', 'Decreased breath sounds'], cvs: ['Essentially normal'],
      abdomen: ['Essentially normal'], gu: ['Essentially normal'],
      skin: ['Essentially normal'], neuro: ['Essentially normal'],
    },
    doctorsOrders: [
      { date: '01/15/2025', action: 'Admit, IV fluids, CBC, chest X-ray, start ceftriaxone' },
      { date: '01/16/2025', action: 'Continue IV antibiotics, monitor vitals q4h' },
      { date: '01/17/2025', action: 'Improving, continue antibiotics' },
      { date: '01/18/2025', action: 'Afebrile, downshift to oral antibiotics' },
      { date: '01/19/2025', action: 'Tolerating oral intake, prepare for discharge' },
      { date: '01/20/2025', action: 'Discharge home with oral antibiotics, follow-up in 1 week' },
    ],
    medicines: [
      { genericName: 'Ceftriaxone', brandName: 'Rocephin', dosage: '1g IV', quantity: '5', cost: '500.00' },
      { genericName: 'Paracetamol', brandName: 'Biogesic', dosage: '500mg PO', quantity: '10', cost: '50.00' },
    ],
    outcome: ['IMPROVED'], outcomeReason: '',
  };

  // ── Tabs ───────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      els.tabEdit.classList.toggle('hidden', which !== 'edit');
      els.tabSample.classList.toggle('hidden', which !== 'sample');
    });
  });

  // ── Wiring ─────────────────────────────────────────────────────
  els.saveConn.addEventListener('click', saveConn);
  els.toggleKey.addEventListener('click', () => {
    const isPw = els.apiKey.type === 'password';
    els.apiKey.type = isPw ? 'text' : 'password';
    els.toggleKey.textContent = isPw ? 'Hide' : 'Show';
  });
  els.btnQuota.addEventListener('click', checkQuota);
  els.fileInput.addEventListener('change', () => {
    Array.from(els.fileInput.files).forEach(uploadOne);
    els.fileInput.value = '';
  });
  els.btnSubmit.addEventListener('click', submitValidation);
  els.btnPoll.addEventListener('click', pollOnce);
  els.btnAutoPoll.addEventListener('click', () => {
    if (state.autoPollTimer) stopAutoPoll(); else startAutoPoll();
  });
  els.btnCopySession.addEventListener('click', async () => {
    if (state.sessionId) {
      try { await navigator.clipboard.writeText(state.sessionId); log('sessionId copied', 'ok'); } catch { /* ignore */ }
    }
  });
  els.btnClearLog.addEventListener('click', () => { els.log.innerHTML = ''; });

  // ── Init ───────────────────────────────────────────────────────
  els.cf4Json.value = JSON.stringify(SAMPLE, null, 2);
  loadConn();
  renderFiles();
  if (els.apiKey.value) {
    log('Loaded saved connection. Click "Check Quota" to verify your key.');
  } else {
    log('Enter your Base URL and API key, then click Save.');
  }
})();
