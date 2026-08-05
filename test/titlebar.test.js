'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { toColorRef } = require('../src/main/windows-titlebar');

test('COLORREF는 RGB가 아니라 BGR 순서로 담긴다', () => {
  // Getting this backwards would tint the title bar the wrong colour entirely.
  assert.equal(toColorRef('#0078d4'), 0x00d47800);
  assert.equal(toColorRef('#ff0000'), 0x000000ff);
  assert.equal(toColorRef('#0000ff'), 0x00ff0000);
});

test('회색조는 순서와 무관하게 그대로다', () => {
  assert.equal(toColorRef('#0f0f0f'), 0x000f0f0f);
  assert.equal(toColorRef('000000'), 0);
  assert.equal(toColorRef('#ffffff'), 0x00ffffff);
});
