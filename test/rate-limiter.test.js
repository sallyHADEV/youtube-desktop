'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../src/main/navigation-guard');

test('루프가 다이얼로그·외부 창을 무한히 띄우지 못하게 막는다', () => {
  const allow = createRateLimiter({ max: 3, windowMs: 10000 });

  // A redirect loop retries with a fresh token every time, so per-URL de-duping
  // never fires — the ceiling is what actually stops it.
  assert.equal(allow(), true);
  assert.equal(allow(), true);
  assert.equal(allow(), true);
  assert.equal(allow(), false);
  assert.equal(allow(), false);
});

test('시간이 지나면 다시 허용한다', async () => {
  const allow = createRateLimiter({ max: 1, windowMs: 30 });

  assert.equal(allow(), true);
  assert.equal(allow(), false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(allow(), true);
});
