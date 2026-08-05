'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { drawIcon, encodePng, buildIco } = require('../tools/make-icon');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function frame(size) {
  return { size, data: encodePng(drawIcon(size), size) };
}

test('아이콘 중앙은 흰 삼각형, 모서리는 투명, 나머지는 빨강', () => {
  const size = 64;
  const pixels = drawIcon(size);
  const at = (x, y) => pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4);

  const centre = at(size / 2, size / 2);
  assert.deepEqual([...centre], [255, 255, 255, 255], '중앙은 재생 삼각형');

  const corner = at(0, 0);
  assert.equal(corner[3], 0, '라운드 모서리 바깥은 투명해야 한다');

  const body = at(size / 2, Math.round(size * 0.12));
  assert.deepEqual([...body], [255, 0, 0, 255], '삼각형 밖 본체는 빨강');
});

test('PNG 인코딩이 올바른 시그니처와 청크를 낸다', () => {
  const png = encodePng(drawIcon(32), 32);

  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
  assert.ok(png.includes(Buffer.from('IHDR')));
  assert.ok(png.includes(Buffer.from('IDAT')));
  assert.ok(png.subarray(-12).includes(Buffer.from('IEND')));
  // IHDR payload starts at byte 16: width, height, depth, colour type.
  assert.equal(png.readUInt32BE(16), 32);
  assert.equal(png.readUInt32BE(20), 32);
  assert.equal(png[24], 8, 'bit depth');
  assert.equal(png[25], 6, 'colour type RGBA');
});

test('ICO 디렉터리가 각 프레임을 정확히 가리킨다', () => {
  const frames = [frame(16), frame(32), frame(256)];
  const ico = buildIco(frames);

  assert.equal(ico.readUInt16LE(0), 0, 'reserved');
  assert.equal(ico.readUInt16LE(2), 1, 'type = icon');
  assert.equal(ico.readUInt16LE(4), frames.length);

  frames.forEach((expected, index) => {
    const entry = 6 + index * 16;
    // 256 does not fit in a byte and is stored as 0 — getting this wrong makes
    // Windows read the largest frame as a 0-pixel image.
    assert.equal(ico[entry], expected.size === 256 ? 0 : expected.size, 'width');
    assert.equal(ico[entry + 1], expected.size === 256 ? 0 : expected.size, 'height');
    assert.equal(ico.readUInt16LE(entry + 4), 1, 'colour planes');
    assert.equal(ico.readUInt16LE(entry + 6), 32, 'bits per pixel');

    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.equal(length, expected.data.length);
    assert.ok(offset + length <= ico.length, '프레임이 파일 범위를 벗어나면 안 된다');
    assert.deepEqual(ico.subarray(offset, offset + 8), PNG_SIGNATURE);
  });
});
