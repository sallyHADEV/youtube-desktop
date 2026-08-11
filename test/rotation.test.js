'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { nextAngle, fitScale, transformFor } = require('../src/main/rotation');

test('R을 누를 때마다 90도씩 돌고 한 바퀴에 돌아온다', () => {
  assert.equal(nextAngle(0), 90);
  assert.equal(nextAngle(90), 180);
  assert.equal(nextAngle(180), 270);
  assert.equal(nextAngle(270), 0);
});

test('망가진 각도는 처음부터 다시 시작한다', () => {
  assert.equal(nextAngle(undefined), 90);
  assert.equal(nextAngle(Number.NaN), 90);
  assert.equal(nextAngle(-90), 0, '음수도 0~359 범위로 정규화');
});

test('0도와 180도는 크기를 건드리지 않는다', () => {
  const box = { width: 1280, height: 720 };
    const container = { width: 1280, height: 720 };
  assert.equal(fitScale(0, box, container), 1);
  assert.equal(fitScale(180, box, container), 1);
});

test('90도로 돌린 가로 영상은 플레이어 안에 들어오도록 줄어든다', () => {
  // A 1280×720 video turned on its side occupies 720×1280, which is 560px
  // taller than the player — without scaling it would spill out of the window.
  const box = { width: 1280, height: 720 };
  const container = { width: 1280, height: 720 };
  const scale = fitScale(90, box, container);

  assert.equal(scale, 720 / 1280);
  // The rotated box, scaled, must fit both ways round.
  assert.ok(box.height * scale <= container.width + 0.001);
  assert.ok(box.width * scale <= container.height + 0.001);
});

test('세로 모니터 전체화면에서는 확대해서 화면을 채운다', () => {
  // 1080×1920 portrait display, 16:9 video laid out 1080×607. Rotated it takes
  // 607×1080 — capping the scale at 1 would leave most of the screen empty,
  // which is the bug this feature was reported for.
  const box = { width: 1080, height: 607 };
  const container = { width: 1080, height: 1920 };
  const scale = fitScale(90, box, container);

  assert.ok(scale > 1, `확대되어야 함 (실제 ${scale})`);
  assert.equal(scale, Math.min(1080 / 607, 1920 / 1080));

  // Never overflows, and fills whichever axis runs out first — here the height.
  const rotatedWidth = box.height * scale;
  const rotatedHeight = box.width * scale;
  assert.ok(rotatedWidth <= container.width + 0.001);
  assert.ok(rotatedHeight <= container.height + 0.001);
  assert.ok(
    rotatedWidth >= container.width - 0.001 || rotatedHeight >= container.height - 0.001,
    `한 축은 꽉 채워야 함 (${rotatedWidth}x${rotatedHeight} / ${container.width}x${container.height})`,
  );
});

test('세로 영상을 가로 플레이어에서 돌리면 플레이어를 채운다', () => {
  const box = { width: 300, height: 900 };
  const container = { width: 1600, height: 900 };
  const scale = fitScale(90, box, container);

  assert.equal(scale, Math.min(1600 / 900, 900 / 300));
  assert.ok(box.height * scale <= container.width + 0.001);
  assert.ok(box.width * scale <= container.height + 0.001);
});

test('측정값이 0이거나 이상하면 배율을 건드리지 않는다', () => {
  assert.equal(fitScale(90, { width: 0, height: 0 }, { width: 100, height: 100 }), 1);
  assert.equal(fitScale(90, null, null), 1);
  assert.equal(fitScale(90, { width: 100, height: 100 }, { width: -5, height: 100 }), 1);
});

test('0도에서는 transform을 비워 원래 스타일로 돌려준다', () => {
  const box = { width: 1280, height: 720 };
  const container = { width: 1280, height: 720 };
  assert.equal(transformFor(0, box, container), '');
  assert.equal(transformFor(360, box, container), '');
});

test('transform 문자열은 회전과 배율을 함께 담는다', () => {
  const box = { width: 1280, height: 720 };
  const container = { width: 1280, height: 720 };

  assert.equal(transformFor(90, box, container), 'rotate(90deg) scale(0.563)');
  assert.equal(transformFor(180, box, container), 'rotate(180deg) scale(1)');
  assert.match(transformFor(270, box, container), /^rotate\(270deg\) scale\(0\.5\d+\)$/);
});
