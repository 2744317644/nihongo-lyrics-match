import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UnsupportedTagError,
  decodeUslt,
  encodeUslt,
  findUslt,
  parseId3,
  replaceUslt,
  serializeId3,
  writeSyncSafe,
} from '../src/id3.js';

function textFrame(id, text) {
  return {
    id,
    flags: 0,
    data: Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]),
  };
}

function sampleTag() {
  return {
    major: 3,
    minor: 0,
    flags: 0,
    frames: [
      textFrame('TIT2', '春空'),
      { id: 'USLT', flags: 0, data: encodeUslt('[00:01.00]日本語 中文') },
      textFrame('TPE1', '水瀬いのり'),
    ],
  };
}

test('serialises and re-parses a tag', () => {
  const buffer = serializeId3(sampleTag());
  const tag = parseId3(buffer, 0);
  assert.equal(tag.major, 3);
  assert.deepEqual(
    tag.frames.map((frame) => frame.id),
    ['TIT2', 'USLT', 'TPE1'],
  );

  const uslt = findUslt(tag);
  assert.equal(decodeUslt(uslt.data).text, '[00:01.00]日本語 中文');
  assert.equal(decodeUslt(uslt.data).language, 'XXX');
});

test('replacing USLT keeps every other frame byte-identical and in order', () => {
  const original = sampleTag();
  const newText = '[00:01.00]日本語\r\n[00:01.00]中文';
  const replaced = replaceUslt(original, newText);

  assert.equal(replaced.frames.length, original.frames.length);
  for (let i = 0; i < original.frames.length; i++) {
    assert.equal(replaced.frames[i].id, original.frames[i].id);
    if (original.frames[i].id !== 'USLT') {
      assert.ok(replaced.frames[i].data.equals(original.frames[i].data));
    }
  }

  const tag = parseId3(serializeId3(replaced), 0);
  assert.equal(decodeUslt(findUslt(tag).data).text, newText);
});

test('rejects unsynchronised tags instead of corrupting them', () => {
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'latin1');
  header[3] = 3;
  header[5] = 0x80;
  writeSyncSafe(0).copy(header, 6);
  assert.throws(() => parseId3(header, 0), UnsupportedTagError);
});

test('decodes the empty-descriptor layout written by NetEase-style taggers', () => {
  // 01 "XXX" BOM 00 00 BOM "[00:00.00]" UTF-16LE
  const text = '[00:00.00]作词 : Someone\r\n';
  const payload = encodeUslt(text);
  assert.equal(payload[0], 1);
  assert.equal(payload.toString('latin1', 1, 4), 'XXX');
  assert.equal(decodeUslt(payload).text, text);
});
