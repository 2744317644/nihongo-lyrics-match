// Bounded lyric readers.
//
// The review and preview paths must not load multi-gigabyte audio files just to
// read a lyric tag. These readers locate only the lyric container (ID3 tag,
// RIFF `id3 ` chunk, or FLAC VORBIS_COMMENT block) and then hand the exact same
// parser functions the CLI uses (`parseId3`/`findUslt`/`decodeUslt`,
// `parseVorbisComment`/`findLyricTag`, `decodeTextBuffer`) the bytes they need.
//
// `formats.js` remains the byte-faithful writer used by lyrics_convert.

import fs from 'node:fs';

import { findLyricTag, parseVorbisComment } from './flac.js';
import { decodeUslt, findUslt, parseId3, readSyncSafe } from './id3.js';
import { decodeTextBuffer } from './lrc.js';
import { extOf } from './formats.js';

/** Refuse implausible tag sizes instead of allocating them. */
const MAX_LYRIC_BYTES = 16 * 1024 * 1024;

/**
 * @typedef {object} LyricsSnapshot
 * @property {string} format  human-readable container description
 * @property {boolean} hasLyrics
 * @property {string} text
 */

/**
 * Read exactly `length` bytes at `position`.
 * @param {number} fd
 * @param {number} position
 * @param {number} length
 * @returns {Buffer}
 */
function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const read = fs.readSync(fd, buffer, filled, length - filled, position + filled);
    if (read === 0) throw new Error('unexpected end of file while reading lyrics');
    filled += read;
  }
  return buffer;
}

/**
 * Read the lyric text of one supported file without loading its audio.
 * @param {string} filePath
 * @param {{ strictFlacUtf8?: boolean }} [options] `strictFlacUtf8` mirrors the
 *   CLI refusal to rewrite FLAC lyrics that are not valid UTF-8; the read-only
 *   review passes `false` so it can report mojibake instead of failing.
 * @returns {LyricsSnapshot}
 */
export function readLyrics(filePath, options = {}) {
  const strictFlacUtf8 = options.strictFlacUtf8 !== false;
  let ext = extOf(filePath);
  // A backup keeps the original extension: `song.flac.bak` is a FLAC file.
  if (ext === '.bak') ext = extOf(filePath.slice(0, -4));
  if (ext === '.lrc') return readLrc(filePath);
  if (ext === '.wav') return readWav(filePath);
  if (ext === '.mp3') return readMp3(filePath);
  if (ext === '.flac') return readFlac(filePath, strictFlacUtf8);
  throw new Error(`unsupported file type: ${ext || '(none)'}`);
}

/** @param {string} filePath @returns {LyricsSnapshot} */
function readLrc(filePath) {
  const source = fs.readFileSync(filePath);
  const meta = decodeTextBuffer(source);
  return {
    format: `LRC (${meta.encoding}${meta.bom ? ' + BOM' : ''})`,
    hasLyrics: true,
    text: meta.text,
  };
}

/** @param {string} filePath @returns {LyricsSnapshot} */
function readMp3(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 10) return { format: 'MP3', hasLyrics: false, text: '' };
    const header = readAt(fd, 0, 10);
    if (header.toString('latin1', 0, 3) !== 'ID3') {
      return { format: 'MP3', hasLyrics: false, text: '' };
    }
    const tagSize = readSyncSafe(header, 6);
    const total = 10 + tagSize;
    if (total > size) throw new Error('ID3 tag is truncated');
    if (tagSize > MAX_LYRIC_BYTES) throw new Error('ID3 tag is too large to inspect');
    const tag = parseId3(readAt(fd, 0, total), 0);
    const uslt = tag && findUslt(tag);
    if (!tag || !uslt) {
      return { format: `MP3 / ID3v2.${tag ? tag.major : '?'}`, hasLyrics: false, text: '' };
    }
    return {
      format: `MP3 / ID3v2.${tag.major} USLT`,
      hasLyrics: true,
      text: decodeUslt(uslt.data).text,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** @param {string} filePath @returns {LyricsSnapshot} */
function readWav(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize < 12) throw new Error('file is too small to be a WAV');
    const header = readAt(fd, 0, 12);
    if (header.toString('latin1', 0, 4) !== 'RIFF' || header.toString('latin1', 8, 12) !== 'WAVE') {
      throw new Error('not a RIFF/WAVE file');
    }

    let pos = 12;
    while (pos + 8 <= fileSize) {
      const chunkHeader = readAt(fd, pos, 8);
      const id = chunkHeader.toString('latin1', 0, 4);
      const size = chunkHeader.readUInt32LE(4);
      if (size === 0xffffffff) throw new Error(`unsupported streaming chunk size in "${id}"`);
      const dataStart = pos + 8;
      const dataEnd = dataStart + size;
      if (dataEnd > fileSize) throw new Error(`WAV chunk "${id}" is truncated`);

      if (id.toLowerCase() === 'id3 ') {
        if (size > MAX_LYRIC_BYTES) throw new Error('WAV ID3 chunk is too large to inspect');
        const tag = parseId3(readAt(fd, dataStart, size), 0);
        const uslt = tag && findUslt(tag);
        if (!tag || !uslt) {
          return { format: `WAV / ID3v2.${tag ? tag.major : '?'}`, hasLyrics: false, text: '' };
        }
        return {
          format: `WAV / ID3v2.${tag.major} USLT`,
          hasLyrics: true,
          text: decodeUslt(uslt.data).text,
        };
      }

      pos = Math.min(dataEnd + (size & 1), fileSize);
    }

    return { format: 'WAV', hasLyrics: false, text: '' };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @param {string} filePath
 * @param {boolean} strictUtf8
 * @returns {LyricsSnapshot}
 */
function readFlac(filePath, strictUtf8) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize < 8) return { format: 'FLAC', hasLyrics: false, text: '' };
    const magic = readAt(fd, 0, 4);
    if (magic.toString('latin1', 0, 4) !== 'fLaC') {
      return { format: 'FLAC', hasLyrics: false, text: '' };
    }

    let offset = 4;
    for (let blocks = 0; ; blocks++) {
      if (offset + 4 > fileSize) throw new Error('FLAC metadata is truncated');
      const blockHeader = readAt(fd, offset, 4);
      const last = Boolean(blockHeader[0] & 0x80);
      const type = blockHeader[0] & 0x7f;
      const length = blockHeader.readUIntBE(1, 3);
      const dataStart = offset + 4;
      const dataEnd = dataStart + length;
      if (dataEnd > fileSize) throw new Error(`FLAC metadata block ${type} is truncated`);

      if (type === 4) {
        if (length > MAX_LYRIC_BYTES) throw new Error('FLAC comment block is too large to inspect');
        const comment = parseVorbisComment(readAt(fd, dataStart, length));
        const lyric = findLyricTag(comment.tags);
        if (!lyric) {
          return { format: 'FLAC / Vorbis Comment', hasLyrics: false, text: '' };
        }
        let text = lyric.tag.value;
        if (text.startsWith('\uFEFF')) text = text.slice(1);
        if (strictUtf8 && text.includes('\uFFFD')) {
          throw new Error('FLAC lyrics are not valid UTF-8; refusing to rewrite');
        }
        return {
          format: `FLAC / Vorbis Comment ${lyric.key}`,
          hasLyrics: true,
          text,
        };
      }

      offset = dataEnd;
      if (last) break;
      if (blocks > 1024) throw new Error('too many FLAC metadata blocks');
    }

    return { format: 'FLAC', hasLyrics: false, text: '' };
  } finally {
    fs.closeSync(fd);
  }
}
