'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveGesture, toStrokes, THRESHOLD_PX } = require('../src/main/gesture');

/** Build a path from a start point and a list of [dx, dy] legs. */
function path(start, legs, step = 15) {
  const points = [{ ...start }];
  let current = { ...start };
  for (const [dx, dy] of legs) {
    const steps = Math.max(1, Math.round(Math.hypot(dx, dy) / step));
    for (let i = 1; i <= steps; i += 1) {
      points.push({ x: current.x + (dx * i) / steps, y: current.y + (dy * i) / steps });
    }
    current = { x: current.x + dx, y: current.y + dy };
  }
  return points;
}

test('왼쪽 드래그는 뒤로, 오른쪽 드래그는 앞으로', () => {
  assert.equal(resolveGesture({ dx: -120, dy: 0 }), 'back');
  assert.equal(resolveGesture({ dx: 120, dy: 0 }), 'forward');
  // Slight vertical wobble is normal for a hand-drawn horizontal drag.
  assert.equal(resolveGesture({ dx: -100, dy: 30 }), 'back');
  assert.equal(resolveGesture({ dx: 100, dy: -30 }), 'forward');
});

test('짧은 드래그는 제스처가 아니다', () => {
  // Otherwise an ordinary right-click that twitches would navigate away.
  assert.equal(resolveGesture({ dx: 0, dy: 0 }), null);
  assert.equal(resolveGesture({ dx: THRESHOLD_PX - 1, dy: 0 }), null);
  assert.equal(resolveGesture({ dx: -(THRESHOLD_PX - 1), dy: 0 }), null);
  assert.equal(resolveGesture({ dx: THRESHOLD_PX, dy: 0 }), 'forward', '경계값은 포함');
});

test('세로로 더 많이 움직였으면 제스처가 아니다', () => {
  assert.equal(resolveGesture({ dx: 100, dy: 200 }), null);
  assert.equal(resolveGesture({ dx: -100, dy: -100 }), null, '45도는 모호하므로 무시');
});

test('망가진 입력은 조용히 무시한다', () => {
  // The payload crosses IPC from the renderer, so it cannot be trusted.
  assert.equal(resolveGesture(undefined), null);
  assert.equal(resolveGesture({}), null);
  assert.equal(resolveGesture({ dx: 'a lot', dy: 0 }), null);
  assert.equal(resolveGesture({ dx: Number.NaN, dy: 0 }), null);
  assert.equal(resolveGesture({ dx: Infinity, dy: 0 }), null);
});

test('임계값을 조정할 수 있다', () => {
  assert.equal(resolveGesture({ dx: 30, dy: 0 }, { threshold: 20 }), 'forward');
  assert.equal(resolveGesture({ dx: 30, dy: 0 }, { threshold: 200 }), null);
});

test('경로를 획 순서로 줄인다', () => {
  const start = { x: 300, y: 200 };
  assert.equal(toStrokes(path(start, [[-200, 0]])), 'L');
  assert.equal(toStrokes(path(start, [[0, 200], [200, 0]])), 'DR', 'ㄴ 모양');
  assert.equal(toStrokes(path(start, [[0, -200], [200, 0]])), 'UR');

  // A hand-drawn straight line wobbles; that must not become a staircase.
  const wobbly = [];
  for (let i = 0; i <= 20; i += 1) {
    wobbly.push({ x: 300 - i * 12, y: 200 + (i % 2 === 0 ? 4 : -4) });
  }
  assert.equal(toStrokes(wobbly), 'L');
});

test('ㄴ 모양(아래→오른쪽)은 창 닫기', () => {
  const drag = {
    dx: 200,
    dy: 200,
    path: path({ x: 300, y: 200 }, [[0, 200], [200, 0]]),
  };
  assert.equal(resolveGesture(drag), 'close');
});

test('반대 모양은 닫기로 오인하지 않는다', () => {
  const start = { x: 300, y: 300 };
  // Up-then-right, right-then-down and down-then-left are all unassigned.
  assert.equal(resolveGesture({ dx: 200, dy: -200, path: path(start, [[0, -200], [200, 0]]) }), null);
  assert.equal(resolveGesture({ dx: 200, dy: 200, path: path(start, [[200, 0], [0, 200]]) }), null);
  assert.equal(resolveGesture({ dx: -200, dy: 200, path: path(start, [[0, 200], [-200, 0]]) }), null);
});

test('직선 드래그는 경로가 있어도 여전히 앞뒤 이동', () => {
  const start = { x: 400, y: 300 };
  assert.equal(resolveGesture({ dx: -200, dy: 0, path: path(start, [[-200, 0]]) }), 'back');
  assert.equal(resolveGesture({ dx: 200, dy: 0, path: path(start, [[200, 0]]) }), 'forward');
});

test('망가진 경로는 무시하고 직선 판정으로 되돌아간다', () => {
  const drag = { dx: -200, dy: 0, path: ['nonsense', { x: 1 }, null] };
  assert.equal(resolveGesture(drag), 'back');
  assert.equal(resolveGesture({ dx: -200, dy: 0, path: 'not an array' }), 'back');
});
