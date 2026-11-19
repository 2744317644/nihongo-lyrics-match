import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { main } from '../src/cli.js';
import { loadLyricsFile } from '../src/formats.js';
import { parseFlac } from '../src/flac.js';
import { parseWav } from '../src/wav.js';
import { buildFlac, buildMp3, buildWav } from './helpers.js';

const MERGED =
  '[00:00.00]作词 : Someone\r\n' +
  '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田\r\n';

function readReport(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('applies to LRC, WAV, MP3 and FLAC, makes backups, then skips them on rerun', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-split-'));
  const lrcPath = path.join(directory, 'song.lrc');
  const wavPath = path.join(directory, 'song.wav');
  const mp3Path = path.join(directory, 'song.mp3');
  const flacPath = path.join(directory, 'song.flac');
  const originalWav = buildWav({ usltText: MERGED });
  const originalMp3 = buildMp3({ usltText: MERGED });
  const originalFlac = buildFlac({ usltText: MERGED });

  try {
    fs.writeFileSync(lrcPath, MERGED, 'utf8');
    fs.writeFileSync(wavPath, originalWav);
    fs.writeFileSync(mp3Path, originalMp3);
    fs.writeFileSync(flacPath, originalFlac);

    const reportPath = path.join(directory, 'report.json');
    assert.equal(
      main([directory, '--apply', '--quiet', '--json', reportPath]),
      0,
    );

    const report = readReport(reportPath);
    assert.equal(report.summary.changed, 4);
    assert.equal(report.files.length, 4);
    assert.equal(report.summary.backupsCreated, 4);
    assert.equal(report.summary.backupsReused, 0);
    for (const file of report.files) {
      assert.equal(file.status, 'changed');
      assert.equal(file.linesChanged, 1);
      assert.equal(file.backupKind, 'lrc');
      assert.ok(file.backup.includes('.lyrics-backup'));
      assert.ok(file.backup.endsWith('.lrc'));
    }

    // LRC backups hold the original merged lyrics under the mirrored hierarchy.
    const backupRoot = path.join(directory, '.lyrics-backup');
    assert.equal(fs.readFileSync(path.join(backupRoot, 'song.lrc'), 'utf8'), MERGED);
    assert.equal(fs.readFileSync(path.join(backupRoot, 'song.wav.lrc'), 'utf8'), MERGED);
    assert.equal(fs.readFileSync(path.join(backupRoot, 'song.mp3.lrc'), 'utf8'), MERGED);
    assert.equal(fs.readFileSync(path.join(backupRoot, 'song.flac.lrc'), 'utf8'), MERGED);
    assert.ok(!fs.existsSync(`${wavPath}.bak`));
    assert.ok(!fs.existsSync(`${lrcPath}.bak`));

    // LRC text was split with the same timestamps.
    assert.equal(
      fs.readFileSync(lrcPath, 'utf8'),
      '[00:00.00]作词 : Someone\r\n' +
        '[00:01.00]春空に残る淋しさ そっと心を濡らした\r\n' +
        '[00:01.00]春雨后留下的空寂轻轻沾湿心田\r\n',
    );

    // Embedded lyrics were replaced.
    const expectedLyrics = fs.readFileSync(lrcPath, 'utf8');
    assert.equal(loadLyricsFile(wavPath).text, expectedLyrics);
    assert.equal(loadLyricsFile(mp3Path).text, expectedLyrics);
    assert.equal(loadLyricsFile(flacPath).text, expectedLyrics);

    // Audio payload of the WAV is untouched.
    const before = parseWav(originalWav);
    const after = parseWav(fs.readFileSync(wavPath));
    const dataBefore = before.chunks.find((c) => c.id === 'data');
    const dataAfter = after.chunks.find((c) => c.id === 'data');
    assert.ok(
      originalWav
        .subarray(dataBefore.dataStart, dataBefore.dataEnd)
        .equals(fs.readFileSync(wavPath).subarray(dataAfter.dataStart, dataAfter.dataEnd)),
    );

    // Audio frames of the FLAC are untouched.
    const flacBefore = parseFlac(originalFlac);
    const flacAfter = parseFlac(fs.readFileSync(flacPath));
    assert.ok(
      originalFlac
        .subarray(flacBefore.audioOffset)
        .equals(fs.readFileSync(flacPath).subarray(flacAfter.audioOffset)),
    );

    // Second run is a no-op.
    const rerunReport = path.join(directory, 'report2.json');
    assert.equal(main([directory, '--quiet', '--json', rerunReport]), 0);
    const rerun = readReport(rerunReport);
    assert.equal(rerun.summary.changed, 0);
    assert.equal(rerun.summary.alreadyOk, 4);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('preview mode never writes or creates backups', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-split-'));
  const lrcPath = path.join(directory, 'song.lrc');

  try {
    fs.writeFileSync(lrcPath, MERGED, 'utf8');
    const reportPath = path.join(directory, 'report.json');
    assert.equal(main([directory, '--quiet', '--json', reportPath]), 0);

    const report = readReport(reportPath);
    assert.equal(report.summary.changed, 1);
    assert.equal(report.files[0].status, 'would-change');
    assert.equal(fs.readFileSync(lrcPath, 'utf8'), MERGED);
    assert.ok(!fs.existsSync(path.join(directory, '.lyrics-backup')));
    assert.ok(!fs.existsSync(`${lrcPath}.bak`));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
