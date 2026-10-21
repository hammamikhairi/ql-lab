// SPIKE TEST: registration opens at 9:00 sharp and 1000 students show up in 5 seconds.
// Same CTQs as the load test. Expect this one to hurt unless the design can take it.
//
//   k6 run k6/spike.js
//   k6 run -e STUDENTS=600 k6/spike.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const STUDENTS = Number(__ENV.STUDENTS || 1000);

const emailedInstead = new Counter('emailed_instead_of_error');

export const options = {
  stages: [
    { duration: '5s', target: STUDENTS },
    { duration: '25s', target: STUDENTS },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{name:pdf}': ['p(95)<3000'],
    http_req_failed: ['rate<0.01'],
  },
};

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
    session = login.cookies.sid && login.cookies.sid[0].value;
  }
  const res = http.get(`${BASE}/api/certificates/${myId}/pdf`, { tags: { name: 'pdf' }, cookies: { sid: session } });
  if (res.status === 202) emailedInstead.add(1);
  check(res, { 'got the PDF (or a "we will email it")': (r) => r.status === 200 || r.status === 202 });
  sleep(1);
}
