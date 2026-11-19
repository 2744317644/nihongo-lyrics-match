import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  findLyricTag,
  findVorbisCommentBlock,
  hashFlacAudio,
  parseFlac,
  parseVorbisComment,
} from '../src/flac.js';
import { loadLyricsFile } from '../src/formats.js';
import { transformLyricsText } from '../src/lrc.js';
import { buildFlac } from './helpers.js';

const MERGED =
  '[00:00.00]作词 : Someone\r\n' +
  '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田\r\n';

test('parses FLAC metadata and locates the lyrics tag', () => {
  const buffer = buildFlac({ usltText: '[00:01.00]日本語 中文' });
  const flac = parseFlac(buffer);
  assert.ok(flac);
  assert.deepEqual(
    flac.blocks.map((block) => block.type),
    [0, 4, 1],
  );
  assert.equal(flac.blocks[2].last, true);
  assert.equal(
    buffer.subarray(flac.audioOffset).toString('hex'),
    Buffer.from([0xff, 0xf8, 0x69, 0x18, 0x00, 0x00, 1, 2, 3, 4]).toString('hex'),
  );

  const commentBlock = findVorbisCommentBlock(flac);
  const comment = parseVorbisComment(
    buffer.subarray(commentBlock.dataStart, commentBlock.dataEnd),
  );
  const lyric = findLyricTag(comment.tags);
  assert.equal(lyric.key, 'LYRICS');
  assert.equal(lyric.tag.value, '[00:01.00]日本語 中文');
});

test('prefers LYRICS over other lyric tag spellings', () => {
  const buffer = buildFlac({
    usltText: 'ignored',
    extraTags: ['UNSYNCEDLYRICS=older value'],
  });
  const flac = parseFlac(buffer);
  const commentBlock = findVorbisCommentBlock(flac);
  const comment = parseVorbisComment(
    buffer.subarray(commentBlock.dataStart, commentBlock.dataEnd),
  );
  const lyric = findLyricTag(comment.tags);
  assert.equal(lyric.key, 'LYRICS');
});

test('rewrites only the lyrics tag and keeps audio frames untouched', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-flac-'));
  const filePath = path.join(directory, 'song.flac');
  const source = buildFlac({ usltText: MERGED, extraTags: ['ALBUM=Test Album'] });

  try {
    fs.writeFileSync(filePath, source);
    const loaded = loadLyricsFile(filePath);
    assert.equal(loaded.hasLyrics, true);
    assert.equal(loaded.text, MERGED);

    const transform = transformLyricsText(loaded.text);
    assert.equal(transform.changed, 1);

    const output = loaded.build(transform.text);
    loaded.verify(output, transform.text);

    fs.writeFileSync(filePath, output);
    const rewritten = fs.readFileSync(filePath);
    const beforeFlac = parseFlac(source);
    const afterFlac = parseFlac(rewritten);

    assert.equal(hashFlacAudio(source, beforeFlac), hashFlacAudio(rewritten, afterFlac));
    assert.deepEqual(
      beforeFlac.blocks.map((block) => block.type),
      afterFlac.blocks.map((block) => block.type),
    );

    // Everything except the Vorbis comment block is byte-identical.
    for (let i = 0; i < beforeFlac.blocks.length; i++) {
      const before = beforeFlac.blocks[i];
      const after = afterFlac.blocks[i];
      if (before.type === 4) continue;
      assert.ok(
        source
          .subarray(before.dataStart, before.dataEnd)
          .equals(rewritten.subarray(after.dataStart, after.dataEnd)),
      );
    }

    const reloaded = loadLyricsFile(filePath);
    assert.equal(reloaded.text, transform.text);

    const again = transformLyricsText(reloaded.text);
    assert.equal(again.changed, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('preserves a UTF-8 BOM in the lyrics value', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-flac-'));
  const filePath = path.join(directory, 'song.flac');

  try {
    fs.writeFileSync(filePath, buildFlac({ usltText: MERGED, bom: true }));
    const loaded = loadLyricsFile(filePath);
    assert.ok(!loaded.text.startsWith('\uFEFF'));

    const transform = transformLyricsText(loaded.text);
    const output = loaded.build(transform.text);
    loaded.verify(output, transform.text);

    const flac = parseFlac(output);
    const block = findVorbisCommentBlock(flac);
    const comment = parseVorbisComment(output.subarray(block.dataStart, block.dataEnd));
    const lyric = findLyricTag(comment.tags);
    assert.ok(lyric.tag.value.startsWith('\uFEFF'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('reports files without a lyrics tag as having no lyrics', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-flac-'));
  const filePath = path.join(directory, 'song.flac');

  try {
    fs.writeFileSync(filePath, buildFlac({ usltText: '', lyricsKey: null }));
    const loaded = loadLyricsFile(filePath);
    assert.equal(loaded.hasLyrics, false);
    assert.equal(loaded.format, 'FLAC / Vorbis Comment');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
