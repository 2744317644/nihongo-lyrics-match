// Synthetic container fixtures for the bundle tests.
// Mirrors the CLI's test/helpers.js but imports the vendored modules directly.

import { encodeUslt, serializeId3 } from '../lib/id3.js';
import { serializeVorbisComment } from '../lib/flac.js';

export function chunk(id, data) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 'latin1');
  header.writeUInt32LE(data.length, 4);
  const parts = [header, data];
  if (data.length & 1) parts.push(Buffer.alloc(1));
  return Buffer.concat(parts);
}

export function makeTag({ usltText, title = 'Test', extraFrames = [] }) {
  return {
    major: 3,
    minor: 0,
    flags: 0,
    frames: [
      {
        id: 'TIT2',
        flags: 0,
        data: Buffer.concat([Buffer.from([3]), Buffer.from(title, 'utf8')]),
      },
      ...extraFrames,
      { id: 'USLT', flags: 0, data: encodeUslt(usltText) },
    ],
  };
}

export function buildWav({ usltText, audio = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) }) {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(44100, 4);
  format.writeUInt32LE(88200, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);

  const body = Buffer.concat([
    Buffer.from('WAVE', 'latin1'),
    chunk('fmt ', format),
    chunk('data', audio),
    chunk('id3 ', serializeId3(makeTag({ usltText }))),
  ]);

  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export function buildMp3({ usltText, audio = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]) }) {
  return Buffer.concat([serializeId3(makeTag({ usltText })), audio]);
}

function flacBlock(type, data, last = false) {
  const header = Buffer.alloc(4);
  header[0] = (last ? 0x80 : 0) | (type & 0x7f);
  header.writeUIntBE(data.length, 1, 3);
  return Buffer.concat([header, data]);
}

export function buildFlac({
  usltText,
  audio = Buffer.from([0xff, 0xf8, 0x69, 0x18, 0x00, 0x00, 1, 2, 3, 4]),
  vendor = 'lyrics-splitter-test',
  lyricsKey = 'LYRICS',
  extraTags = [],
  bom = false,
}) {
  const streamInfo = Buffer.alloc(34);
  const tags = [
    { raw: Buffer.from('TITLE=Test', 'utf8') },
    ...extraTags.map((tag) => ({ raw: Buffer.from(tag, 'utf8') })),
    ...(lyricsKey
      ? [{ raw: Buffer.from(`${lyricsKey}=${bom ? '\uFEFF' : ''}${usltText}`, 'utf8') }]
      : []),
  ];
  const comment = serializeVorbisComment({
    vendorRaw: Buffer.from(vendor, 'utf8'),
    tags,
    trailing: Buffer.alloc(0),
  });

  return Buffer.concat([
    Buffer.from('fLaC', 'latin1'),
    flacBlock(0, streamInfo),
    flacBlock(4, comment),
    flacBlock(1, Buffer.alloc(64), true),
    audio,
  ]);
}
