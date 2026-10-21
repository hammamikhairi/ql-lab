'use strict';

const $ = (sel) => document.querySelector(sel);
const VIEWS = ['login', 'home', 'docs', 'cert'];
const CLICK_LIMIT = 3; // our CTQ: certificate in 3 clicks or less

let me = null;
let cert = null;
let clicks = 0;

function show(view) {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  renderClicks();
  window.scrollTo(0, 0);
}

function renderClicks() {
  for (const id of ['#clicks-home', '#clicks-docs', '#clicks-cert']) {
    const el = $(id);
    el.textContent = `clicks so far: ${clicks} (CTQ: ${CLICK_LIMIT} max)`;
    el.classList.toggle('over', clicks > CLICK_LIMIT);
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  return { status: res.status, data };
}

function renderWho() {
  const who = $('#who');
  who.textContent = '';
  if (!me) return;
  const name = document.createElement('span');
  name.textContent = `${me.name} · ${me.id}`;
  const out = document.createElement('button');
  out.className = 'link-btn';
  out.type = 'button';
  out.textContent = 'Log out';
  out.addEventListener('click', logout);
  who.append(name, out);
}

function renderHome() {
  $('#hello').textContent = `Hi ${me.name.split(' ')[0]}`;
  $('#program').textContent = `${me.program} · ${me.year}`;
  const box = $('#home-actions');
  box.textContent = '';
  if (me.eligible) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = 'My documents';
    btn.addEventListener('click', openDocuments);
    box.append(btn);
  } else {
    const p = document.createElement('p');
    p.className = 'status info';
    p.textContent = 'No documents are available for your account yet. (This demo student is not eligible: that is on purpose, for testing.)';
    box.append(p);
  }
}

async function openDocuments() {
  clicks++;
  const { status, data } = await api('/api/documents');
  if (status !== 200) return backToLogin();
  const list = $('#doc-list');
  list.textContent = '';
  for (const doc of data.documents) {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = doc.title;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = 'Get certificate';
    btn.addEventListener('click', () => openCertificate(doc.studentId));
    li.append(title, btn);
    list.append(li);
  }
  show('docs');
}

async function openCertificate(studentId) {
  clicks++;
  const { status, data } = await api(`/api/certificates/${studentId}`);
  if (status !== 200) {
    alert(data && data.error ? data.error : 'Could not load the certificate.');
    return;
  }
  cert = data.certificate;
  $('#cert-name').textContent = cert.name;
  $('#cert-program').textContent = cert.program;
  $('#cert-year').textContent = cert.year;
  $('#cert-code').textContent = cert.code;
  $('#verify-link').href = cert.verifyUrl;
  $('#pdf-status').textContent = '';
  show('cert');
}

function setStatus(kind, text) {
  const el = $('#pdf-status');
  el.className = `status ${kind}`;
  el.textContent = text;
}

async function downloadPdf() {
  const btn = $('#download-btn');
  btn.disabled = true;
  setStatus('info', 'Generating your PDF…');
  const t0 = performance.now();
  try {
    const res = await fetch(`/api/certificates/${cert.studentId}/pdf`, { credentials: 'same-origin' });
    const secs = ((performance.now() - t0) / 1000).toFixed(2);
    if (res.status === 200) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certificate-${cert.studentId}.pdf`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      const ok = Number(secs) < 3;
      setStatus(ok ? 'ok' : 'warn', `Your PDF took ${secs} s. CTQ: under 3 s. ${ok ? 'Passed.' : 'Too slow.'}`);
    } else {
      let data = null;
      try { data = await res.json(); } catch { /* ignore */ }
      if (res.status === 202) setStatus('info', `${data.message} (answered in ${secs} s)`);
      else setStatus('warn', `${(data && data.error) || 'Something went wrong.'} (HTTP ${res.status}, after ${secs} s)`);
    }
  } catch {
    setStatus('warn', 'Network error: is the server still running?');
  } finally {
    btn.disabled = false;
  }
}

async function login(event) {
  event.preventDefault();
  $('#login-error').textContent = '';
  $('#login-btn').disabled = true;
  const studentId = $('#student-id').value.trim().toUpperCase();
  const { status, data } = await api('/api/login', { method: 'POST', body: JSON.stringify({ studentId }) });
  $('#login-btn').disabled = false;
  if (status !== 200) {
    $('#login-error').textContent = (data && data.error) || 'Login failed.';
    return;
  }
  me = data.student;
  clicks = 1;
  renderWho();
  renderHome();
  show('home');
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  backToLogin();
}

function backToLogin() {
  me = null;
  clicks = 0;
  renderWho();
  show('login');
}

async function init() {
  $('#login-form').addEventListener('submit', login);
  $('#download-btn').addEventListener('click', downloadPdf);
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => show(b.dataset.back)));

  const list = await api('/api/students');
  if (list.status === 200) {
    for (const s of list.data.sample) {
      const o = document.createElement('option');
      o.value = s.id;
      o.label = `${s.name}${s.eligible ? '' : ' (not eligible)'}`;
      $('#student-list').append(o);
    }
  }
  const who = await api('/api/me');
  if (who.status === 200) {
    me = who.data.student;
    clicks = 1;
    renderWho();
    renderHome();
    show('home');
  } else {
    show('login');
  }
}

init();
