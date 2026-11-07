'use strict';

/* 零依赖生成 CodeCpp 应用图标：多尺寸 PNG + Windows ICO */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = __dirname;
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function mix(a, b, t) { return a + (b - a) * t; }

function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const aa = 1.15 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const bg = sdRoundRect(u, v, 0.5, 0.5, 0.46, 0.46, 0.2);
      const bgA = clamp(0.5 - bg / aa, 0, 1);
      let r = 16, g = 26, b = 36;

      const rim = clamp(1 - Math.abs(bg + 0.036) / (0.012 + aa), 0, 1) * bgA;
      r = mix(r, 84, rim); g = mix(g, 230, rim); b = mix(b, 189, rim);

      const width = 0.052;
      const bracket = Math.min(
        sdSegment(u, v, 0.345, 0.30, 0.185, 0.50),
        sdSegment(u, v, 0.185, 0.50, 0.345, 0.70),
        sdSegment(u, v, 0.655, 0.30, 0.815, 0.50),
        sdSegment(u, v, 0.815, 0.50, 0.655, 0.70)
      );
      const brA = clamp(0.5 - (bracket - width * 0.5) / aa, 0, 1) * bgA;
      const t = clamp((u - 0.15) / 0.7, 0, 1);
      r = mix(r, mix(84, 31, t), brA);
      g = mix(g, mix(230, 158, t), brA);
      b = mix(b, mix(189, 138, t), brA);

      const dot = Math.hypot(u - 0.5, v - 0.5) - 0.062;
      const dotA = clamp(0.5 - dot / aa, 0, 1) * bgA;
      r = mix(r, 236, dotA); g = mix(g, 255, dotA); b = mix(b, 248, dotA);

      const i = (y * size + x) * 4;
      pixels[i] = Math.round(clamp(r, 0, 255));
      pixels[i + 1] = Math.round(clamp(g, 0, 255));
      pixels[i + 2] = Math.round(clamp(b, 0, 255));
      pixels[i + 3] = Math.round(bgA * 255);
    }
  }
  return encodePng(size, size, pixels);
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dirs = [], blobs = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    dirs.push(entry); blobs.push(data);
  }
  return Buffer.concat([header, ...dirs, ...blobs]);
}

const images = SIZES.map((size) => ({ size, data: render(size) }));
fs.writeFileSync(path.join(OUT, 'icon.ico'), buildIco(images));
fs.writeFileSync(path.join(OUT, 'icon.png'), images[images.length - 1].data);
fs.writeFileSync(path.join(OUT, 'icon-tray.png'), images[2].data);
console.log('[CodeCpp] 图标已生成：icon.ico / icon.png / icon-tray.png (' + SIZES.join(', ') + ')');
