// The harness reads complete concatenated zstd frames when resuming a session.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

const { scanZstdFrames, decompressZstdToText } = createRequire(import.meta.url)('../runtime/zstd-frames.cjs');
const first = zstdCompressSync(Buffer.from('first turn\n'));
const second = zstdCompressSync(Buffer.from('第二轮\n'));
const raw = Buffer.concat([first, second]);
assert.equal(scanZstdFrames(raw).frames.length, 2);
assert.equal(decompressZstdToText(raw, zstdDecompressSync), 'first turn\n第二轮\n');
const torn = Buffer.concat([first, second.subarray(0, second.length - 3)]);
assert.equal(scanZstdFrames(torn).frames.length, 1);
assert.equal(decompressZstdToText(torn, zstdDecompressSync), 'first turn\n');
assert.equal(decompressZstdToText(Buffer.from('invalid'), zstdDecompressSync), '');
console.log('PASS: complete zstd frames decode in order and a torn tail is ignored.');
