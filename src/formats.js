// Format adapters: read lyric text out of a file and build a verified,
// byte-faithful replacement buffer.

import fs from 'node:fs';
import { createHash } from 'node:crypto';

import {
  findLyricTag,
  findVorbisCommentBlock,
  hashFlacAudio,
  parseFlac,
  parseVorbisComment,
  rebuildFlac,
  serializeVorbisComment,
} from './flac.js';
import { decodeUslt, findUslt, parseId3, replaceUslt, serializeId3 } from './id3.js';
import { decodeTextBuffer, encodeTextBuffer } from './lrc.js';
import { findId3Chunk, hashWavPayload, parseWav, replaceChunkData } from './wav.js';

const SUPPORTED_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.lrc']);

export function isSupportedFile(filePath) {
  return SUPPORTED_EXTENSIONS.has(extOf(filePath));
}

export function extOf(filePath) {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return '';
  return filePath.slice(dot).toLowerCase();
}

/**
 * @typedef {object} LoadedLyrics
 * @property {string} path
 * @property {string} format  human readable format description
 * @property {boolean} hasLyrics
 * @property {string} text
 * @property {(newText: string) => Buffer} build
 * @property {(newBuffer: Buffer, expectedText: string) => void} verify
 */

/**
 * @param {string} filePath
 * @returns {LoadedLyrics}
 */
export function loadLyricsFile(filePath) {
  const ext = extOf(filePath);
  if (ext === '.wav') return loadWav(filePath);
  if (ext === '.mp3') return loadMp3(filePath);
  if (ext === '.flac') return loadFlac(filePath);
  if (ext === '.lrc') return loadLrc(filePath);
  throw new Error(`unsupported file type: ${ext || '(none)'}`);
}

// ---------------------------------------------------------------------------
// WAV (ID3 chunk inside RIFF)
// ---------------------------------------------------------------------------

function loadWav(filePath) {
  const source = fs.readFileSync(filePath);
  const wav = parseWav(source);
  const id3Chunk = findId3Chunk(wav);

  if (!id3Chunk) {
    return {
      path: filePath,
      format: 'WAV',
      hasLyrics: false,
      text: '',
      build() {
        throw new Error('no ID3 chunk');
      },
      verify() {},
    };
  }

  const tag = parseId3(source.subarray(id3Chunk.dataStart, id3Chunk.dataEnd), 0);
  const uslt = tag && findUslt(tag);
  if (!tag || !uslt) {
    return {
      path: filePath,
      format: `WAV / ID3v2.${tag ? tag.major : '?'}`,
      hasLyrics: false,
      text: '',
      build() {
        throw new Error('no USLT frame');
      },
      verify() {},
    };
  }

  const decoded = decodeUslt(uslt.data);
  const payloadHash = hashWavPayload(source, wav, id3Chunk);

  return {
    path: filePath,
    format: `WAV / ID3v2.${tag.major} USLT`,
    hasLyrics: true,
    text: decoded.text,
    build(newText) {
      const newTag = replaceUslt(tag, newText);
      return replaceChunkData(source, wav, id3Chunk, serializeId3(newTag));
    },
    verify(newBuffer, expectedText) {
      const newWav = parseWav(newBuffer);
      const newId3Chunk = findId3Chunk(newWav);
      if (!newId3Chunk) throw new Error('verification failed: ID3 chunk disappeared');

      const newTag = parseId3(
        newBuffer.subarray(newId3Chunk.dataStart, newId3Chunk.dataEnd),
        0,
      );
      const newUslt = newTag && findUslt(newTag);
      if (!newUslt) throw new Error('verification failed: USLT frame disappeared');

      const actual = decodeUslt(newUslt.data).text;
      if (actual !== expectedText) {
        throw new Error('verification failed: embedded lyrics do not match the new text');
      }

      if (newBuffer.readUInt32LE(4) !== newBuffer.length - 8) {
        throw new Error('verification failed: RIFF size header is inconsistent');
      }

      const newPayloadHash = hashWavPayload(newBuffer, newWav, newId3Chunk);
      if (newPayloadHash !== payloadHash) {
        throw new Error('verification failed: non-ID3 audio bytes changed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// MP3 (ID3v2 tag at offset 0, audio bytes after it untouched)
// ---------------------------------------------------------------------------

function loadMp3(filePath) {
  const source = fs.readFileSync(filePath);
  const tag = parseId3(source, 0);

  if (!tag) {
    return {
      path: filePath,
      format: 'MP3',
      hasLyrics: false,
      text: '',
      build() {
        throw new Error('no ID3v2 tag');
      },
      verify() {},
    };
  }

  const uslt = findUslt(tag);
  if (!uslt) {
    return {
      path: filePath,
      format: `MP3 / ID3v2.${tag.major}`,
      hasLyrics: false,
      text: '',
      build() {
        throw new Error('no USLT frame');
      },
      verify() {},
    };
  }

  const decoded = decodeUslt(uslt.data);
  const audio = source.subarray(tag.end);
  const audioHash = createHash('sha256').update(audio).digest('hex');

  return {
    path: filePath,
    format: `MP3 / ID3v2.${tag.major} USLT`,
    hasLyrics: true,
    text: decoded.text,
    build(newText) {
      const newTag = replaceUslt(tag, newText);
      return Buffer.concat([serializeId3(newTag), audio]);
    },
    verify(newBuffer, expectedText) {
      const newTag = parseId3(newBuffer, 0);
      const newUslt = newTag && findUslt(newTag);
      if (!newUslt) throw new Error('verification failed: USLT frame disappeared');

      const actual = decodeUslt(newUslt.data).text;
      if (actual !== expectedText) {
        throw new Error('verification failed: embedded lyrics do not match the new text');
      }

      const newAudioHash = createHash('sha256')
        .update(newBuffer.subarray(newTag.end))
        .digest('hex');
      if (newAudioHash !== audioHash) {
        throw new Error('verification failed: audio bytes changed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// FLAC (Vorbis comment metadata block)
// ---------------------------------------------------------------------------

function loadFlac(filePath) {
  const source = fs.readFileSync(filePath);
  const flac = parseFlac(source);

  if (!flac) {
    return {
      path: filePath,
      format: 'FLAC',
      hasLyrics: false,
      text: '',
      build() {
        throw new Error('not a FLAC file');
      },
      verify() {},
    };
  }

  const block = findVorbisCommentBlock(flac);
  if (!block) {
    return {
      path: filePath,
      format: 'FLAC',
      hasLyrics: false,
      text: '',
      build() {
        throw new Error('no Vorbis comment block');
      },
      verify() {},
    };
  }

  const comment = parseVorbisComment(source.subarray(block.dataStart, block.dataEnd));
  const lyric = findLyricTag(comment.tags);
  if (!lyric) {
    return {
      path: filePath,
      format: 'FLAC / Vorbis Comment',
      hasLyrics: false,
      text: '',
      build() {
        throw new Error('no lyrics tag');
      },
      verify() {},
    };
  }

  let hadBom = false;
  let text = lyric.tag.value;
  if (text.startsWith('\uFEFF')) {
    hadBom = true;
    text = text.slice(1);
  }
  if (text.includes('\uFFFD')) {
    throw new Error('FLAC lyrics are not valid UTF-8; refusing to rewrite');
  }

  const audioHash = hashFlacAudio(source, flac);

  return {
    path: filePath,
    format: `FLAC / Vorbis Comment ${lyric.key}`,
    hasLyrics: true,
    text,
    build(newText) {
      const value = hadBom ? `\uFEFF${newText}` : newText;
      const tags = comment.tags.map((tag, index) =>
        index === lyric.index
          ? { ...tag, raw: Buffer.concat([tag.keyRaw, Buffer.from(value, 'utf8')]) }
          : tag,
      );
      const newComment = serializeVorbisComment({
        vendorRaw: comment.vendorRaw,
        tags,
        trailing: comment.trailing,
      });
      return rebuildFlac(source, flac, block, newComment);
    },
    verify(newBuffer, expectedText) {
      const newFlac = parseFlac(newBuffer);
      const newBlock = newFlac && findVorbisCommentBlock(newFlac);
      if (!newBlock) throw new Error('verification failed: Vorbis comment block disappeared');

      const newComment = parseVorbisComment(
        newBuffer.subarray(newBlock.dataStart, newBlock.dataEnd),
      );
      const newLyric = findLyricTag(newComment.tags);
      if (!newLyric) throw new Error('verification failed: lyrics tag disappeared');

      let actual = newLyric.tag.value;
      if (hadBom && actual.startsWith('\uFEFF')) actual = actual.slice(1);
      if (actual !== expectedText) {
        throw new Error('verification failed: FLAC lyrics do not match the new text');
      }
      if (newLyric.key.toUpperCase() !== lyric.key.toUpperCase()) {
        throw new Error('verification failed: FLAC lyrics tag key changed');
      }

      if (newFlac.blocks.length !== flac.blocks.length) {
        throw new Error('verification failed: FLAC metadata block count changed');
      }
      for (let i = 0; i < flac.blocks.length; i++) {
        const before = flac.blocks[i];
        const after = newFlac.blocks[i];
        if (before.type !== after.type || before.last !== after.last) {
          throw new Error('verification failed: FLAC metadata block layout changed');
        }
        if (before === block) continue;
        const beforeData = source.subarray(before.dataStart, before.dataEnd);
        const afterData = newBuffer.subarray(after.dataStart, after.dataEnd);
        if (!beforeData.equals(afterData)) {
          throw new Error('verification failed: a non-lyric FLAC metadata block changed');
        }
      }

      if (hashFlacAudio(newBuffer, newFlac) !== audioHash) {
        throw new Error('verification failed: FLAC audio frames changed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// LRC (plain text sidecar)
// ---------------------------------------------------------------------------

function loadLrc(filePath) {
  const source = fs.readFileSync(filePath);
  const meta = decodeTextBuffer(source);

  return {
    path: filePath,
    format: `LRC (${meta.encoding}${meta.bom ? ' + BOM' : ''})`,
    hasLyrics: true,
    text: meta.text,
    build(newText) {
      return encodeTextBuffer(newText, meta);
    },
    verify(newBuffer, expectedText) {
      const actual = decodeTextBuffer(newBuffer);
      if (actual.text !== expectedText) {
        throw new Error('verification failed: written LRC text does not match');
      }
    },
  };
}
