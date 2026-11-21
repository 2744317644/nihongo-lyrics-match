// Review-engine tests: per-line decisions, LRC-backup comparison, and flag heuristics.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { analyzeLyricsText, transformLyricsText } from '../lib/lrc.js';
import { REVIEW_FLAGS, reviewDirectory } from '../lib/review.js';
import { convertDirectory } from '../lib/convert.js';
import { withTempDir, writeFixture } from '../test-support/util.js';

let cliLrc = null;
try {
  cliLrc = await import('../src/lrc.js');
} catch {
  cliLrc = null;
}

const MERGED_SONG = [
  '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田',
  '[00:02.00]心做し (COVER版) - 鹿乃',
  '[00:03.00]きれいな世界 変',
  '[00:04.00]泪がこぼれた 眼泪流了下来',
  '[00:05.00]美しい歌 完',
  '[00:06.00]つくる間にみた 夏模様 是夏天的征兆',
  '[00:07.00]Calling Happy 生まれたてのBrand New Day Calling Happy 崭新的 Brand New Day',
  '',
].join('\n');

test('analyzeLyricsText returns the per-line split decision', () => {
  const analysis = analyzeLyricsText('[00:28.70]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田');
  assert.equal(analysis.decisions.length, 1);
  assert.deepEqual(
    {
      kind: analysis.decisions[0].kind,
      timeTags: analysis.decisions[0].timeTags,
      jp: analysis.decisions[0].jp,
      zh: analysis.decisions[0].zh,
      reason: analysis.decisions[0].reason,
    },
    {
      kind: 'split',
      timeTags: '[00:28.70]',
      jp: '春空に残る淋しさ そっと心を濡らした',
      zh: '春雨后留下的空寂轻轻沾湿心田',
      reason: 'standard',
    },
  );
  assert.equal(
    analysis.text,
    '[00:28.70]春空に残る淋しさ そっと心を濡らした\n[00:28.70]春雨后留下的空寂轻轻沾湿心田',
  );
});

test('analyzeLyricsText keeps a parenthetical translation repeat on the Chinese half', () => {
  const analysis = analyzeLyricsText('[01:51.77]ずっとそばで(ずっとそばで) 一直在身旁 （一直在身旁）');
  assert.equal(analysis.changed, 1);
  assert.equal(analysis.decisions[0].jp, 'ずっとそばで(ずっとそばで)');
  assert.equal(analysis.decisions[0].zh, '一直在身旁 （一直在身旁）');
  assert.equal(
    analysis.text,
    '[01:51.77]ずっとそばで(ずっとそばで)\n[01:51.77]一直在身旁 （一直在身旁）',
  );
});

test('analyzeLyricsText strips a slash-delimited Chinese translation', () => {
  const analysis = analyzeLyricsText('[00:16.00]楽しみだけれど ちょっと怖いけれど /一份期待夹杂着些许恐惧');
  assert.equal(analysis.changed, 1);
  assert.equal(analysis.decisions[0].reason, 'standard');
  assert.equal(analysis.decisions[0].jp, '楽しみだけれど ちょっと怖いけれど');
  assert.equal(analysis.decisions[0].zh, '一份期待夹杂着些许恐惧');
  assert.equal(
    analysis.text,
    '[00:16.00]楽しみだけれど ちょっと怖いけれど\n[00:16.00]一份期待夹杂着些许恐惧',
  );
});

test('analyzeLyricsText splits a lenticular-bracket translation before the opener', () => {
  const analysis = analyzeLyricsText(
    '[00:01.00]見たでしよ？ イタズラで聞く 赤くなった 〖看到了吗？ 恶作剧地问著 你却红了脸〗',
  );
  assert.equal(analysis.changed, 1);
  assert.equal(analysis.decisions[0].reason, 'standard');
  assert.equal(analysis.decisions[0].jp, '見たでしよ？ イタズラで聞く 赤くなった');
  assert.equal(analysis.decisions[0].zh, '〖看到了吗？ 恶作剧地问著 你却红了脸〗');
  assert.equal(
    analysis.text,
    '[00:01.00]見たでしよ？ イタズラで聞く 赤くなった\n[00:01.00]〖看到了吗？ 恶作剧地问著 你却红了脸〗',
  );

  const thin = analyzeLyricsText('[00:02.00]ようやくわかりました 〖\u2009我終於明白了〗');
  assert.equal(thin.decisions[0].jp, 'ようやくわかりました');
  assert.equal(thin.decisions[0].zh, '〖\u2009我終於明白了〗');
});

test('analyzeLyricsText classifies already-paired, title, meta and kept lines', () => {
  const paired = analyzeLyricsText([
    '[00:01.00]春空に残る淋しさ',
    '[00:01.00]春雨后留下的空寂',
  ].join('\n'));
  assert.equal(paired.changed, 0);
  assert.equal(paired.decisions[0].kind, 'already-paired');

  const title = analyzeLyricsText('[00:00.00]なんでもないや 没什么大不了的 - Akie秋绘');
  assert.equal(title.decisions[0].kind, 'title');
  assert.equal(title.changed, 0);

  const meta = analyzeLyricsText('[00:10.00]作词 : Someone');
  assert.equal(meta.decisions[0].kind, 'meta');

  const kept = analyzeLyricsText('[00:11.00]ああ 今日は いい天気 今日はいい天気だね');
  assert.equal(kept.decisions[0].kind, 'kept');
  assert.equal(kept.changed, 0);
});

test('every split reason is recorded on the decision', () => {
  const cases = [
    ['standard', '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田'],
    ['te-form-shift', '[00:01.00]小さな勇気 ポケットにつめて 深呼吸 将小小的勇气装进口袋 深呼吸'],
    ['ratio-fallback', '[00:02.12](シュビデュバ　シュビデュバ　ココロは　Merry-Go-Round Syubidyuba Syubidyuba 心情就像 旋转木马'],
    ['ratio-fallback', '[00:47.52]ファッションチェック、完了☆ Fashion check 完毕☆'],
    ['latin-start', '[00:01.00]Rainy…　そんな日は　靴音鳴らし Dancing！ rainy！即使是那样的天气'],
    // Real line from 水瀬いのり「Catch the Rainbow!」 (reason: latin-after-punct).
    ['latin-after-punct', '[02:24.00]Rainy…　そんな日は　靴音鳴らし Dancing！ rainy！即使是那样的天气  也要用鞋子踩出一段旋律 dancing！'],
    ['latin-repeat', '[00:01.00]Calling Happy 生まれたてのBrand New Day Calling Happy 崭新的 Brand New Day'],
    ['no-kana', '[00:01.00]変 (Good!) 身！！ (Cute!) 变 (Good!) 身！！ (Cute!)'],
    ['jp-only-residual', '[00:01.00]つくる間にみた 夏模様 是夏天的征兆'],
  ];
  for (const [reason, line] of cases) {
    const analysis = analyzeLyricsText(line);
    assert.equal(analysis.decisions[0].reason, reason, `reason for ${line}`);
    assert.equal(analysis.notes[reason], 1);
    assert.ok(analysis.decisions[0].jp.length > 0);
    assert.ok(analysis.decisions[0].zh.length > 0);
  }
});

test('vendored splitter output matches the CLI implementation', (t) => {
  if (!cliLrc) return t.skip('CLI source not available next to the bundle');
  const corpus = [
    MERGED_SONG,
    '[00:01.00]Rainy…　そんな日は　靴音鳴らし Dancing！ rainy！即使是那样的天气\n',
    '[00:01.00]変 (Good!) 身！！ (Cute!) 变 (Good!) 身！！ (Cute!)\n',
    '[00:01.00]春空に残る淋しさ\n[00:01.00]春雨后留下的空寂\n',
    'no timed lines at all\n[ti:title]\n',
  ];
  for (const text of corpus) {
    assert.deepEqual(transformLyricsText(text), cliLrc.transformLyricsText(text));
  }
});

test('review reports flagged pairs, title lines and histograms', async () => {
  await withTempDir(async (dir) => {
    writeFixture(dir, 'song.lrc', Buffer.from(MERGED_SONG, 'utf8'));
    const preview = convertDirectory({ directory: dir });
    assert.equal(preview.summary.scanned, 1);
    assert.equal(preview.files[0].status, 'would-change');
    assert.equal(preview.files[0].linesChanged, 6);

    const applied = convertDirectory({ directory: dir, apply: true });
    assert.equal(applied.files[0].status, 'changed');
    assert.equal(applied.summary.backupsCreated, 1);
    assert.ok(fs.existsSync(path.join(dir, '.lyrics-backup', 'song.lrc')));
    assert.equal(fs.existsSync(path.join(dir, 'song.lrc.bak')), false);

    const review = reviewDirectory({ directory: dir });
    assert.equal(review.summary.filesScanned, 1);
    assert.equal(review.summary.filesWithBackup, 1);
    assert.equal(review.summary.converted, 1);
    assert.equal(review.summary.pairs, 6);
    assert.equal(review.summary.flaggedPairs, 5);
    assert.equal(review.summary.titleLines, 1);
    assert.deepEqual(review.summary.reasons, {
      standard: 4,
      'jp-only-residual': 1,
      'latin-repeat': 1,
    });
    assert.deepEqual(review.summary.flags, {
      shortTranslation: 2,
      jpHasChineseOnly: 1,
      zhHasJapaneseOnly: 1,
      titleLine: 1,
    });
    assert.equal(review.summary.converted, 1);
    assert.equal(review.summary.filesWithLrcBackup, 1);
    assert.equal(review.summary.filesWithLegacyBackup, 0);
    assert.equal(review.summary.backupRoot, path.join(dir, '.lyrics-backup'));
    assert.equal(review.files[0].backupKind, 'lrc');
    assert.equal(review.files[0].status, 'converted');
    assert.equal(review.files[0].pairs, 6);
    assert.equal(review.files[0].flagged, 6);
    assert.deepEqual(review.files[0].flags, []);

    const lines = review.lines;
    const byTimestamp = new Map(lines.map((line) => [line.timestamp, line]));
    assert.deepEqual(byTimestamp.get('[00:03.00]').flags, ['zhHasJapaneseOnly', 'shortTranslation']);
    assert.deepEqual(byTimestamp.get('[00:04.00]').flags, ['jpHasChineseOnly']);
    assert.deepEqual(byTimestamp.get('[00:05.00]').flags, ['shortTranslation']);
    // A non-standard split reason is flagged even when no named flag applies.
    assert.equal(byTimestamp.get('[00:06.00]').flagged, true);
    assert.deepEqual(byTimestamp.get('[00:06.00]').flags, []);
    const titleLine = lines.find((line) => line.reason === 'title-line');
    assert.equal(titleLine.original, '心做し (COVER版) - 鹿乃');
    assert.equal(titleLine.zh, '');
    assert.deepEqual(titleLine.flags, ['titleLine']);
    // The clean pair is absent from the default flagged view.
    assert.equal(lines.some((line) => line.timestamp === '[00:01.00]'), false);

    const all = reviewDirectory({ directory: dir, filter: 'all', limit: 1000 });
    assert.equal(all.linesMatched, 7);
    const cleanPair = all.lines.find((line) => line.timestamp === '[00:01.00]');
    assert.equal(cleanPair.flagged, false);
    assert.equal(all.summary.flags.titleLine, 1);

    // A file filter narrows without touching the summary.
    const narrowed = reviewDirectory({ directory: dir, file: 'song.lrc' });
    assert.equal(narrowed.files.length, 1);
    assert.equal(narrowed.summary.filesScanned, 1);
  });
});

test('review flags manual edits, missing pairs, timestamp mismatches and mojibake', async () => {
  await withTempDir(async (dir) => {
    writeFixture(dir, 'song.lrc', Buffer.from(MERGED_SONG, 'utf8'));
    convertDirectory({ directory: dir, apply: true });

    const current = fs.readFileSync(path.join(dir, 'song.lrc'), 'utf8')
      .replace('[00:03.00]変\n', '') // delete one half of a pair
      .replace('[00:04.00]眼泪流了下来', '[00:09.00]眼泪流了下来'); // move the other half
    fs.writeFileSync(path.join(dir, 'song.lrc'), current, 'utf8');

    const review = reviewDirectory({ directory: dir, filter: 'all', limit: 100 });
    assert.equal(review.files[0].status, 'manual-edit');
    assert.deepEqual(review.files[0].flags, ['timestampMismatch', 'manualEdit']);

    const byTimestamp = new Map(review.lines.map((line) => [line.timestamp, line]));
    const missing = byTimestamp.get('[00:03.00]');
    assert.ok(missing.flags.includes('manualEdit'));
    assert.ok(missing.flags.includes('missingPair'));
    const moved = byTimestamp.get('[00:04.00]');
    assert.ok(moved.flags.includes('manualEdit'));
    assert.ok(moved.flags.includes('timestampMismatch'));
    assert.equal(review.summary.manualEdits, 1);

    // Break the timestamp sequence and re-convert the expected text.
    const mergedAgain = fs.readFileSync(path.join(dir, '.lyrics-backup', 'song.lrc'), 'utf8');
    const brokenText = transformLyricsText(mergedAgain).text
      .replaceAll('[00:05.00]美しい歌', '[00:00.50]美しい歌')
      .replaceAll('[00:05.00]完', '[00:00.50]完');
    fs.writeFileSync(path.join(dir, 'song.lrc'), brokenText, 'utf8');
    const broken = reviewDirectory({ directory: dir, filter: 'flagged', limit: 100 });
    assert.ok(broken.summary.fileFlags.timestampMismatch >= 1);
    const shifted = broken.lines.find((line) => line.timestamp === '[00:05.00]');
    assert.ok(shifted.flags.includes('timestampMismatch'));

    // Mojibake in the backup is surfaced instead of failing the read.
    const mojibakeBak = MERGED_SONG.replace('春雨后留下的空寂轻轻沾湿心田', '春雨后留下的空寂轻轻沾湿心\uFFFD');
    writeFixture(dir, path.join('.lyrics-backup', 'broken.lrc'), Buffer.from(mojibakeBak, 'utf8'));
    fs.writeFileSync(path.join(dir, 'broken.lrc'), transformLyricsText(mojibakeBak).text, 'utf8');
    const withMojibake = reviewDirectory({ directory: dir, file: 'broken.lrc', filter: 'all' });
    assert.equal(withMojibake.files[0].backupKind, 'lrc');
    assert.deepEqual(withMojibake.files[0].flags, ['mojibake']);
    assert.ok(withMojibake.summary.flags.mojibake >= 1);
    assert.ok(withMojibake.lines.some((line) => line.flags.includes('mojibake')));

    // Legacy full-file .bak backups remain readable in review.
    writeFixture(dir, 'legacy.lrc', Buffer.from(transformLyricsText(mojibakeBak).text, 'utf8'));
    writeFixture(dir, 'legacy.lrc.bak', Buffer.from(mojibakeBak, 'utf8'));
    const legacy = reviewDirectory({ directory: dir, file: 'legacy.lrc', filter: 'all' });
    assert.equal(legacy.files[0].backupKind, 'legacy');
    assert.deepEqual(legacy.files[0].flags, ['mojibake']);
  });
});

test('review handles no-lyrics files and files without a backup', async () => {
  await withTempDir(async (dir) => {
    const { buildFlac } = await import('../test-support/fixtures.js');
    writeFixture(dir, 'instrumental.flac', buildFlac({ usltText: 'unused', lyricsKey: null }));
    writeFixture(dir, 'clean.lrc', Buffer.from([
      '[00:01.00]春空に残る淋しさ',
      '[00:01.00]春雨后留下的空寂',
      '',
    ].join('\n'), 'utf8'));

    const review = reviewDirectory({ directory: dir, filter: 'flagged', limit: 100 });
    assert.equal(review.summary.filesScanned, 2);
    assert.equal(review.summary.filesWithBackup, 0);
    assert.equal(review.summary.noLyrics, 1);
    assert.equal(review.summary.alreadyOk, 1);
    assert.equal(review.summary.pairs, 0);

    const instrumental = review.files.find((file) => file.path === 'instrumental.flac');
    assert.equal(instrumental.status, 'no-lyrics');
    assert.deepEqual(instrumental.flags, ['noLyrics']);

    const clean = review.files.find((file) => file.path === 'clean.lrc');
    assert.equal(clean.status, 'already-ok');
    assert.deepEqual(clean.flags, ['noBackup']);
    assert.deepEqual(review.summary.fileFlags, { noBackup: 1, noLyrics: 1 });
    assert.equal(review.lines.length, 0);

    const all = reviewDirectory({ directory: dir, filter: 'all' });
    assert.equal(all.files.length, 2);
  });
});

test('review output is bounded and says how to narrow', async () => {
  await withTempDir(async (dir) => {
    writeFixture(dir, 'song.lrc', Buffer.from(MERGED_SONG, 'utf8'));
    convertDirectory({ directory: dir, apply: true });
    const review = reviewDirectory({ directory: dir, filter: 'all', limit: 3 });
    assert.equal(review.linesMatched, 7);
    assert.equal(review.linesReturned, 3);
    assert.equal(review.lines.length, 3);
    assert.equal(review.truncated, true);
    assert.match(review.hint, /narrow with file|raise limit/);
  });
});

test('review flag vocabulary is exactly the documented set', () => {
  assert.deepEqual(REVIEW_FLAGS, [
    'jpHasChineseOnly',
    'zhHasJapaneseOnly',
    'shortTranslation',
    'missingPair',
    'timestampMismatch',
    'titleLine',
    'manualEdit',
    'noBackup',
    'noLyrics',
    'mojibake',
  ]);
});

test('review rejects paths that escape the directory', async () => {
  await withTempDir(async (dir) => {
    writeFixture(dir, 'song.lrc', Buffer.from(MERGED_SONG, 'utf8'));
    assert.throws(() => reviewDirectory({ directory: dir, file: '../outside.lrc' }), /does not exist|inside the directory/);
    assert.throws(() => reviewDirectory({ directory: path.join(dir, 'missing') }), /does not exist/);
  });
});
