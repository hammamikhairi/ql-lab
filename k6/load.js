// LOAD TEST: 500 students download their certificate at the same time, like registration week.
// The two thresholds below ARE our CTQs. If either one fails, k6 exits with an error.
//
//   k6 run k6/load.js
//   K6_WEB_DASHBOARD=true k6 run k6/load.js        (live graphs at http://localhost:5665)
//   k6 run -e STUDENTS=200 k6/load.js              (fewer students, for small laptops)

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const STUDENTS = Number(__ENV.STUDENTS || 500);

const emailedInstead = new Counter('emailed_instead_of_error');

export const options = {
  stages: [
    { duration: '10s', target: STUDENTS }, // students arrive
    { duration: '20s', target: STUDENTS }, // everyone keeps clicking
    { duration: '5s', target: 0 },         // calm down
  ],
  thresholds: {
    'http_req_duration{name:pdf}': ['p(95)<3000'], // CTQ: 95% of PDFs in under 3 s
    http_req_failed: ['rate<0.01'],                 // CTQ: under 1% of requests fail
  },
};

// every 10th demo student is not eligible, so we skip those (k -> k + floor(k/9))
function studentFor(vu) {
  const k = (vu - 1) % 1800;
  return `S${10000 + k + Math.floor(k / 9)}`;
}

let myId = null;
let session = null; // k6 empties the cookie jar after every loop, so we keep the session ourselves

export default function () {
  if (myId === null) {
    myId = studentFor(__VU);
    const login = http.post(`${BASE}/api/login`, JSON.stringify({ studentId: myId }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'login' },
    });
    check(login, { 'logged in': (r) => r.status === 200 });
    session = login.cookies.sid && login.cookies.sid[0].value;
  }

  const res = http.get(`${BASE}/api/certificates/${myId}/pdf`, { tags: { name: 'pdf' }, cookies: { sid: session } });
  if (res.status === 202) emailedInstead.add(1);
  check(res, {
    'got the PDF (or a "we will email it")': (r) => r.status === 200 || r.status === 202,
  });

  sleep(1); // a real student doesn't click 100 times a second
}
