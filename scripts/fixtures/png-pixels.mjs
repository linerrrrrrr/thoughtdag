import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

// Read Chromium's 8-bit RGB/RGBA screenshots without introducing a dependency.
export function pngPixels(bytes) {
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8);
  assert.ok(bytes[25] === 2 || bytes[25] === 6);
  assert.equal(bytes[28], 0);
  const channels = bytes[25] === 6 ? 4 : 3, chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset), name = bytes.toString('ascii', offset + 4, offset + 8);
    if (name === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const prediction = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)][filter];
      pixels[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  return { width, height, color(x, y) { const offset = (y * width + x) * channels; return [pixels[offset], pixels[offset + 1], pixels[offset + 2]]; } };
}

export function blueSelectionBounds(bytes, search, beforeBytes) {
  const image = pngPixels(bytes);
  const before = beforeBytes ? pngPixels(beforeBytes) : null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
  for (let y = Math.max(0, Math.floor(search.top)); y < Math.min(image.height, Math.ceil(search.bottom)); y++) {
    for (let x = Math.max(0, Math.floor(search.left)); x < Math.min(image.width, Math.ceil(search.right)); x++) {
      const [r, g, b] = image.color(x, y);
      // Native selection fill is pale blue (215,233,255 in this light fixture).
      // Exclude dark text antialiasing and the table's static blue shading.
      if (b >= 250 && g >= 220 && g <= 245 && r >= 195 && r <= 235 && b - r >= 20 && b - g >= 10) {
        if (before) {
          const [br, bg, bb] = before.color(x, y);
          if (Math.max(Math.abs(br - r), Math.abs(bg - g), Math.abs(bb - b)) < 8) continue;
        }
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
      }
    }
  }
  return count ? { left, top, right: right + 1, bottom: bottom + 1, width: right - left + 1, height: bottom - top + 1, count } : null;
}
