// SMOKE TEST: one student, checks that the service does the right thing.
// This is VERIFICATION: "did we build it right?" Every check maps to a CTQ.
//
//   k6 run k6/smoke.js
//   k6 run -e BASE_URL=http://192.168.1.20:3000 k6/smoke.js

import http from 'k6/http';
import { check, group } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1.0'], // every single check must pass
  },
};

export default function () {
  let me;
  let cert;

  group('the service is up', () => {
    const res = http.get(`${BASE}/api/health`);
    check(res, { 'health check answers 200': (r) => r.status === 200 });
  });

  group('a student gets their certificate', () => {
    const login = http.post(`${BASE}/api/login`, JSON.stringify({ studentId: 'S10000' }), JSON_HEADERS);
    check(login, { 'student can log in': (r) => r.status === 200 });
    me = login.json('student');

    const docs = http.get(`${BASE}/api/documents`);
    check(docs, { 'eligible student sees 1 document': (r) => r.status === 200 && r.json('documents').length === 1 });

    const c = http.get(`${BASE}/api/certificates/${me.id}`);
    cert = c.json('certificate');
    check(c, {
      'certificate loads': (r) => r.status === 200,
      'name on certificate matches the student record (0 data errors)': () => cert && cert.name === me.name,
    });

    const pdf = http.get(`${BASE}/api/certificates/${me.id}/pdf`);
    check(pdf, {
      'PDF downloads': (r) => r.status === 200,
      'it really is a PDF': (r) => String(r.headers['Content-Type']).includes('application/pdf') && String(r.body).startsWith('%PDF'),
      'PDF made in under 3 s': (r) => r.timings.duration < 3000,
    });
  });

  group('employers can verify it', () => {
    const v = http.get(`${BASE}/api/verify/${cert.code}`);
    check(v, { 'real code is valid': (r) => r.json('valid') === true });
    const fake = http.get(`${BASE}/api/verify/FAKE123456`);
    check(fake, { 'fake code is rejected': (r) => r.json('valid') === false });
  });

  group('security', () => {
    // a 403 is the right answer here, so tell k6 it's expected
    const other = http.get(`${BASE}/api/certificates/S10001`, { responseCallback: http.expectedStatuses(403) });
    check(other, { "can't open someone else's certificate (403)": (r) => r.status === 403 });
  });

  group('poka-yoke', () => {
    http.post(`${BASE}/api/login`, JSON.stringify({ studentId: 'S10009' }), JSON_HEADERS);
    const docs = http.get(`${BASE}/api/documents`);
    check(docs, { 'ineligible student sees no certificate button': (r) => r.json('documents').length === 0 });
  });
}
