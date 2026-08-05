'use strict';

/**
 * Generate the app icon (`build/icon.ico`) with no image tooling installed.
 *
 * Pixels are drawn by hand into RGBA buffers, encoded as PNG with `node:zlib`,
 * and wrapped in an ICO container — which since Vista may hold PNG frames
 * directly, so no BMP/AND-mask fiddling is needed.
 *
 *   node tools/make-icon.js
 *
 * The mark is a plain red rounded square with a white play triangle: the generic
 * "video player" idiom, deliberately not a copy of the YouTube logo.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const RED = [0xff, 0x00, 0x00];
const WHITE = [0xff, 0xff, 0xff];
/** Samples per axis; 4 means 16 samples a pixel, which is plenty for edges. */
const SUPERSAMPLE = 4;

// ---------------------------------------------------------------- drawing ---

/** Signed "insideness" of a rounded rectangle: >0 inside. */
function insideRoundedRect(x, y, size) {
  const margin = size * 0.055;
  const radius = size * 0.225;
  const left = margin;
  const top = margin;
  const right = size - margin;
  const bottom = size - margin;

  // Clamp the point to the rectangle inset by the corner radius; the distance to
  // that clamped point is what rounds the corners.
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  if (x < left || x > right || y < top || y > bottom) return -1;
  return radius - Math.hypot(dx, dy);
}

/** A right-pointing play triangle, centred. */
function insideTriangle(x, y, size) {
  const leftX = size * 0.395;
  const rightX = size * 0.675;
  const topY = size * 0.315;
  const bottomY = size * 0.685;
  const midY = size / 2;

  if (x < leftX || x > rightX) return false;
  // Interpolate the triangle's half-height at this x.
  const t = (x - leftX) / (rightX - leftX);
  const halfHeight = ((bottomY - topY) / 2) * (1 - t);
  return Math.abs(y - midY) <= halfHeight;
}

/** @returns {Buffer} RGBA pixels, row-major. */
function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bodyHits = 0;
      let playHits = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          if (insideRoundedRect(x, y, size) > 0) bodyHits += 1;
          if (insideTriangle(x, y, size)) playHits += 1;
        }
      }

      const bodyAlpha = bodyHits / samples;
      const playAlpha = playHits / samples;
      const offset = (py * size + px) * 4;

      if (bodyAlpha === 0) continue; // leave transparent

      // Composite white over red, then the whole mark over transparency.
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          RED[channel] * (1 - playAlpha) + WHITE[channel] * playAlpha,
        );
      }
      pixels[offset + 3] = Math.round(bodyAlpha * 255);
    }
  }
  return pixels;
}

// ------------------------------------------------------------------- PNG ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlacing.

  // Each scanline is prefixed with its filter type; 0 (none) keeps this simple
  // and the images are tiny either way.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------- ICO ---

function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);

  const directory = Buffer.alloc(16 * frames.length);
  let offset = header.length + directory.length;

  frames.forEach((frame, index) => {
    const entry = index * 16;
    // 256 is stored as 0 — the field is a single byte.
    directory[entry] = frame.size === 256 ? 0 : frame.size;
    directory[entry + 1] = frame.size === 256 ? 0 : frame.size;
    directory[entry + 2] = 0; // palette size
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(frame.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frame.data.length;
  });

  return Buffer.concat([header, directory, ...frames.map((frame) => frame.data)]);
}

function main() {
  const outputDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outputDir, { recursive: true });

  const frames = SIZES.map((size) => ({ size, data: encodePng(drawIcon(size), size) }));
  const ico = buildIco(frames);

  fs.writeFileSync(path.join(outputDir, 'icon.ico'), ico);
  // electron-builder wants a PNG for non-Windows targets; 256 is the useful one.
  fs.writeFileSync(path.join(outputDir, 'icon.png'), frames.at(-1).data);

  console.log(`build/icon.ico  ${SIZES.join(', ')}px  (${ico.length} bytes)`);
}

if (require.main === module) main();

module.exports = { drawIcon, encodePng, buildIco, SIZES };
