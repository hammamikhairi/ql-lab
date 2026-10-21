'use strict';

const $ = (sel) => document.querySelector(sel);
const SVG = 'http://www.w3.org/2000/svg';
const KNOBS = ['workers', 'pdfDelayMs', 'giveUpMs', 'failurePct'];
const CTQ_P95_MS = 3000;
const CTQ_ERROR_RATE = 0.01;

let presets = {};
let adminProtected = false;
let editingUntil = 0; // don't overwrite a knob while someone is dragging it

function adminKey() {
  try { return localStorage.getItem('certificate-lab-admin-key') || ''; } catch { return ''; }
}

function toast(msg) {
  $('#toast').textContent = msg;
  if (msg) setTimeout(() => { if ($('#toast').textContent === msg) $('#toast').textContent = ''; }, 4000);
}

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey() },
    body: JSON.stringify(body || {}),
  });
  if (res.status === 403) {
    toast('This server needs the admin key to change settings.');
    $('#admin-box').hidden = false;
    return null;
  }
  return res.ok ? res.json() : null;
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '–';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

function knobLabel(key, v) {
  if (key === 'workers') return `${v}`;
  if (key === 'failurePct') return `${Number(v).toFixed(1)}%`;
  return fmtMs(Number(v));
}

function renderSettings(s) {
  for (const k of KNOBS) {
    if (Date.now() > editingUntil) $(`#k-${k}`).value = s[k];
    $(`#v-${k}`).textContent = knobLabel(k, s[k]);
  }
  $('#mode-normal').classList.toggle('on', s.mode === 'normal');
  $('#mode-queue').classList.toggle('on', s.mode === 'queue');
  $('#bug-access').checked = s.bugs.accessControl;
  $('#bug-name').checked = s.bugs.wrongName;
  document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('active', b.dataset.preset === s.preset));
}

function buildPresets() {
  const box = $('#presets');
  box.textContent = '';
  for (const [key, p] of Object.entries(presets)) {
    const b = document.createElement('button');
    b.className = 'preset';
    b.type = 'button';
    b.dataset.preset = key;
    const strong = document.createElement('strong');
    strong.textContent = p.label;
    const span = document.createElement('span');
    span.textContent = p.description;
    b.append(strong, span);
    b.addEventListener('click', async () => {
      const r = await post(`/api/settings/preset/${key}`);
      if (r) { renderSettings(r.settings); toast(`Switched to “${p.label}”.`); }
    });
    box.append(b);
  }
}

let pending = null;
function sendKnobs(patch) {
  editingUntil = Date.now() + 1500;
  clearTimeout(pending);
  pending = setTimeout(async () => {
    const r = await post('/api/settings', patch);
    if (r) renderSettings(r.settings);
  }, 150);
}

function drawChart(svg, values, { max, threshold, color }) {
  svg.textContent = '';
  const W = 600, H = 170, pad = 6;
  const n = values.length;
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - pad - (v / max) * (H - pad * 2);

  for (let g = 1; g <= 3; g++) {
    const line = document.createElementNS(SVG, 'line');
    const gy = (H / 4) * g;
    line.setAttribute('x1', 0); line.setAttribute('x2', W);
    line.setAttribute('y1', gy); line.setAttribute('y2', gy);
    line.setAttribute('stroke', '#31376a'); line.setAttribute('stroke-width', 1);
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(line);
  }
  if (threshold !== undefined && threshold <= max) {
    const t = document.createElementNS(SVG, 'line');
    t.setAttribute('x1', 0); t.setAttribute('x2', W);
    t.setAttribute('y1', y(threshold)); t.setAttribute('y2', y(threshold));
    t.setAttribute('stroke', '#ff8a63'); t.setAttribute('stroke-width', 2);
    t.setAttribute('stroke-dasharray', '8 6');
    t.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(t);
  }
  // area + line, with gaps where there was no data
  let d = '';
  let started = false;
  values.forEach((v, i) => {
    if (v === null || v === undefined) { started = false; return; }
    d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(Math.min(v, max)).toFixed(1)} `;
    started = true;
  });
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d.trim());
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', 3);
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(path);
}

function setCtq(id, state, verdict, detail) {
  const el = $(`#${id}`);
  el.classList.remove('pass', 'fail', 'idle');
  el.classList.add(state);
  $(`#${id}-verdict`).textContent = verdict;
  $(`#${id}-detail`).textContent = detail;
}

function renderStats(s) {
  const l = s.last10s;
  $('#t-rps').textContent = s.rps;
  $('#t-p95').textContent = fmtMs(l.p95);
  $('#t-err').textContent = l.requests ? `${(l.errorRate * 100).toFixed(1)}%` : '0';
  $('#t-queued').textContent = l.queued;
  $('#t-gen').textContent = s.generating;
  $('#t-wait').textContent = s.waiting;

  if (l.p95 === null) setCtq('ctq-speed', 'idle', 'waiting for traffic', 'no PDFs in the last 10 seconds');
  else if (l.p95 < CTQ_P95_MS) setCtq('ctq-speed', 'pass', 'passing', `95% of PDFs came back in under ${fmtMs(l.p95)}`);
  else setCtq('ctq-speed', 'fail', 'failing', `95% of PDFs took up to ${fmtMs(l.p95)}`);

  if (!l.requests) setCtq('ctq-errors', 'idle', 'waiting for traffic', 'no requests in the last 10 seconds');
  else if (l.errorRate < CTQ_ERROR_RATE) setCtq('ctq-errors', 'pass', 'passing', `${l.errors} of ${l.requests} requests failed`);
  else setCtq('ctq-errors', 'fail', 'failing', `${l.errors} of ${l.requests} requests failed (${(l.errorRate * 100).toFixed(1)}%)`);

  const rps = s.timeline.map((p) => p.rps);
  const rpsMax = Math.max(10, ...rps) * 1.15;
  $('#c-rps-max').textContent = `peak ${Math.max(0, ...rps)}/s`;
  drawChart($('#chart-rps'), rps, { max: rpsMax, color: '#6ea8ff' });

  const p95 = s.timeline.map((p) => (p.p95 === null ? null : p.p95 / 1000));
  const p95Max = Math.max(4, ...p95.filter((v) => v !== null)) * 1.1;
  $('#c-p95-max').textContent = `top of chart ${p95Max.toFixed(1)} s`;
  drawChart($('#chart-p95'), p95, { max: p95Max, threshold: 3, color: '#ff8a63' });

  renderSettings(s.settings);
}

async function poll() {
  try {
    const res = await fetch('/api/stats', { cache: 'no-store' });
    renderStats(await res.json());
    $('#live-dot').classList.remove('off');
    $('#live-text').textContent = 'live';
  } catch {
    $('#live-dot').classList.add('off');
    $('#live-text').textContent = 'server unreachable';
  }
  setTimeout(poll, 1000);
}

async function init() {
  const res = await fetch('/api/settings');
  const data = await res.json();
  presets = data.presets;
  adminProtected = data.adminProtected;
  $('#admin-box').hidden = !adminProtected;
  try { $('#admin-key').value = adminKey(); } catch { /* ignore */ }
  buildPresets();
  renderSettings(data.settings);

  for (const k of KNOBS) {
    $(`#k-${k}`).addEventListener('input', (e) => {
      $(`#v-${k}`).textContent = knobLabel(k, e.target.value);
      sendKnobs({ [k]: Number(e.target.value) });
    });
  }
  $('#mode-normal').addEventListener('click', () => sendKnobs({ mode: 'normal' }));
  $('#mode-queue').addEventListener('click', () => sendKnobs({ mode: 'queue' }));
  $('#bug-access').addEventListener('change', (e) => sendKnobs({ bugs: { accessControl: e.target.checked } }));
  $('#bug-name').addEventListener('change', (e) => sendKnobs({ bugs: { wrongName: e.target.checked } }));
  $('#reset').addEventListener('click', async () => {
    if (await post('/api/stats/reset')) toast('Charts reset.');
  });
  $('#admin-key').addEventListener('change', (e) => {
    try { localStorage.setItem('certificate-lab-admin-key', e.target.value); } catch { /* ignore */ }
    toast('Admin key saved in this browser.');
  });
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const cmd = b.previousElementSibling.textContent;
    try { await navigator.clipboard.writeText(cmd); toast('Copied.'); } catch { toast(cmd); }
  }));
  poll();
}

init();
