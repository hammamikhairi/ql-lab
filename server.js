'use strict';

/*
 * Certificate Lab: a mock university certificate service for load-testing workshops.
 * Zero dependencies. Node 18+.
 *
 *   node server.js                 -> http://localhost:3000
 *   HOST=0.0.0.0 node server.js    -> reachable from other machines on your network
 *   ADMIN_KEY=secret node server.js -> only people with the key can change the dashboard knobs
 */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// Fake student records (2000 students, every 10th one is not eligible)
// ---------------------------------------------------------------------------
const FIRST = ['Khairi', 'Youssef', 'Nour', 'Sami', 'Ines', 'Karim', 'Lina', 'Omar', 'Yasmine', 'Hedi',
  'Salma', 'Aziz', 'Mariem', 'Walid', 'Rania', 'Fares', 'Emna', 'Bilel', 'Sarra', 'Mehdi'];
const LAST = ['Haddad', 'Mansour', 'Gharbi', 'Khelifi', 'Jaziri', 'Saidi', 'Chaabane', 'Mejri',
  'Hammami', 'Ayari', 'Ferchichi', 'Baccouche'];
const PROGRAMS = ['Bachelor in Computer Science', 'Master in Software Engineering',
  'Bachelor in Business Computing', 'Master in Data Science', 'Bachelor in Networks and Telecom'];
const STUDENT_COUNT = 2000;

const students = new Map();
const idByCode = new Map();

function verificationCode(id) {
  return crypto.createHash('sha256').update(`certificate-lab:${id}`).digest('hex').slice(0, 10).toUpperCase();
}

for (let i = 0; i < STUDENT_COUNT; i++) {
  const id = `S${10000 + i}`;
  const s = {
    id,
    name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`,
    program: PROGRAMS[i % PROGRAMS.length],
    year: '2026/2027',
    eligible: i % 10 !== 9,
  };
  s.code = verificationCode(id);
  students.set(id, s);
  idByCode.set(s.code, id);
}

// "Old records" typo, used by the wrongName bug: swaps two letters of the first name.
function typo(name) {
  const [first, ...rest] = name.split(' ');
  if (first.length < 4) return name;
  const t = first[0] + first[2] + first[1] + first.slice(3);
  return [t, ...rest].join(' ');
}

// ---------------------------------------------------------------------------
// Settings: the knobs on the dashboard
// ---------------------------------------------------------------------------
const PRESETS = {
  'quiet-tuesday': {
    label: 'quiet tuesday',
    description: 'a normal day: plenty of capacity, nothing breaks',
    pdfDelayMs: 150, workers: 60, giveUpMs: 5000, failurePct: 0, mode: 'normal',
  },
  'registration-week': {
    label: 'registration week',
    description: 'everyone at once on a small server: requests pile up, some time out',
    pdfDelayMs: 300, workers: 20, giveUpMs: 4000, failurePct: 0.5, mode: 'normal',
  },
  'design-moves': {
    label: 'registration week + design moves',
    description: 'same rush, but more PDF workers and "queue it and email it" instead of an error',
    pdfDelayMs: 300, workers: 50, giveUpMs: 4000, failurePct: 0, mode: 'queue',
  },
};
const QUEUE_AFTER_MS = 1500; // in queue mode, don't keep a student waiting longer than this
const LIMITS = {
  pdfDelayMs: [20, 3000], workers: [1, 500], giveUpMs: [200, 30000], failurePct: [0, 50],
};

const settings = {
  preset: 'quiet-tuesday',
  ...strip(PRESETS['quiet-tuesday']),
  bugs: { accessControl: false, wrongName: false },
};

function strip(p) {
  const { label, description, ...rest } = p;
  return rest;
}

function applySettings(patch) {
  for (const key of Object.keys(LIMITS)) {
    if (patch[key] !== undefined) {
      const v = Number(patch[key]);
      if (!Number.isFinite(v)) continue;
      const [lo, hi] = LIMITS[key];
      settings[key] = Math.min(hi, Math.max(lo, v));
    }
  }
  if (patch.mode === 'normal' || patch.mode === 'queue') settings.mode = patch.mode;
  if (patch.bugs && typeof patch.bugs === 'object') {
    if (typeof patch.bugs.accessControl === 'boolean') settings.bugs.accessControl = patch.bugs.accessControl;
    if (typeof patch.bugs.wrongName === 'boolean') settings.bugs.wrongName = patch.bugs.wrongName;
  }
  if (patch.preset === undefined && Object.keys(patch).some((k) => k in LIMITS || k === 'mode')) {
    settings.preset = 'custom';
  }
  pump();
}

// ---------------------------------------------------------------------------
// The "PDF generator": a pool of workers with a waiting line
// ---------------------------------------------------------------------------
let active = 0;
const waiters = [];

function acquire(maxWaitMs) {
  if (active < settings.workers) {
    active++;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const w = { resolve };
    w.timer = setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      resolve(false);
    }, maxWaitMs);
    waiters.push(w);
  });
}

function release() {
  if (waiters.length && active <= settings.workers) {
    const w = waiters.shift();
    clearTimeout(w.timer);
    w.resolve(true); // hand the slot straight to the next student in line
  } else {
    active--;
  }
}

function pump() {
  while (active < settings.workers && waiters.length) {
    active++;
    const w = waiters.shift();
    clearTimeout(w.timer);
    w.resolve(true);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function generationTime() {
  let t = settings.pdfDelayMs * (0.75 + Math.random() * 0.5);
  if (Math.random() < 0.03) t *= 3; // the occasional slow one
  return t;
}

// A tiny but valid one-page PDF, written by hand so we need no libraries.
function makePdf(student, displayName) {
  const esc = (s) => String(s).replace(/[^\x20-\x7E]/g, '?').replace(/([\\()])/g, '\\$1');
  const content = [
    '0.11 0.12 0.23 RG 3 w 40 40 515 762 re S',
    '1 0.42 0.24 rg 40 760 515 42 re f',
    'BT /F1 12 Tf 0.11 0.12 0.23 rg 60 775 Td (CERTIFICATE LAB  -  DEMO UNIVERSITY) Tj ET',
    'BT /F1 28 Tf 0.11 0.12 0.23 rg 120 640 Td (Certificate of enrollment) Tj ET',
    'BT /F2 14 Tf 0.29 0.31 0.42 rg 225 590 Td (This certifies that) Tj ET',
    `BT /F1 22 Tf 0.11 0.12 0.23 rg 60 545 Td (${esc(displayName)}) Tj ET`,
    `BT /F2 14 Tf 0.29 0.31 0.42 rg 60 505 Td (is enrolled in ${esc(student.program)}) Tj ET`,
    `BT /F2 14 Tf 0.29 0.31 0.42 rg 60 482 Td (for the ${esc(student.year)} academic year.) Tj ET`,
    `BT /F2 12 Tf 0.29 0.31 0.42 rg 60 420 Td (Student ID: ${esc(student.id)}) Tj ET`,
    `BT /F1 12 Tf 0.76 0.25 0.05 rg 60 400 Td (Verification code: ${esc(student.code)}) Tj ET`,
    'BT /F2 10 Tf 0.42 0.39 0.35 rg 60 80 Td (Mock document generated for a software engineering workshop. Not a real certificate.) Tj ET',
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------------------------------------------------------------------------
// Metrics for the live dashboard
// ---------------------------------------------------------------------------
const buckets = new Map(); // unix second -> { n, errors, queued, pdf: [latencies] }
const totals = { requests: 0, pdfs: 0, queued: 0, errors: 0 };
let inFlight = 0;
const MAX_SAMPLES = 4000;

function bucket(sec) {
  let b = buckets.get(sec);
  if (!b) {
    b = { n: 0, errors: 0, queued: 0, pdf: [], pdfSeen: 0 };
    buckets.set(sec, b);
    for (const k of buckets.keys()) if (k < sec - 120) buckets.delete(k);
  }
  return b;
}

function record(kind, ms, status) {
  const b = bucket(Math.floor(Date.now() / 1000));
  b.n++;
  totals.requests++;
  if (status >= 500) { b.errors++; totals.errors++; }
  if (status === 202) { b.queued++; totals.queued++; }
  if (kind === 'pdf' && status === 200) {
    totals.pdfs++;
    b.pdfSeen++;
    if (b.pdf.length < MAX_SAMPLES) b.pdf.push(ms);
    else {
      const j = Math.floor(Math.random() * b.pdfSeen);
      if (j < MAX_SAMPLES) b.pdf[j] = ms;
    }
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)]);
}

function snapshot() {
  const now = Math.floor(Date.now() / 1000);
  let n10 = 0, e10 = 0, q10 = 0, n5 = 0;
  const lat10 = [];
  const timeline = [];
  for (let s = now - 59; s <= now; s++) {
    const b = buckets.get(s);
    const sortedSec = b ? [...b.pdf].sort((x, y) => x - y) : [];
    timeline.push({
      t: s,
      rps: b ? b.n : 0,
      errors: b ? b.errors : 0,
      queued: b ? b.queued : 0,
      p95: percentile(sortedSec, 95),
    });
    if (b && s > now - 10) {
      n10 += b.n; e10 += b.errors; q10 += b.queued;
      lat10.push(...b.pdf);
    }
    if (b && s >= now - 5 && s < now) n5 += b.n;
  }
  lat10.sort((x, y) => x - y);
  return {
    time: Date.now(),
    rps: Math.round(n5 / 5),
    last10s: {
      requests: n10,
      errors: e10,
      queued: q10,
      errorRate: n10 ? e10 / n10 : 0,
      p50: percentile(lat10, 50),
      p95: percentile(lat10, 95),
      p99: percentile(lat10, 99),
    },
    inFlight,
    generating: Math.min(active, settings.workers),
    waiting: waiters.length,
    totals,
    timeline,
    settings,
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
const sessions = new Map(); // token -> student id

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function currentStudent(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  const id = m && sessions.get(m[1]);
  return id ? students.get(id) : null;
}

function isAdmin(req) {
  return !ADMIN_KEY || req.headers['x-admin-key'] === ADMIN_KEY;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const PAGES = { '/': 'index.html', '/dashboard': 'dashboard.html', '/verify': 'verify.html' };

function serveStatic(req, res, pathname) {
  const rel = PAGES[pathname] || pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'not found' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function handle(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (method === 'GET' && p === '/api/health') return send(res, 200, { ok: true });

  if (method === 'GET' && p === '/api/students') {
    const sample = [];
    for (let i = 0; i < 10; i++) {
      const s = students.get(`S${10000 + i}`);
      sample.push({ id: s.id, name: s.name, eligible: s.eligible });
    }
    return send(res, 200, { count: STUDENT_COUNT, first: 'S10000', last: `S${10000 + STUDENT_COUNT - 1}`, sample });
  }

  if (method === 'POST' && p === '/api/login') {
    const body = await readJson(req);
    const id = body && String(body.studentId || '').trim().toUpperCase();
    const s = id && students.get(id);
    if (!s) return send(res, 404, { error: 'No student with that ID. Try S10000 to S11999.' });
    const token = crypto.randomBytes(16).toString('hex');
    if (sessions.size > 200000) sessions.clear();
    sessions.set(token, s.id);
    return send(res, 200, { student: publicStudent(s) }, {
      'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/`,
    });
  }

  if (method === 'POST' && p === '/api/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  if (method === 'GET' && p === '/api/me') {
    const me = currentStudent(req);
    if (!me) return send(res, 401, { error: 'Not logged in.' });
    return send(res, 200, { student: publicStudent(me) });
  }

  if (method === 'GET' && p === '/api/documents') {
    const me = currentStudent(req);
    if (!me) return send(res, 401, { error: 'Not logged in.' });
    if (!me.eligible) return send(res, 200, { eligible: false, documents: [] });
    return send(res, 200, {
      eligible: true,
      documents: [{ id: 'enrollment', title: `Certificate of enrollment, ${me.year}`, studentId: me.id }],
    });
  }

  let m = p.match(/^\/api\/certificates\/(S\d{5})(\/pdf)?$/);
  if (method === 'GET' && m) {
    const me = currentStudent(req);
    if (!me) return send(res, 401, { error: 'Not logged in.' });
    const target = students.get(m[1]);
    if (!target) return send(res, 404, { error: 'No such student.' });
    // Access control: you only get your own certificate (unless the bug is switched on).
    if (target.id !== me.id && !settings.bugs.accessControl) {
      return send(res, 403, { error: 'You can only download your own certificate.' });
    }
    if (!target.eligible) return send(res, 403, { error: 'No certificate available for this account.' });
    const displayName = settings.bugs.wrongName ? typo(target.name) : target.name;

    if (!m[2]) {
      return send(res, 200, {
        certificate: {
          studentId: target.id, name: displayName, program: target.program, year: target.year,
          code: target.code, verifyUrl: `/verify?code=${target.code}`,
        },
      });
    }

    // The PDF: this is the slow, limited part.
    res.locals = { kind: 'pdf' };
    const waitLimit = settings.mode === 'queue' ? Math.min(settings.giveUpMs, QUEUE_AFTER_MS) : settings.giveUpMs;
    const got = await acquire(waitLimit);
    if (!got) {
      if (settings.mode === 'queue') {
        return send(res, 202, {
          status: 'queued',
          message: 'Busy right now, so your certificate is in the queue. We will email it to you in a few minutes.',
        });
      }
      return send(res, 503, { error: 'Server busy, please try again later.' }, { 'Retry-After': '30' });
    }
    try {
      await sleep(generationTime());
      if (Math.random() * 100 < settings.failurePct) {
        return send(res, 500, { error: 'The PDF generator crashed. Please try again.' });
      }
      const pdf = makePdf(target, displayName);
      return send(res, 200, pdf, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="certificate-${target.id}.pdf"`,
      });
    } finally {
      release();
    }
  }

  m = p.match(/^\/api\/verify\/([A-Z0-9]{1,20})$/i);
  if (method === 'GET' && m) {
    const id = idByCode.get(m[1].toUpperCase());
    const s = id && students.get(id);
    if (!s || !s.eligible) return send(res, 200, { valid: false });
    return send(res, 200, { valid: true, name: s.name, program: s.program, year: s.year });
  }

  // ---- dashboard + admin ----
  if (method === 'GET' && p === '/api/stats') return send(res, 200, snapshot());

  if (method === 'GET' && p === '/api/settings') {
    return send(res, 200, { settings, presets: PRESETS, limits: LIMITS, adminProtected: Boolean(ADMIN_KEY) });
  }

  if (method === 'POST' && p === '/api/settings') {
    if (!isAdmin(req)) return send(res, 403, { error: 'Admin key required.' });
    const body = await readJson(req);
    if (!body) return send(res, 400, { error: 'Bad JSON.' });
    applySettings(body);
    return send(res, 200, { settings });
  }

  m = p.match(/^\/api\/settings\/preset\/([a-z-]+)$/);
  if (method === 'POST' && m) {
    if (!isAdmin(req)) return send(res, 403, { error: 'Admin key required.' });
    const preset = PRESETS[m[1]];
    if (!preset) return send(res, 404, { error: 'Unknown preset.' });
    applySettings({ ...strip(preset), preset: m[1] });
    settings.preset = m[1];
    return send(res, 200, { settings });
  }

  if (method === 'POST' && p === '/api/stats/reset') {
    if (!isAdmin(req)) return send(res, 403, { error: 'Admin key required.' });
    buckets.clear();
    Object.assign(totals, { requests: 0, pdfs: 0, queued: 0, errors: 0 });
    return send(res, 200, { ok: true });
  }

  if (p.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint.' });
  if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, p);
  return send(res, 405, { error: 'Method not allowed.' });
}

function publicStudent(s) {
  return { id: s.id, name: s.name, program: s.program, year: s.year, eligible: s.eligible };
}

const UNTRACKED = new Set(['/api/stats', '/api/settings', '/api/health']);

const server = http.createServer((req, res) => {
  const start = process.hrtime.bigint();
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(res, 400, { error: 'Bad URL.' });
  }
  const tracked = url.pathname.startsWith('/api/') && !UNTRACKED.has(url.pathname) &&
    !url.pathname.startsWith('/api/settings') && !url.pathname.startsWith('/api/stats');
  if (tracked) {
    inFlight++;
    res.on('close', () => {
      inFlight--;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      record(res.locals && res.locals.kind, ms, res.statusCode);
    });
  }
  handle(req, res, url).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'Internal error.' });
  });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.maxConnections = 10000;

server.listen(PORT, HOST, () => {
  const local = `http://localhost:${PORT}`;
  console.log('\n  Certificate Lab is running');
  console.log(`  student portal   ${local}/`);
  console.log(`  ops dashboard    ${local}/dashboard`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  on your network  http://${a.address}:${PORT}/`);
      }
    }
  }
  if (ADMIN_KEY) console.log('  dashboard knobs are protected by ADMIN_KEY');
  console.log('\n  try: k6 run k6/smoke.js   then   k6 run k6/load.js\n');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    if (server.closeAllConnections) server.closeAllConnections();
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
