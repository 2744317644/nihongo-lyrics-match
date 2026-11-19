// Container, conversion, revert, and Host-tool contract tests.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { convertDirectory } from '../lib/convert.js';
import { loadLyricsFile } from '../lib/formats.js';
import { hashFlacAudio, parseFlac } from '../lib/flac.js';
import { parseId3 } from '../lib/id3.js';
import { analyzeLyricsText } from '../lib/lrc.js';
import { readLyrics } from '../lib/lyrics-source.js';
import { reviewDirectory } from '../lib/review.js';
import { revertPath } from '../lib/revert.js';
import { toolDefinitions } from '../lib/tools.js';
import { findId3Chunk, hashWavPayload, parseWav } from '../lib/wav.js';
import { buildFlac, buildMp3, buildWav, chunk } from '../test-support/fixtures.js';
import { schemaViolations, valueViolations } from '../test-support/schema-contract.js';
import { sha256File, withTempDir, writeFixture } from '../test-support/util.js';

const MERGED = [
  '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田',
  '[00:02.00]心做し (COVER版) - 鹿乃',
  '[00:03.00]きれいな世界 変',
  '',
].join('\n');

const AUDIO = Buffer.from(Array.from({ length: 256 }, (_, index) => (index * 37) & 0xff));

const BACKUP_DIR = '.lyrics-backup';

/** @param {string} dir @param {string} name */
function backupFor(dir, name) {
  return path.join(dir, BACKUP_DIR, name);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Hash everything except the lyric container, per format. */
function audioHash(fileOrBuffer, ext) {
  const buffer = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : fs.readFileSync(fileOrBuffer);
  if (ext === '.wav') {
    const wav = parseWav(buffer);
    return hashWavPayload(buffer, wav, findId3Chunk(wav));
  }
  if (ext === '.mp3') {
    const tag = parseId3(buffer, 0);
    return sha256(buffer.subarray(tag ? tag.end : 0));
  }
  if (ext === '.flac') {
    const flac = parseFlac(buffer);
    return hashFlacAudio(buffer, flac);
  }
  return sha256(buffer);
}

function buildWavWithoutId3() {
  const body = Buffer.concat([
    Buffer.from('WAVE', 'latin1'),
    chunk('data', AUDIO),
  ]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const CONTAINERS = [
  ['wav', buildWav({ usltText: MERGED, audio: AUDIO })],
  ['mp3', buildMp3({ usltText: MERGED, audio: AUDIO })],
  ['flac', buildFlac({ usltText: MERGED, audio: AUDIO })],
  ['lrc', Buffer.from(MERGED, 'utf8')],
];

test('bounded lyric reader agrees with the container reader', async () => {
  await withTempDir(async (dir) => {
    for (const [ext, buffer] of CONTAINERS) {
      const file = writeFixture(dir, `sample.${ext}`, buffer);
      const bounded = readLyrics(file);
      const loaded = loadLyricsFile(file);
      assert.equal(bounded.format, loaded.format, ext);
      assert.equal(bounded.hasLyrics, loaded.hasLyrics, ext);
      assert.equal(bounded.text, loaded.text, ext);
    }
  });
});

test('conversion keeps audio bytes, saves one LRC backup, then review/revert use it', async () => {
  for (const [ext, buffer] of CONTAINERS) {
    await withTempDir(async (dir) => {
      const file = writeFixture(dir, `sample.${ext}`, buffer);
      const originalHash = sha256(buffer);
      const originalAudio = audioHash(buffer, `.${ext}`);
      const backup = backupFor(dir, ext === 'lrc' ? 'sample.lrc' : `sample.${ext}.lrc`);

      const preview = convertDirectory({ directory: dir });
      assert.equal(preview.summary.mode, 'preview');
      assert.equal(preview.files[0].status, 'would-change');
      assert.equal(sha256File(file), originalHash, 'preview must not write');
      assert.equal(fs.existsSync(path.join(dir, BACKUP_DIR)), false, 'preview must not back up');

      const applied = convertDirectory({ directory: dir, apply: true });
      assert.equal(applied.files[0].status, 'changed', `apply ${ext}`);
      assert.equal(applied.files[0].verified, true);
      assert.equal(applied.files[0].backupKind, 'lrc', `apply ${ext} backup kind`);
      assert.equal(applied.summary.backupsCreated, 1);
      assert.equal(applied.summary.backupRoot, path.join(dir, BACKUP_DIR));
      assert.ok(fs.existsSync(backup), `LRC backup exists for ${ext}`);
      assert.equal(fs.existsSync(`${file}.bak`), false, `no full-file .bak for ${ext}`);

      if (ext === 'lrc') {
        assert.deepEqual(fs.readFileSync(backup), buffer, 'LRC backup keeps the original text bytes');
      } else {
        assert.equal(fs.readFileSync(backup, 'utf8'), MERGED, `audio backup is the original lyric text (${ext})`);
        assert.equal(audioHash(fs.readFileSync(file), `.${ext}`), originalAudio, `audio bytes ${ext}`);
      }

      const expected = analyzeLyricsText(MERGED).text;
      assert.equal(readLyrics(file).text, expected);

      const review = reviewDirectory({ directory: dir });
      assert.equal(review.summary.converted, 1);
      assert.equal(review.summary.pairs, 2);
      assert.equal(review.summary.filesWithLrcBackup, 1);
      assert.equal(review.summary.filesWithLegacyBackup, 0);
      assert.equal(review.files[0].status, 'converted');
      assert.equal(review.files[0].backupKind, 'lrc');

      const reverted = revertPath({ path: file, confirm: true });
      assert.equal(reverted.ok, true);
      assert.equal(reverted.counts.restored, 1);
      assert.equal(reverted.restored[0].verified, true);
      assert.equal(reverted.restored[0].backupKind, 'lrc');
      if (ext === 'lrc') {
        assert.equal(sha256File(file), originalHash, 'LRC revert is byte-identical');
      } else {
        assert.equal(readLyrics(file).text, MERGED, `lyrics restored from the LRC backup (${ext})`);
        assert.equal(audioHash(fs.readFileSync(file), `.${ext}`), originalAudio, `audio bytes after revert ${ext}`);
      }
      assert.ok(fs.existsSync(backup), 'revert keeps the LRC backup');
    });
  }
});

test('conversion is idempotent and skips lyrics without a Chinese marker unless forced', async () => {
  await withTempDir(async (dir) => {
    writeFixture(dir, 'no-marker.lrc', Buffer.from('[00:01.00]ああ 世界 大丈夫\n', 'utf8'));
    const first = convertDirectory({ directory: dir });
    assert.equal(first.files[0].status, 'skipped-no-translation');
    assert.equal(first.summary.skippedNoTranslation, 1);

    const forced = convertDirectory({ directory: dir, apply: true, force: true });
    assert.equal(forced.files[0].status, 'changed');
    assert.equal(readLyrics(path.join(dir, 'no-marker.lrc')).text, '[00:01.00]ああ\n[00:01.00]世界 大丈夫\n');
    assert.equal(
      fs.readFileSync(backupFor(dir, 'no-marker.lrc'), 'utf8'),
      '[00:01.00]ああ 世界 大丈夫\n',
      'the original unsplit lyrics are backed up',
    );

    const second = convertDirectory({ directory: dir });
    assert.equal(second.files[0].status, 'already-ok');
    assert.equal(second.summary.changed, 0);
  });
});

test('review handles no-lyrics containers and does not write', async () => {
  await withTempDir(async (dir) => {
    const wav = writeFixture(dir, 'plain.wav', buildWavWithoutId3());
    const flac = writeFixture(dir, 'instrumental.flac', buildFlac({ usltText: 'x', lyricsKey: null }));
    const before = [sha256File(wav), sha256File(flac)];
    const review = reviewDirectory({ directory: dir });
    assert.equal(review.summary.noLyrics, 2);
    assert.deepEqual(review.summary.fileFlags, { noLyrics: 2 });
    assert.deepEqual([sha256File(wav), sha256File(flac)], before);
    assert.deepEqual(review.lines, []);
  });
});

test('revert requires confirm, skips files without a backup, and supports legacy .bak copies', async () => {
  await withTempDir(async (dir) => {
    const file = writeFixture(dir, 'song.lrc', Buffer.from(MERGED, 'utf8'));
    const converted = convertDirectory({ directory: dir, apply: true });
    assert.equal(converted.summary.backupsCreated, 1);
    const backup = backupFor(dir, 'song.lrc');
    assert.ok(fs.existsSync(backup));
    assert.equal(fs.existsSync(`${file}.bak`), false);

    assert.throws(() => revertPath({ path: file, confirm: false }), /confirm: true/);
    assert.notEqual(fs.readFileSync(file, 'utf8'), MERGED);

    writeFixture(dir, 'no-bak.lrc', Buffer.from('[00:01.00]きれいな世界\n[00:01.00]变\n', 'utf8'));
    const byDirectory = revertPath({ path: dir, confirm: true });
    assert.equal(byDirectory.mode, 'directory');
    assert.equal(byDirectory.counts.restored, 1);
    assert.equal(byDirectory.counts.skipped, 1);
    assert.deepEqual(byDirectory.skipped.map((entry) => entry.path), ['no-bak.lrc']);
    assert.equal(byDirectory.restored[0].backupKind, 'lrc');
    assert.equal(fs.readFileSync(file, 'utf8'), MERGED);

    // Converting again reuses the existing LRC backup instead of overwriting it.
    const reconverted = convertDirectory({ directory: dir, apply: true, force: true });
    assert.equal(reconverted.summary.backupsCreated, 0);
    assert.equal(reconverted.summary.backupsReused, 1);

    // Legacy full-file .bak backups stay usable: explicit .bak path and auto-detection.
    const legacy = writeFixture(dir, 'legacy.lrc', Buffer.from(MERGED, 'utf8'));
    fs.copyFileSync(legacy, `${legacy}.bak`);
    fs.writeFileSync(legacy, analyzeLyricsText(MERGED).text, 'utf8');

    const viaLegacy = revertPath({ path: legacy, confirm: true });
    assert.equal(viaLegacy.counts.restored, 1);
    assert.equal(viaLegacy.restored[0].backupKind, 'legacy');
    assert.equal(fs.readFileSync(legacy, 'utf8'), MERGED);
    assert.ok(fs.existsSync(`${legacy}.bak`), 'legacy backup is kept');

    fs.writeFileSync(legacy, analyzeLyricsText(MERGED).text, 'utf8');
    const viaBakPath = revertPath({ path: `${legacy}.bak`, confirm: true });
    assert.equal(viaBakPath.mode, 'file');
    assert.equal(viaBakPath.counts.restored, 1);
    assert.equal(fs.readFileSync(legacy, 'utf8'), MERGED);
  });
});

test('Host tool definitions satisfy the enforced schema subset and return valid values', async () => {
  await withTempDir(async (dir) => {
    writeFixture(dir, 'song.lrc', Buffer.from(MERGED, 'utf8'));
    const byName = new Map(toolDefinitions.map((definition) => [definition.name, definition]));
    assert.deepEqual([...byName.keys()], ['lyrics_convert', 'lyrics_review', 'lyrics_revert', 'lyrics_report']);

    for (const definition of toolDefinitions) {
      assert.deepEqual(schemaViolations(definition.parameters, { objectRoot: true }), [], `${definition.name} parameters`);
      assert.deepEqual(schemaViolations(definition.output.schema, { objectRoot: true }), [], `${definition.name} output`);
      assert.equal(typeof definition.execute, 'function');
      assert.equal(typeof definition.output.render, 'function');
      assert.ok(definition.description.length > 40);
    }

    const convert = byName.get('lyrics_convert');
    const convertResult = await convert.execute({ directory: dir, apply: true, review: true }, {});
    assert.deepEqual(valueViolations(convert.output.schema, convertResult), []);
    assert.equal(convertResult.mode, 'apply');
    assert.equal(convertResult.files[0].status, 'changed');
    assert.ok(convertResult.review);
    assert.ok(convertResult.review.summary.pairs > 0);
    const convertText = convert.output.render({}, convertResult);
    assert.equal(convertText[0].type, 'text');
    assert.match(convertText[0].text, /lyrics conversion/);

    const review = byName.get('lyrics_review');
    const reviewResult = await review.execute({ directory: dir }, {});
    assert.deepEqual(valueViolations(review.output.schema, reviewResult), []);
    assert.equal(reviewResult.filter, 'flagged');
    assert.equal(reviewResult.summary.converted, 1);
    const reviewText = review.output.render({}, reviewResult);
    assert.match(reviewText[0].text, /lyrics review/);

    const revert = byName.get('lyrics_revert');
    const revertResult = await revert.execute({ path: path.join(dir, 'song.lrc'), confirm: true }, {});
    assert.deepEqual(valueViolations(revert.output.schema, revertResult), []);
    assert.equal(revertResult.counts.restored, 1);
    assert.match(revert.output.render({}, revertResult)[0].text, /restored 1 file/);

    // Argument guards.
    await assert.rejects(convert.execute({ directory: dir, nope: true }, {}), /unknown argument/);
    await assert.rejects(convert.execute({}, {}), /directory is required/);
    await assert.rejects(review.execute({ directory: dir, filter: 'weird' }, {}), /filter must be/);
    await assert.rejects(review.execute({ directory: dir, limit: 0 }, {}), /limit must be a positive/);
    await assert.rejects(revert.execute({ path: dir, confirm: false }, {}), /confirm: true/);
    await assert.rejects(revert.execute({ path: dir }, {}), /confirm: true/);
  });
});

test('the Host plugin registers exactly the four tools and the panel routes', async () => {
  const plugin = await import('../index.js');
  const { REVIEW_ROUTE, REVERT_ROUTE } = await import('../lib/web-api.js');
  assert.equal(plugin.name, 'nihongo-lyrics-match');
  assert.deepEqual(plugin.inject, ['tools']);
  const registered = [];
  const routes = [];
  const injectCalls = [];
  plugin.apply({
    tools: {
      register(definition) {
        registered.push(definition);
        return () => {};
      },
    },
    inject(services, callback) {
      injectCalls.push(services);
      callback({
        webServer: {
          register(route) {
            routes.push(route);
            return () => {};
          },
        },
        effect(callback) {
          return callback();
        },
      });
      return () => {};
    },
  });
  assert.deepEqual(registered.map((definition) => definition.name), [
    'lyrics_convert',
    'lyrics_review',
    'lyrics_revert',
    'lyrics_report',
  ]);
  assert.deepEqual(injectCalls, [['webServer']]);
  assert.deepEqual(routes.map((route) => [route.kind, route.path]), [
    ['exact', REVIEW_ROUTE],
    ['exact', REVERT_ROUTE],
  ]);
});

test('real library file survives convert, review and revert', async (t) => {
  const library = process.env.LYRICS_TEST_LIBRARY;
  if (!library || !fs.existsSync(library)) {
    return t.skip('set LYRICS_TEST_LIBRARY to a real lyrics library to run this test');
  }

  const { SUPPORTED_EXTS, collectFiles } = await import('../lib/scan.js');
  const files = collectFiles(library)
    .map((file) => ({ file, stat: fs.statSync(file) }))
    .sort((left, right) => left.stat.size - right.stat.size);

  // Prefer a real file that still carries merged lyrics, so the apply → review →
  // revert cycle runs on untouched source data.
  let picked = null;
  for (const entry of files.slice(0, 80)) {
    if (!readLyrics(entry.file).hasLyrics) continue;
    picked = entry.file;
    if (analyzeLyricsText(readLyrics(entry.file).text).changed > 0) break;
  }
  assert.ok(picked, 'no readable lyrics file found in the library');
  const ext = path.extname(picked).toLowerCase();
  assert.ok(SUPPORTED_EXTS.has(ext.replace(/^\./, '')));

  await withTempDir(async (dir) => {
    const name = `real${ext}`;
    const target = path.join(dir, name);
    const source = fs.existsSync(`${picked}.bak`) ? `${picked}.bak` : picked;
    fs.copyFileSync(source, target);
    const original = fs.readFileSync(target);
    const originalHash = sha256(original);
    const originalAudio = audioHash(original, ext);
    const originalLyrics = readLyrics(target).text;
    const beforeMtime = fs.statSync(target).mtimeMs;
    const backup = backupFor(dir, ext === '.lrc' ? name : `${name}.lrc`);

    const reviewOnly = reviewDirectory({ directory: dir });
    assert.equal(reviewOnly.summary.filesScanned, 1);
    assert.equal(sha256File(target), originalHash, 'review is read-only');
    assert.equal(fs.statSync(target).mtimeMs, beforeMtime, 'review is read-only');
    assert.equal(reviewOnly.files[0].hasBackup, false);
    assert.deepEqual(reviewOnly.files[0].flags, ['noBackup']);

    if (reviewOnly.files[0].status === 'already-ok') {
      // This library file is already split: conversion has nothing to back up.
      const applied = convertDirectory({ directory: dir, apply: true });
      assert.equal(applied.files[0].status, 'already-ok');
      assert.equal(fs.existsSync(backup), false);
      return;
    }
    assert.equal(reviewOnly.files[0].status, 'would-change');

    const applied = convertDirectory({ directory: dir, apply: true });
    assert.equal(applied.files[0].status, 'changed');
    assert.equal(applied.files[0].backupKind, 'lrc');
    assert.ok(fs.existsSync(backup), 'the real file gets one LRC backup');
    assert.equal(fs.existsSync(`${target}.bak`), false, 'no full-file .bak');
    if (ext === '.lrc') {
      assert.equal(fs.readFileSync(backup, 'utf8'), originalLyrics);
    } else {
      assert.equal(fs.readFileSync(backup, 'utf8'), originalLyrics, 'audio backup holds the original lyrics');
      assert.equal(audioHash(fs.readFileSync(target), ext), originalAudio, 'real audio bytes unchanged');
    }

    const review = reviewDirectory({ directory: dir });
    assert.equal(review.summary.converted, 1);
    assert.equal(review.summary.filesWithLrcBackup, 1);
    assert.ok(review.summary.pairs > 0);

    const reverted = revertPath({ path: target, confirm: true });
    assert.equal(reverted.counts.restored, 1);
    assert.equal(reverted.restored[0].verified, true);
    assert.equal(reverted.restored[0].backupKind, 'lrc');
    if (ext === '.lrc') {
      assert.equal(sha256File(target), originalHash, 'LRC revert restores the real file byte for byte');
    } else {
      assert.equal(readLyrics(target).text, originalLyrics, 'real embedded lyrics restored from the LRC backup');
      assert.equal(audioHash(fs.readFileSync(target), ext), originalAudio, 'real audio bytes after revert');
    }
    assert.ok(fs.existsSync(backup), 'the LRC backup is kept');
  });
});
