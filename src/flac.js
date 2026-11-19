// FLAC container + Vorbis comment support.
//
// FLAC stores lyrics in a VORBIS_COMMENT metadata block (block type 4), usually
// under the `LYRICS` key. Only that block is rebuilt; every other metadata
// block and all audio frames are copied byte for byte.

import { createHash } from 'node:crypto';

const FLAC_MAGIC = 'fLaC';
const BLOCK_TYPE_VORBIS_COMMENT = 4;

// Preference order when several lyric tags are present.
const LYRIC_KEYS = [
  'LYRICS',
  'UNSYNCEDLYRICS',
  'UNSYNCED LYRICS',
  'SYNCEDLYRICS',
  'SYNCED LYRICS',
  'LYRIC',
];

function u32le(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

/**
 * @typedef {object} FlacBlock
 * @property {number} type
 * @property {boolean} last
 * @property {number} start
 * @property {number} length
 * @property {number} dataStart
 * @property {number} dataEnd
 */

/**
 * @typedef {object} FlacFile
 * @property {FlacBlock[]} blocks
 * @property {number} audioOffset
 */

/**
 * @param {Buffer} buffer
 * @returns {FlacFile | null}
 */
export function parseFlac(buffer) {
  if (buffer.length < 8 || buffer.toString('ascii', 0, 4) !== FLAC_MAGIC) {
    return null;
  }

  const blocks = [];
  let offset = 4;
  for (;;) {
    if (offset + 4 > buffer.length) throw new Error('FLAC metadata is truncated');
    const header = buffer[offset];
    const last = Boolean(header & 0x80);
    const type = header & 0x7f;
    const length = buffer.readUIntBE(offset + 1, 3);
    const dataStart = offset + 4;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) {
      throw new Error(`FLAC metadata block ${type} is truncated`);
    }
    blocks.push({ type, last, start: offset, length, dataStart, dataEnd });
    offset = dataEnd;
    if (last) break;
    if (blocks.length > 1024) throw new Error('too many FLAC metadata blocks');
  }

  return { blocks, audioOffset: offset };
}

/**
 * @param {FlacFile} flac
 * @returns {FlacBlock | null}
 */
export function findVorbisCommentBlock(flac) {
  return flac.blocks.find((block) => block.type === BLOCK_TYPE_VORBIS_COMMENT) || null;
}

/**
 * Parse a Vorbis comment block payload.
 * @param {Buffer} data
 * @returns {{vendorRaw: Buffer, vendor: string, tags: {key: string, keyRaw: Buffer, value: string, raw: Buffer}[], trailing: Buffer}}
 */
export function parseVorbisComment(data) {
  let pos = 0;
  if (data.length < 8) throw new Error('Vorbis comment block is too short');

  const vendorLength = data.readUInt32LE(pos);
  pos += 4;
  if (pos + vendorLength > data.length) throw new Error('Vorbis vendor string is truncated');
  const vendorRaw = data.subarray(pos, pos + vendorLength);
  const vendor = vendorRaw.toString('utf8');
  pos += vendorLength;

  if (pos + 4 > data.length) throw new Error('Vorbis comment count is truncated');
  const count = data.readUInt32LE(pos);
  pos += 4;
  if (count > 100000) throw new Error('Vorbis comment count is implausible');

  const tags = [];
  for (let i = 0; i < count; i++) {
    if (pos + 4 > data.length) throw new Error('Vorbis comment length is truncated');
    const length = data.readUInt32LE(pos);
    pos += 4;
    if (pos + length > data.length) throw new Error('Vorbis comment is truncated');
    const raw = data.subarray(pos, pos + length);
    pos += length;

    const text = raw.toString('utf8');
    const equals = text.indexOf('=');
    if (equals < 0) {
      tags.push({ key: text, keyRaw: raw, value: '', raw });
    } else {
      tags.push({
        key: text.slice(0, equals),
        keyRaw: raw.subarray(0, equals + 1),
        value: text.slice(equals + 1),
        raw,
      });
    }
  }

  return { vendorRaw, vendor, tags, trailing: data.subarray(pos) };
}

/**
 * Find the lyric tag using a stable key preference.
 * @param {{key: string, value: string}[]} tags
 * @returns {{tag: object, index: number, key: string} | null}
 */
export function findLyricTag(tags) {
  for (const key of LYRIC_KEYS) {
    const index = tags.findIndex(
      (tag) => tag.key.toUpperCase() === key && tag.value.trim().length > 0,
    );
    if (index >= 0) return { tag: tags[index], index, key: tags[index].key };
  }
  return null;
}

/**
 * Serialise a Vorbis comment block payload.
 * @param {{vendorRaw: Buffer, tags: {raw: Buffer}[], trailing: Buffer}} comment
 * @returns {Buffer}
 */
export function serializeVorbisComment(comment) {
  const parts = [
    u32le(comment.vendorRaw.length),
    comment.vendorRaw,
    u32le(comment.tags.length),
  ];
  for (const tag of comment.tags) {
    parts.push(u32le(tag.raw.length), tag.raw);
  }
  if (comment.trailing && comment.trailing.length > 0) parts.push(comment.trailing);
  return Buffer.concat(parts);
}

/**
 * Rebuild a FLAC file, replacing the payload of one metadata block.
 * @param {Buffer} source
 * @param {FlacFile} flac
 * @param {FlacBlock} target
 * @param {Buffer} newData
 * @returns {Buffer}
 */
export function rebuildFlac(source, flac, target, newData) {
  if (newData.length > 0xffffff) {
    throw new Error('new Vorbis comment block exceeds the 16 MiB FLAC metadata limit');
  }

  const parts = [Buffer.from(FLAC_MAGIC, 'latin1')];
  for (const block of flac.blocks) {
    const data =
      block === target ? newData : source.subarray(block.dataStart, block.dataEnd);
    const header = Buffer.alloc(4);
    header[0] = (block.last ? 0x80 : 0) | (block.type & 0x7f);
    header.writeUIntBE(data.length, 1, 3);
    parts.push(header, data);
  }
  parts.push(source.subarray(flac.audioOffset));

  return Buffer.concat(parts);
}

/**
 * SHA-256 of everything after the metadata blocks (the audio frames).
 * @param {Buffer} buffer
 * @param {FlacFile} flac
 * @returns {string}
 */
export function hashFlacAudio(buffer, flac) {
  return createHash('sha256').update(buffer.subarray(flac.audioOffset)).digest('hex');
}
