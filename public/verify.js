'use strict';

const form = document.getElementById('verify-form');
const input = document.getElementById('code');
const result = document.getElementById('result');

async function check(code) {
  result.className = 'status info';
  result.textContent = 'Checking…';
  const res = await fetch(`/api/verify/${encodeURIComponent(code.trim().toUpperCase())}`);
  const data = res.ok ? await res.json() : { valid: false };
  if (data.valid) {
    result.className = 'status ok';
    result.textContent = `Valid. ${data.name} is enrolled in ${data.program} for ${data.year}.`;
  } else {
    result.className = 'status warn';
    result.textContent = 'Not valid. This code does not match any certificate we issued.';
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  check(input.value);
});

const fromUrl = new URLSearchParams(location.search).get('code');
if (fromUrl) {
  input.value = fromUrl;
  check(fromUrl);
}
