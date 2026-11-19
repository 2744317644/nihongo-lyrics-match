// Minimal, dependency-free ID3v2.3 / ID3v2.4 reader and writer.
//
// Only what lyric editing needs is implemented: reading frames, decoding and
// encoding USLT (unsynchronised lyrics) frames, and rebuilding a tag with the
// same frame order. Tags that use unsynchronisation, an extended header or
// per-frame flags are rejected instead of being silently corrupted.

export class UnsupportedTagError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedTagError';
  }
}

export function readSyncSafe(buffer, offset) {
  return (
    ((buffer[offset] & 0x7f) << 21) |
    ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) |
    (buffer[offset + 3] & 0x7f)
  );
}

export function writeSyncSafe(value) {
  const out = Buffer.alloc(4);
  out[0] = (value >> 21) & 0x7f;
  out[1] = (value >> 14) & 0x7f;
  out[2] = (value >> 7) & 0x7f;
  out[3] = value & 0x7f;
  return out;
}

function readU32BE(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function writeU32BE(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0, 0);
  return out;
}

/**
 * @typedef {object} Id3Tag
 * @property {number} start
 * @property {number} end  offset right after the tag (padding included)
 * @property {3|4} major
 * @property {number} minor
 * @property {number} flags
 * @property {{id: string, flags: number, data: Buffer}[]} frames
 * @property {number} padding
 */

/**
 * Parse an ID3v2 tag at `start`.
 * @param {Buffer} buffer
 * @param {number} [start]
 * @returns {Id3Tag | null}
 */
export function parseId3(buffer, start = 0) {
  if (buffer.length - start < 10) return null;
  if (buffer.toString('latin1', start, start + 3) !== 'ID3') return null;

  const major = buffer[start + 3];
  const minor = buffer[start + 4];
  const flags = buffer[start + 5];

  if (major !== 3 && major !== 4) {
    throw new UnsupportedTagError(`ID3v2.${major}.${minor} is not supported (only 2.3/2.4)`);
  }
  if (flags & 0x80) {
    throw new UnsupportedTagError('unsynchronised ID3 tags are not supported');
  }
  if (flags & 0x40) {
    throw new UnsupportedTagError('ID3 extended headers are not supported');
  }
  if (major === 4 && flags & 0x10) {
    throw new UnsupportedTagError('ID3v2.4 footers are not supported');
  }

  const size = readSyncSafe(buffer, start + 6);
  const end = start + 10 + size;
  if (end > buffer.length) {
    throw new Error('ID3 tag is truncated');
  }

  const frames = [];
  let pos = start + 10;
  while (pos + 10 <= end) {
    if (buffer[pos] === 0) break; // padding starts
    const id = buffer.toString('latin1', pos, pos + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // malformed trailing data

    const frameSize =
      major === 4 ? readSyncSafe(buffer, pos + 4) : readU32BE(buffer, pos + 4);
    const frameFlags = buffer.readUInt16BE(pos + 8);
    const dataStart = pos + 10;
    const dataEnd = dataStart + frameSize;
    if (dataEnd > end) {
      throw new Error(`ID3 frame ${id} is truncated`);
    }
    frames.push({ id, flags: frameFlags, data: buffer.subarray(dataStart, dataEnd) });
    pos = dataEnd;
  }

  return {
    start,
    end,
    major,
    minor,
    flags,
    frames,
    padding: end - pos,
  };
}

/**
 * Serialise a tag without padding. Frame order is preserved.
 * @param {Id3Tag} tag
 * @returns {Buffer}
 */
export function serializeId3(tag) {
  const parts = [];
  for (const frame of tag.frames) {
    const size =
      tag.major === 4
        ? writeSyncSafe(frame.data.length)
        : writeU32BE(frame.data.length);
    parts.push(Buffer.from(frame.id, 'latin1'));
    parts.push(size);
    parts.push(Buffer.from([(frame.flags >> 8) & 0xff, frame.flags & 0xff]));
    parts.push(frame.data);
  }

  const body = Buffer.concat(parts);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'latin1');
  header[3] = tag.major;
  header[4] = tag.minor;
  header[5] = 0; // no unsynchronisation / extended header / footer
  writeSyncSafe(body.length).copy(header, 6);

  return Buffer.concat([header, body]);
}

function decodeWide(buffer, bigEndian) {
  const copy = Buffer.from(buffer);
  if (copy.length % 2 === 1) return copy.subarray(0, copy.length - 1).toString('utf16le');
  if (bigEndian) copy.swap16();
  return copy.toString('utf16le');
}

function decodeSingle(buffer, encoding) {
  if (encoding === 3) return buffer.toString('utf8');
  if (encoding === 2) return decodeWide(buffer, true);
  // 0 = ISO-8859-1. UTF-16 payload stored in a ISO frame is rare; decode as
  // latin1 exactly as the spec says.
  return buffer.toString('latin1');
}

/**
 * Decode a USLT frame payload.
 * @param {Buffer} data
 * @returns {{encoding: number, language: string, descriptor: string, text: string}}
 */
export function decodeUslt(data) {
  if (data.length < 4) throw new Error('USLT frame is too short');

  const encoding = data[0];
  const language = data.toString('latin1', 1, 4);
  if (![0, 1, 2, 3].includes(encoding)) {
    throw new UnsupportedTagError(`USLT text encoding ${encoding} is not supported`);
  }

  const wide = encoding === 1 || encoding === 2;
  let bigEndian = encoding === 2;
  let pos = 4;

  if (wide && pos + 1 < data.length) {
    if (data[pos] === 0xff && data[pos + 1] === 0xfe) {
      pos += 2;
      bigEndian = false;
    } else if (data[pos] === 0xfe && data[pos + 1] === 0xff) {
      pos += 2;
      bigEndian = true;
    }
  }

  let descriptor;
  if (wide) {
    let end = pos;
    while (end + 1 < data.length && !(data[end] === 0 && data[end + 1] === 0)) {
      end += 2;
    }
    descriptor = decodeWide(data.subarray(pos, end), bigEndian);
    pos = Math.min(end + 2, data.length);
  } else {
    let end = data.indexOf(0, pos);
    if (end < 0) end = data.length;
    descriptor = decodeSingle(data.subarray(pos, end), encoding);
    pos = Math.min(end + 1, data.length);
  }

  if (wide && pos + 1 < data.length) {
    if (data[pos] === 0xff && data[pos + 1] === 0xfe) {
      pos += 2;
      bigEndian = false;
    } else if (data[pos] === 0xfe && data[pos + 1] === 0xff) {
      pos += 2;
      bigEndian = true;
    }
  }

  const text = wide
    ? decodeWide(data.subarray(pos), bigEndian)
    : decodeSingle(data.subarray(pos), encoding);

  return { encoding, language, descriptor, text };
}

/**
 * Encode a USLT payload as UTF-16LE with BOM, matching what NetEase-style
 * taggers write.
 * @param {string} text
 * @param {string} [language]
 * @returns {Buffer}
 */
export function encodeUslt(text, language = 'XXX') {
  const lang = /^[A-Za-z0-9]{3}$/.test(language) ? language : 'XXX';
  const bom = Buffer.from([0xff, 0xfe]);
  return Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from(lang, 'latin1'),
    bom, // BOM for the (empty) content descriptor
    Buffer.from([0x00, 0x00]), // empty descriptor terminator
    bom, // BOM for the lyrics string
    Buffer.from(text, 'utf16le'),
  ]);
}

/** @param {Id3Tag} tag */
export function findUslt(tag) {
  return tag.frames.find((frame) => frame.id === 'USLT') || null;
}

/**
 * Return a copy of the tag with the first USLT frame replaced by `text`.
 * Multiple USLT frames are rejected: merging them would lose languages.
 * @param {Id3Tag} tag
 * @param {string} text
 * @param {string} [language]
 * @returns {Id3Tag}
 */
export function replaceUslt(tag, text, language) {
  const uslts = tag.frames.filter((frame) => frame.id === 'USLT');
  if (uslts.length === 0) throw new Error('no USLT frame found');
  if (uslts.length > 1) {
    throw new UnsupportedTagError('multiple USLT frames in one tag are not supported');
  }
  if (uslts[0].flags !== 0) {
    throw new UnsupportedTagError('USLT frame flags are not supported');
  }

  const current = decodeUslt(uslts[0].data);
  const data = encodeUslt(text, language || current.language);
  const frames = tag.frames.map((frame) =>
    frame.id === 'USLT' ? { ...frame, flags: 0, data } : frame,
  );
  return { ...tag, frames };
}
