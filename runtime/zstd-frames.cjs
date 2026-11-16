// Decode concatenated frames in DSH session logs.
//
// A log is a CONCATENATION of independently encoded zstd frames (one
// checksummed frame per durable batch append). Node's one-shot
// zstdDecompressSync stops after the first frame, so every reader first walks
// the container structurally (scanZstdFrames) and then decodes frame by frame.
//
const ZSTD_MAGIC = 4247762216; // 0xFD2FB528 LE

/** [start, end) byte ranges of every structurally COMPLETE zstd frame.
 *  A torn final frame (the live tail of a session still being written) is
 *  dropped: the next read sees it whole. */
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames };
    offset += 4;
    if (offset === buffer.length) break;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) break;
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

/** Decode a concatenated-frame zstd buffer to UTF-8 text ('' when corrupt). */
function decompressZstdToText(raw, inflate) {
  try {
    const { frames } = scanZstdFrames(raw);
    if (frames.length === 0) return '';
    const parts = [];
    for (const { start, end } of frames) parts.push(inflate(raw.subarray(start, end)));
    return Buffer.concat(parts).toString('utf8');
  } catch {
    return '';
  }
}

module.exports = {
  ZSTD_MAGIC,
  decompressZstdToText,
  scanZstdFrames,
};
