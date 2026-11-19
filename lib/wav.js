// RIFF/WAVE container helpers.
//
// The audio payload is never decoded or re-encoded: only the `id3 ` chunk is
// replaced and every other chunk is copied byte for byte. A SHA-256 of all
// non-ID3 chunks is used after rewriting to prove the audio did not change.

import { createHash } from 'node:crypto';

function ascii(buffer, start, end) {
  return buffer.toString('latin1', start, end);
}

/**
 * @typedef {object} WavChunk
 * @property {string} id
 * @property {number} size
 * @property {number} start
 * @property {number} dataStart
 * @property {number} dataEnd
 * @property {number} paddedEnd
 */

/**
 * @typedef {object} WavFile
 * @property {WavChunk[]} chunks
 * @property {number} trailingStart
 */

/**
 * @param {Buffer} buffer
 * @returns {WavFile}
 */
export function parseWav(buffer) {
  if (buffer.length < 12) throw new Error('file is too small to be a WAV');
  if (ascii(buffer, 0, 4) !== 'RIFF' || ascii(buffer, 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }

  const chunks = [];
  let pos = 12;
  while (pos + 8 <= buffer.length) {
    const id = ascii(buffer, pos, pos + 4);
    const size = buffer.readUInt32LE(pos + 4);
    if (size === 0xffffffff) {
      throw new Error(`unsupported streaming chunk size in "${id}"`);
    }
    const dataStart = pos + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) {
      throw new Error(`WAV chunk "${id}" is truncated`);
    }
    const paddedEnd = Math.min(dataEnd + (size & 1), buffer.length);
    chunks.push({ id, size, start: pos, dataStart, dataEnd, paddedEnd });
    pos = paddedEnd;
  }

  return { chunks, trailingStart: pos };
}

/**
 * @param {WavFile} wav
 * @returns {WavChunk | null}
 */
export function findId3Chunk(wav) {
  return wav.chunks.find((chunk) => chunk.id.toLowerCase() === 'id3 ') || null;
}

/**
 * Replace the data of one chunk and rebuild the RIFF size.
 * @param {Buffer} source
 * @param {WavFile} wav
 * @param {WavChunk} target
 * @param {Buffer} newData
 * @returns {Buffer}
 */
export function replaceChunkData(source, wav, target, newData) {
  const parts = [Buffer.from(source.subarray(0, 12))];

  for (const chunk of wav.chunks) {
    if (chunk === target) {
      const size = Buffer.alloc(4);
      size.writeUInt32LE(newData.length, 0);
      parts.push(Buffer.from(chunk.id, 'latin1'), size, newData);
      if (newData.length & 1) parts.push(Buffer.alloc(1));
    } else {
      parts.push(source.subarray(chunk.start, chunk.paddedEnd));
    }
  }

  if (wav.trailingStart < source.length) {
    parts.push(source.subarray(wav.trailingStart));
  }

  const output = Buffer.concat(parts);
  output.writeUInt32LE(output.length - 8, 4);
  return output;
}

/**
 * Hash the complete bytes of every chunk except `exclude`, plus trailing bytes.
 * The RIFF header (whose size field legitimately changes) is not included.
 * @param {Buffer} buffer
 * @param {WavFile} wav
 * @param {WavChunk | null} exclude
 * @returns {string}
 */
export function hashWavPayload(buffer, wav, exclude) {
  const hash = createHash('sha256');
  for (const chunk of wav.chunks) {
    if (exclude && chunk.start === exclude.start) continue;
    hash.update(buffer.subarray(chunk.start, chunk.paddedEnd));
  }
  if (wav.trailingStart < buffer.length) {
    hash.update(buffer.subarray(wav.trailingStart));
  }
  return hash.digest('hex');
}
