import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeTextBuffer,
  encodeTextBuffer,
  transformLyricsText,
} from '../src/lrc.js';

const MERGED =
  '[00:00.00]作词 : A\r\n' +
  '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田\r\n' +
  '[00:02.00][00:03.00]ねえ もしかして 呐 莫非\r\n' +
  '[00:04.00]\r\n';

test('splits merged lines and keeps identical timestamps', () => {
  const result = transformLyricsText(MERGED);
  assert.equal(result.changed, 2);
  assert.equal(
    result.text,
    '[00:00.00]作词 : A\r\n' +
      '[00:01.00]春空に残る淋しさ そっと心を濡らした\r\n' +
      '[00:01.00]春雨后留下的空寂轻轻沾湿心田\r\n' +
      '[00:02.00][00:03.00]ねえ もしかして\r\n' +
      '[00:02.00][00:03.00]呐 莫非\r\n' +
      '[00:04.00]\r\n',
  );
});

test('is idempotent', () => {
  const once = transformLyricsText(MERGED);
  const twice = transformLyricsText(once.text);
  assert.equal(twice.changed, 0);
  assert.equal(twice.text, once.text);
});

test('recognises already split pairs whose Japanese line ends with kanji', () => {
  const splitText =
    '[00:10.00]小さな勇気 ポケットにつめて 深呼吸\r\n' +
    '[00:10.00]将小小的勇气装进口袋 深呼吸\r\n';
  const result = transformLyricsText(splitText);
  assert.equal(result.changed, 0);
  assert.equal(result.text, splitText);
});

test('keeps metadata, comments and blank lines untouched', () => {
  const text = '[ti:Test]\r\n[ar:Someone]\r\n\r\n[00:01.00]作词 : A\r\n';
  const result = transformLyricsText(text);
  assert.equal(result.changed, 0);
  assert.equal(result.text, text);
});

test('preserves LF line endings', () => {
  const text = '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田\n';
  const result = transformLyricsText(text);
  assert.ok(!result.text.includes('\r\n'));
  assert.equal(result.text.split('\n').length, 3);
});

test('text buffer encoding round-trips', () => {
  const text = '[00:01.00]日本語\r\n[00:01.00]中文\r\n';
  for (const meta of [
    { encoding: 'utf8', bom: false },
    { encoding: 'utf8', bom: true },
    { encoding: 'utf16le', bom: true },
    { encoding: 'utf16be', bom: true },
  ]) {
    const buffer = encodeTextBuffer(text, meta);
    const decoded = decodeTextBuffer(buffer);
    assert.equal(decoded.text, text);
    assert.equal(decoded.encoding, meta.encoding);
    assert.equal(decoded.bom, meta.bom);
  }
});
