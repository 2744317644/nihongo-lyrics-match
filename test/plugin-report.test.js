// Interactive HTML report tests: data aggregation, self-contained output,
// escaping, file writing, and the Host tool contract.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { convertDirectory } from '../lib/convert.js';
import {
  buildReviewReport,
  renderReviewReportHtml,
  writeReviewReport,
} from '../lib/report.js';
import { toolDefinitions } from '../lib/tools.js';
import { schemaViolations, valueViolations } from '../test-support/schema-contract.js';
import { withTempDir, writeFixture } from '../test-support/util.js';

const CLEAN = '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田\n';
const PROBLEM = [
  '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田',
  '[00:02.00]きれいな世界 美丽的世界',
  '',
].join('\n');
const NO_BACKUP = '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田\n';

/** @param {string} dir */
function prepareLibrary(dir) {
  writeFixture(dir, 'clean.lrc', Buffer.from(CLEAN, 'utf8'));
  writeFixture(dir, 'problem.lrc', Buffer.from(PROBLEM, 'utf8'));

  convertDirectory({ directory: dir, apply: true });
  // Manual edit: delete one split half so the review reports a broken pair.
  const problemPath = path.join(dir, 'problem.lrc');
  const current = fs.readFileSync(problemPath, 'utf8');
  fs.writeFileSync(problemPath, current.replace('[00:01.00]春雨后留下的空寂轻轻沾湿心田\n', ''), 'utf8');
  // Added after conversion: no backup exists for this file.
  writeFixture(dir, 'nobackup.lrc', Buffer.from(NO_BACKUP, 'utf8'));
}

/** @param {string} html */
function embeddedData(html) {
  const match = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/u);
  assert.ok(match, 'the report embeds its data');
  return JSON.parse(match[1]);
}

test('builds a report listing abnormal songs first with grouped lines', async () => {
  await withTempDir(async (dir) => {
    prepareLibrary(dir);
    const report = buildReviewReport({ directory: dir });

    assert.equal(report.schemaVersion, 1);
    assert.equal(report.summary.filesScanned, 3);
    assert.equal(report.files.length, 3);
    assert.equal(report.filesWithIssues, 1);
    assert.equal(report.backupRoot, path.join(dir, '.lyrics-backup'));
    assert.ok(report.linesTotal > 0);
    assert.ok(report.flaggedLines > 0);
    assert.equal(report.conversion.mode, 'derived');
    assert.equal(report.conversion.converted, 1, 'only the clean file is converted and unchanged');
    assert.equal(report.conversion.pending, 1, 'nobackup.lrc still needs conversion');
    assert.equal(report.conversion.manualEdits, 1);
    assert.equal(report.conversion.needsReview, 1);

    const clean = report.files.find((file) => file.name === 'clean.lrc');
    const problem = report.files.find((file) => file.name === 'problem.lrc');
    const noBackup = report.files.find((file) => file.name === 'nobackup.lrc');
    assert.equal(clean.abnormal, false);
    assert.equal(clean.flaggedLines, 0);
    assert.ok(problem.abnormal);
    assert.ok(problem.flaggedLines > 0);
    assert.ok(problem.lines.some((line) => line.flagged));
    assert.equal(noBackup.abnormal, false, 'a file with no content flags and no backup is not a review issue');
    assert.ok(noBackup.flags.includes('noBackup'));
    assert.equal(noBackup.hasBackup, false);

    // Abnormal files are sorted first; lines carry no redundant file path.
    assert.equal(report.files[0].abnormal, true);
    assert.equal(report.files[report.files.length - 1].abnormal, false);
    for (const line of problem.lines) {
      assert.equal(line.file, undefined);
    }
  });
});

test('renders one self-contained interactive HTML document', async () => {
  await withTempDir(async (dir) => {
    prepareLibrary(dir);
    const report = buildReviewReport({ directory: dir });
    const html = renderReviewReportHtml(report);
    const data = embeddedData(html);

    assert.match(html, /^<!doctype html>/iu);
    assert.match(html, /id="tab-converted"/u);
    assert.match(html, /id="tab-nochange"/u);
    assert.match(html, /id="tab-issues"/u);
    assert.match(html, /id="tab-all"/u);
    assert.match(html, /已转换/u);
    assert.match(html, /无需转换/u);
    assert.match(html, /其中需要复核/u);
    assert.match(html, /id="count-note"/u);
    assert.match(html, /id="song-list"/u);
    assert.match(html, /id="detail"/u);
    assert.match(html, /搜索歌曲/u);
    assert.equal(data.files.length, 3);
    assert.equal(data.filesWithIssues, 1);
    assert.equal(data.linesTotal, report.linesTotal);
    assert.equal(data.conversion.converted, 1);
    assert.doesNotMatch(html, /(?:src|href)\s*=\s*["']https?:/iu, 'no network assets');
    assert.doesNotMatch(html, /<link[^>]+href=/iu, 'no external stylesheet');
    assert.doesNotMatch(html, /@import/iu);
    assert.match(html, /--bg:/u, 'inline styles');

    const scriptStart = html.indexOf('<script>\n(function');
    assert.ok(scriptStart > 0, 'inline interactive script exists');
    const script = html.slice(scriptStart + '<script>'.length, html.lastIndexOf('</script>'));
    assert.doesNotThrow(() => new Function(script), 'inline script compiles');
  });
});

test('escapes lyric text so it cannot break out of the data script', () => {
  const report = {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    directory: 'C:\\Music',
    backupRoot: 'C:\\Music\\.lyrics-backup',
    summary: {
      filesScanned: 1,
      filesWithBackup: 1,
      filesWithLrcBackup: 1,
      filesWithLegacyBackup: 0,
      pairs: 1,
      flaggedPairs: 1,
      titleLines: 0,
      noBackup: 0,
      reasons: {},
      flags: {},
      fileFlags: {},
    },
    files: [{
      path: 'x.lrc',
      name: 'x.lrc',
      album: '',
      format: 'LRC (utf8)',
      status: 'converted',
      pairs: 1,
      flaggedPairs: 1,
      titleLines: 0,
      flagged: 1,
      hasBackup: true,
      backupKind: 'lrc',
      backup: '.lyrics-backup/x.lrc',
      flags: [],
      error: null,
      abnormal: true,
      flaggedLines: 1,
      linesTruncated: false,
      reasons: {},
      lineFlags: {},
      lines: [{
        timestamp: '[00:01.00]',
        original: 'a </script><script>alert(1)</script> b',
        jp: 'a',
        zh: '</script>',
        reason: 'standard',
        flags: ['shortTranslation'],
        flagged: true,
      }],
    }],
    filesWithIssues: 1,
    linesTotal: 1,
    flaggedLines: 1,
    filesOmitted: 0,
    linesTruncated: false,
  };
  const html = renderReviewReportHtml(report);
  assert.equal(html.includes('</script><script>alert(1)</script>'), false);
  const data = embeddedData(html);
  assert.equal(data.files[0].lines[0].original, report.files[0].lines[0].original);
  assert.equal(data.files[0].lines[0].zh, '</script>');
});

test('writes the report to a chosen path and the default library path', async () => {
  await withTempDir(async (dir) => {
    prepareLibrary(dir);
    const custom = writeReviewReport({ directory: dir, output: 'reports/review.html' });
    assert.equal(custom.ok, true);
    assert.equal(custom.path, path.join(dir, 'reports', 'review.html'));
    assert.ok(fs.existsSync(custom.path));
    assert.ok(fs.statSync(custom.path).size > 10_000);
    assert.equal(custom.filesScanned, 3);
    assert.equal(custom.filesWithIssues, 1);
    assert.equal(custom.issueFiles.length, 1);
    assert.ok(custom.flaggedLines > 0);

    const fallback = writeReviewReport({ directory: dir });
    assert.equal(fallback.path, path.join(dir, 'lyrics-review-report.html'));
    assert.ok(fs.existsSync(fallback.path));
  });
});

test('conversion data feeds the report and lyrics_convert writes it automatically', async () => {
  await withTempDir(async (dir) => {
    writeFixture(dir, 'a.lrc', Buffer.from(CLEAN, 'utf8'));
    writeFixture(dir, 'b.lrc', Buffer.from(PROBLEM, 'utf8'));
    const convert = toolDefinitions.find((definition) => definition.name === 'lyrics_convert');
    assert.ok(convert);

    const applied = await convert.execute({ directory: dir, apply: true }, {});
    assert.deepEqual(valueViolations(convert.output.schema, applied), []);
    assert.equal(applied.mode, 'apply');
    assert.equal(applied.report.ok, true);
    assert.equal(applied.report.path, path.join(dir, 'lyrics-review-report.html'));
    assert.equal(applied.report.converted, 2);
    assert.equal(applied.report.noChange, 0);
    assert.ok(fs.existsSync(applied.report.path));
    assert.match(convert.output.render({}, applied)[0].text, /HTML report:/u);

    const data = embeddedData(fs.readFileSync(applied.report.path, 'utf8'));
    assert.equal(data.conversion.mode, 'apply');
    assert.equal(data.conversion.converted, 2);
    assert.equal(data.conversion.pending, 0);
    assert.equal(data.files.filter((file) => file.conversionStatus === 'converted').length, 2);
    assert.ok(data.files.every((file) => Number.isInteger(file.conversionLinesChanged)));
    assert.ok(data.files.every((file) => file.conversionVerified === true));

    // report: false skips the file, and a converted library is no-change next run.
    const withoutReport = await convert.execute({ directory: dir, apply: true, report: false }, {});
    assert.equal(withoutReport.report, undefined);
    assert.equal(withoutReport.reportError, undefined);
    assert.equal(withoutReport.summary.alreadyOk, 2);
  });

  await withTempDir(async (dir) => {
    writeFixture(dir, 'song.lrc', Buffer.from(CLEAN, 'utf8'));
    const convert = toolDefinitions.find((definition) => definition.name === 'lyrics_convert');
    const preview = await convert.execute({ directory: dir, apply: false, report: true }, {});
    assert.equal(preview.mode, 'preview');
    assert.equal(preview.report.pending, 1);
    assert.equal(preview.report.converted, 0);
    const data = embeddedData(fs.readFileSync(preview.report.path, 'utf8'));
    assert.equal(data.conversion.mode, 'preview');
    assert.equal(data.conversion.pending, 1);
    assert.equal(data.conversion.converted, 0);
    assert.equal(data.files[0].conversionStatus, 'pending');
  });
});

test('Host tool lyrics_report validates its schema and returns a written report', async () => {
  await withTempDir(async (dir) => {
    prepareLibrary(dir);
    const tool = toolDefinitions.find((definition) => definition.name === 'lyrics_report');
    assert.ok(tool, 'lyrics_report is registered');
    assert.deepEqual(schemaViolations(tool.parameters, { objectRoot: true }), []);
    assert.deepEqual(schemaViolations(tool.output.schema, { objectRoot: true }), []);

    const value = await tool.execute({ directory: dir, output: 'out/report.html' }, {});
    assert.deepEqual(valueViolations(tool.output.schema, value), []);
    assert.equal(value.ok, true);
    assert.equal(value.path, path.join(dir, 'out', 'report.html'));
    assert.ok(fs.existsSync(value.path));
    const text = tool.output.render({}, value)[0].text;
    assert.match(text, /lyrics HTML review report/u);
    assert.match(text, /songs with issues 1/u);
    assert.match(text, /self-contained and read-only/u);
  });
});
