// Self-contained interactive HTML review report.
//
// The report is a single file with embedded data, CSS, and JavaScript. It lists
// the songs that need a look first; selecting a song shows its flagged lines
// with timestamps, both lyric halves, the split reason, and flags. It is
// read-only and needs no server, network, or browser plugin.

import fs from 'node:fs';
import path from 'node:path';

import { reviewDirectory } from './review.js';
import { resolveDirectory } from './scan.js';
import { writeFileAtomic } from './fileops.js';

const SCHEMA_VERSION = 1;
const PER_FILE_LINE_LIMIT = 1000;
const DEFAULT_REPORT_NAME = 'lyrics-review-report.html';

const CONVERSION_STATUS = {
  changed: 'converted',
  converted: 'converted',
  'already-ok': 'no-change',
  'would-change': 'pending',
  'skipped-no-translation': 'skipped',
  'no-lyrics': 'no-lyrics',
  error: 'error',
  'manual-edit': 'manual-edit',
};

// These flags describe a missing input/backup, not a content problem to review.
// A file that needed no conversion legitimately has no backup, and a no-lyrics
// file has nothing to review; neither belongs in the "needs review" count.
const INFORMATIONAL_FLAGS = new Set(['noBackup', 'noLyrics']);

/** @param {string} status */
function normalizeConversionStatus(status) {
  return CONVERSION_STATUS[status] || 'unknown';
}

/**
 * @param {unknown} value
 * @returns {string} JSON safe to place inside an HTML <script> element
 */
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** @param {string[]} values */
function histogram(values) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

/** @param {object} line */
function compactLine(line) {
  return {
    timestamp: line.timestamp,
    original: line.original,
    jp: line.jp,
    zh: line.zh,
    reason: line.reason,
    flags: line.flags,
    flagged: line.flagged,
  };
}

/**
 * Collect the complete review baseline for a directory.
 * @param {{ directory: string, signal?: AbortSignal, conversion?: object }} options
 */
export function buildReviewReport(options) {
  const directory = resolveDirectory(options.directory);
  const overview = reviewDirectory({
    directory,
    filter: 'all',
    limit: 1,
    signal: options.signal,
  });
  const conversionFiles = options.conversion && Array.isArray(options.conversion.files)
    ? new Map(options.conversion.files.map((file) => [file.path, file]))
    : null;

  const files = [];
  for (const entry of overview.files) {
    if (options.signal && options.signal.aborted) throw new Error('the lyrics report was cancelled');
    let lines = [];
    let linesTruncated = false;

    // A no-lyrics or unreadable file has no split decisions; its file-level
    // flags still appear in the report.
    if (entry.status !== 'no-lyrics' && entry.status !== 'error') {
      const detail = reviewDirectory({
        directory,
        file: entry.path,
        filter: 'all',
        limit: PER_FILE_LINE_LIMIT,
        signal: options.signal,
      });
      lines = detail.lines.map(compactLine);
      linesTruncated = detail.truncated;
    }

    const flaggedLines = lines.filter((line) => line.flagged).length;
    const reasons = histogram(lines.map((line) => line.reason));
    const lineFlags = histogram(lines.flatMap((line) => line.flags));
    const contentFlags = entry.flags.filter((flag) => !INFORMATIONAL_FLAGS.has(flag));
    const abnormal = entry.flagged > 0 || contentFlags.length > 0 || entry.status === 'error';
    const relativeDirectory = path.posix.dirname(entry.path);
    const conversionFile = conversionFiles ? conversionFiles.get(entry.path) : null;
    files.push({
      path: entry.path,
      name: path.posix.basename(entry.path),
      album: relativeDirectory === '.' ? '' : relativeDirectory,
      format: entry.format,
      status: entry.status,
      pairs: entry.pairs,
      flaggedPairs: entry.flaggedPairs,
      titleLines: entry.titleLines,
      flagged: entry.flagged,
      hasBackup: entry.hasBackup,
      backupKind: entry.backupKind,
      backup: entry.backup,
      flags: entry.flags,
      error: entry.error,
      abnormal,
      flaggedLines,
      lines,
      linesTruncated,
      reasons,
      lineFlags,
      conversionStatus: normalizeConversionStatus(conversionFile ? conversionFile.status : entry.status),
      conversionRawStatus: conversionFile ? conversionFile.status : entry.status,
      conversionLinesChanged: conversionFile && Number.isInteger(conversionFile.linesChanged)
        ? conversionFile.linesChanged
        : null,
      conversionVerified: conversionFile && conversionFile.verified === true ? true : null,
      conversionBackup: conversionFile && conversionFile.backup ? conversionFile.backup : null,
      conversionError: conversionFile && conversionFile.error ? conversionFile.error : null,
    });
  }

  files.sort((left, right) => {
    if (left.abnormal !== right.abnormal) return left.abnormal ? -1 : 1;
    if (left.flagged !== right.flagged) return right.flagged - left.flagged;
    return left.path.localeCompare(right.path);
  });

  const filesWithIssues = files.filter((file) => file.abnormal).length;
  const fallbackCounts = {
    converted: files.filter((file) => file.conversionStatus === 'converted').length,
    noChange: files.filter((file) => file.conversionStatus === 'no-change').length,
    pending: files.filter((file) => file.conversionStatus === 'pending').length,
    skipped: files.filter((file) => file.conversionStatus === 'skipped').length,
    noLyrics: files.filter((file) => file.conversionStatus === 'no-lyrics').length,
    errors: files.filter((file) => file.conversionStatus === 'error').length,
    manualEdits: files.filter((file) => file.conversionStatus === 'manual-edit').length,
  };
  const conversionSummary = options.conversion && options.conversion.summary
    ? options.conversion.summary
    : null;
  const previewMode = Boolean(conversionSummary && conversionSummary.mode === 'preview');
  const conversion = {
    mode: options.conversion
      ? (conversionSummary && conversionSummary.mode ? conversionSummary.mode : 'apply')
      : 'derived',
    filesScanned: overview.summary.filesScanned,
    converted: conversionSummary && !previewMode && Number.isInteger(conversionSummary.changed)
      ? conversionSummary.changed
      : fallbackCounts.converted,
    noChange: conversionSummary && Number.isInteger(conversionSummary.alreadyOk)
      ? conversionSummary.alreadyOk
      : fallbackCounts.noChange,
    needsReview: filesWithIssues,
    pending: previewMode && Number.isInteger(conversionSummary.changed)
      ? conversionSummary.changed
      : fallbackCounts.pending,
    skipped: conversionSummary && Number.isInteger(conversionSummary.skippedNoTranslation)
      ? conversionSummary.skippedNoTranslation
      : fallbackCounts.skipped,
    noLyrics: conversionSummary && Number.isInteger(conversionSummary.noLyrics)
      ? conversionSummary.noLyrics
      : fallbackCounts.noLyrics,
    errors: conversionSummary && Number.isInteger(conversionSummary.errors)
      ? conversionSummary.errors
      : fallbackCounts.errors,
    manualEdits: fallbackCounts.manualEdits,
    linesChanged: conversionSummary && Number.isInteger(conversionSummary.linesChanged)
      ? conversionSummary.linesChanged
      : null,
    backupRoot: overview.summary.backupRoot,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    directory,
    backupRoot: overview.summary.backupRoot,
    backupBase: overview.summary.backupBase,
    summary: overview.summary,
    conversion,
    files,
    filesWithIssues,
    linesTotal: files.reduce((total, file) => total + file.lines.length, 0),
    flaggedLines: files.reduce((total, file) => total + file.flaggedLines, 0),
    filesOmitted: overview.filesOmitted || 0,
    linesTruncated: files.some((file) => file.linesTruncated),
  };
}

/** @param {object} report */
function renderHtml(report) {
  const data = jsonForScript(report);
  const title = `歌词转换与复核报告 · ${path.basename(report.directory) || report.directory}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f4f6f9;
  --panel: #ffffff;
  --panel-2: #f8fafc;
  --text: #1c2430;
  --muted: #667085;
  --faint: #98a2b3;
  --line: #e4e7ec;
  --line-strong: #d0d5dd;
  --accent: #3b5bdb;
  --accent-soft: #edf1ff;
  --warn: #b54708;
  --warn-soft: #fff4e8;
  --danger: #b42318;
  --danger-soft: #fef0ef;
  --ok: #067647;
  --ok-soft: #ecfdf3;
  --shadow: 0 1px 2px rgba(16, 24, 40, .05), 0 8px 24px rgba(16, 24, 40, .06);
  --radius: 14px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1216;
    --panel: #171b21;
    --panel-2: #1c2128;
    --text: #e6e9ee;
    --muted: #9aa4b2;
    --faint: #6b7480;
    --line: #282f38;
    --line-strong: #38414d;
    --accent: #8ea6ff;
    --accent-soft: #1d2748;
    --warn: #f5b26b;
    --warn-soft: #332313;
    --danger: #ff9a92;
    --danger-soft: #351b1a;
    --ok: #7ee2b0;
    --ok-soft: #12281d;
    --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 12px 32px rgba(0, 0, 0, .25);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font: 14px/1.55 "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
.wrap { max-width: 1440px; margin: 0 auto; padding: 22px 22px 40px; }
.hero { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px; align-items: flex-end; margin-bottom: 16px; }
.hero h1 { margin: 0 0 4px; font-size: 24px; line-height: 1.25; letter-spacing: -.02em; }
.hero .path { margin: 0; color: var(--muted); font-size: 12px; word-break: break-all; }
.hero .meta { margin: 4px 0 0; color: var(--faint); font-size: 12px; }
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line-strong); font-size: 11px; line-height: 18px; color: var(--muted); white-space: nowrap; }
.badge.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: var(--warn-soft); }
.badge.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, transparent); background: var(--danger-soft); }
.badge.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); background: var(--ok-soft); }
.badge.info { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); background: var(--accent-soft); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; margin-bottom: 16px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; box-shadow: var(--shadow); }
.card .value { font-size: 22px; line-height: 30px; font-weight: 600; font-variant-numeric: tabular-nums; }
.card .label { color: var(--muted); font-size: 12px; }
.card.hot .value { color: var(--warn); }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
.tabs { display: inline-flex; padding: 3px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
.tabs button { border: 0; background: transparent; padding: 6px 12px; border-radius: 7px; color: var(--muted); font-size: 13px; }
.tabs button.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.search { flex: 1 1 260px; min-width: 200px; height: 36px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); color: var(--text); outline: none; }
.search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.select { height: 36px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); color: var(--text); }
.btn { height: 36px; padding: 0 13px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); color: var(--text); font-size: 13px; }
.btn:hover { background: var(--panel-2); }
.btn:focus-visible, .tabs button:focus-visible, .song:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 2px; }
.app { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 16px; align-items: start; }
.songs { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; position: sticky; top: 16px; max-height: calc(100vh - 32px); display: flex; flex-direction: column; }
.songs-head { padding: 10px 14px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; display: flex; justify-content: space-between; gap: 8px; }
.song-list { overflow: auto; padding: 6px; }
.song { display: block; width: 100%; text-align: left; border: 1px solid transparent; border-radius: 10px; background: transparent; padding: 9px 10px; margin: 2px 0; }
.song:hover { background: var(--panel-2); }
.song.active { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
.song .title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.song .name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.song .album { color: var(--faint); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.song .counts { display: flex; gap: 6px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
.song .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); flex: none; }
.song.issue .dot { background: var(--warn); }
.song.clean .dot { background: var(--ok); }
.song.issue .name::after { content: ""; }
.detail { min-width: 0; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
.detail-head { padding: 16px 18px; border-bottom: 1px solid var(--line); }
.detail-head h2 { margin: 0; font-size: 18px; line-height: 1.35; word-break: break-word; }
.detail-path { margin: 4px 0 0; color: var(--muted); font-size: 12px; word-break: break-all; }
.detail-meta { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin-top: 10px; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
.backup { margin: 10px 0 0; color: var(--muted); font-size: 12px; word-break: break-all; }
.backup strong { color: var(--text); font-weight: 600; }
.lines { padding: 14px 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.line { border: 1px solid var(--line); border-left: 3px solid transparent; border-radius: 12px; padding: 10px 12px; background: var(--panel); }
.line.flagged { border-left-color: var(--warn); background: color-mix(in srgb, var(--warn-soft) 55%, var(--panel)); }
.line.clean { opacity: .75; }
.line-head { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; }
.time { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--muted); font-size: 12px; }
.reason { font-size: 12px; color: var(--muted); }
.reason.nonstandard { color: var(--warn); font-weight: 600; }
.flags { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.flag { display: inline-flex; align-items: center; padding: 0 7px; height: 20px; border-radius: 999px; background: var(--danger-soft); color: var(--danger); font-size: 11px; }
.flag.muted { background: var(--panel-2); color: var(--muted); }
.jp { margin-top: 4px; font-size: 15px; line-height: 1.6; word-break: break-word; }
.zh { margin-top: 1px; color: var(--muted); font-size: 14px; line-height: 1.6; word-break: break-word; }
.orig { margin-top: 6px; color: var(--faint); font-size: 12px; line-height: 1.5; word-break: break-word; }
.empty { padding: 28px 18px; color: var(--muted); text-align: center; }
.empty strong { display: block; color: var(--text); margin-bottom: 4px; }
.note { color: var(--muted); font-size: 12px; }
.count-note { margin: -6px 0 16px; color: var(--muted); font-size: 12px; line-height: 1.6; }
.footer { margin-top: 22px; color: var(--faint); font-size: 12px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
@media (max-width: 900px) {
  .wrap { padding: 14px; }
  .app { grid-template-columns: 1fr; }
  .songs { position: static; max-height: 330px; }
}
@media print {
  body { background: #fff; color: #000; }
  .toolbar, .songs, .footer { display: none; }
  .wrap { max-width: none; padding: 0; }
  .detail { border: 0; box-shadow: none; }
  .line, .card { break-inside: avoid; }
}
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div>
      <h1>歌词转换与复核报告</h1>
      <p class="path" id="hero-path"></p>
      <p class="meta" id="hero-meta"></p>
    </div>
    <div id="hero-badges" class="flags"></div>
  </header>

  <section class="cards" id="cards" aria-label="汇总"></section>
  <p class="count-note" id="count-note"></p>

  <div class="toolbar">
    <div class="tabs" role="tablist" aria-label="歌曲范围">
      <button id="tab-converted" role="tab" aria-selected="false" type="button"></button>
      <button id="tab-unconverted" role="tab" aria-selected="false" type="button"></button>
      <button id="tab-issues" class="active" role="tab" aria-selected="true" type="button"></button>
      <button id="tab-all" role="tab" aria-selected="false" type="button"></button>
    </div>
    <input id="search" class="search" type="search" placeholder="搜索歌曲、歌词、拆分原因或标记…" aria-label="搜索">
    <select id="flag-filter" class="select" aria-label="按标记筛选"></select>
    <button id="toggle-lines" class="btn" type="button">显示该歌全部行</button>
  </div>

  <main class="app">
    <aside class="songs" aria-label="歌曲列表">
      <div class="songs-head"><span id="song-count"></span><span id="song-hint" class="note"></span></div>
      <div class="song-list" id="song-list" role="listbox" aria-label="歌曲"></div>
    </aside>
    <section class="detail" id="detail" aria-live="polite"></section>
  </main>

  <footer class="footer">
    <span>只读报告 · 不会修改任何歌词或备份</span>
    <span>由 DSH 歌词复核插件生成</span>
  </footer>
</div>

<script type="application/json" id="report-data">${data}</script>
<script>
(function () {
  'use strict';

  var DATA;
  try {
    DATA = JSON.parse(document.getElementById('report-data').textContent);
  } catch (error) {
    document.body.textContent = '报告数据解析失败：' + error.message;
    return;
  }
  DATA.files = DATA.files || [];
  DATA.filesWithIssues = DATA.filesWithIssues || 0;
  DATA.conversion = DATA.conversion || {
    mode: 'derived',
    converted: 0,
    noChange: 0,
    needsReview: DATA.filesWithIssues,
    pending: 0,
    skipped: 0,
    noLyrics: 0,
    errors: 0,
    linesChanged: null
  };

  var STATUS = {
    'converted': '已拆分',
    'already-ok': '已正确',
    'manual-edit': '手工修改',
    'no-lyrics': '无歌词',
    'would-change': '待拆分',
    'error': '错误'
  };
  var REASON_LABEL = {
    'standard': 'standard',
    'title-line': '标题行（未拆分）'
  };
  var CONVERSION_LABEL = {
    'converted': '已转换',
    'no-change': '无需转换',
    'pending': '待转换',
    'skipped': '跳过（无中文翻译）',
    'no-lyrics': '无歌词',
    'error': '错误',
    'manual-edit': '手工修改',
    'unknown': '未知'
  };
  var CONVERSION_CLASS = {
    'converted': 'ok',
    'no-change': 'info',
    'pending': 'warn',
    'skipped': 'info',
    'no-lyrics': 'info',
    'error': 'danger',
    'manual-edit': 'warn',
    'unknown': 'info'
  };

  var state = {
    scope: DATA.filesWithIssues > 0
      ? 'issues'
      : (unconvertedCount() > 0 ? 'unconverted' : 'converted'),
    query: '',
    flag: '',
    selected: null,
    showAll: false
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function uniqueFlags(file) {
    var set = {};
    (file.flags || []).forEach(function (flag) { set[flag] = true; });
    (file.lines || []).forEach(function (line) {
      (line.flags || []).forEach(function (flag) { set[flag] = true; });
    });
    return Object.keys(set).sort();
  }
  function countFlag(flag) {
    var total = 0;
    (DATA.files || []).forEach(function (file) {
      (file.lines || []).forEach(function (line) {
        if ((line.flags || []).indexOf(flag) >= 0) total++;
      });
      if ((file.flags || []).indexOf(flag) >= 0) total++;
    });
    return total;
  }
  function statusLabel(status) { return STATUS[status] || status || '未知'; }
  function statusClass(status) {
    if (status === 'converted' || status === 'already-ok') return 'ok';
    if (status === 'error') return 'danger';
    if (status === 'manual-edit' || status === 'would-change') return 'warn';
    return 'info';
  }
  function conversionLabel(file) {
    return CONVERSION_LABEL[file.conversionStatus] || CONVERSION_LABEL.unknown;
  }
  function conversionClass(file) {
    return CONVERSION_CLASS[file.conversionStatus] || CONVERSION_CLASS.unknown;
  }
  function unconvertedCount() {
    return (DATA.files || []).filter(function (file) {
      return file.conversionStatus !== 'converted';
    }).length;
  }
  function formatTime(iso) {
    try { return new Date(iso).toLocaleString(); } catch (error) { return iso; }
  }
  function lineText(line) {
    return [line.timestamp, line.jp, line.zh, line.original, line.reason, (line.flags || []).join(' ')].join(' ');
  }
  function matches(file) {
    var query = state.query.trim().toLowerCase();
    if (state.flag && uniqueFlags(file).indexOf(state.flag) < 0) return false;
    if (!query) return true;
    var haystack = [file.path, file.name, file.album, conversionLabel(file), (file.flags || []).join(' ')]
      .concat((file.lines || []).map(lineText)).join(' ').toLowerCase();
    return haystack.indexOf(query) >= 0;
  }
  function visibleFiles() {
    var files = DATA.files.filter(function (file) {
      if (state.scope === 'issues' && !file.abnormal) return false;
      if (state.scope === 'converted' && file.conversionStatus !== 'converted') return false;
      if (state.scope === 'unconverted' && file.conversionStatus === 'converted') return false;
      return matches(file);
    });
    files.sort(function (left, right) {
      if (state.scope === 'issues' && left.abnormal !== right.abnormal) return left.abnormal ? -1 : 1;
      if (state.scope === 'issues' && left.flagged !== right.flagged) return right.flagged - left.flagged;
      return left.path.localeCompare(right.path);
    });
    return files;
  }
  function selectedFile() {
    for (var index = 0; index < DATA.files.length; index++) {
      if (DATA.files[index].path === state.selected) return DATA.files[index];
    }
    return null;
  }
  function ensureSelection(files) {
    if (state.selected && files.some(function (file) { return file.path === state.selected; })) return;
    state.selected = files.length > 0 ? files[0].path : null;
    state.showAll = false;
  }

  function renderHero() {
    $('hero-path').textContent = DATA.directory;
    var meta = '生成于 ' + formatTime(DATA.generatedAt);
    if (DATA.summary && DATA.summary.filesScanned !== undefined) {
      meta += ' · 扫描 ' + DATA.summary.filesScanned + ' 个文件';
    }
    if (DATA.conversion && DATA.conversion.mode === 'apply' && DATA.conversion.linesChanged !== null) {
      meta += ' · 本次转换 ' + DATA.conversion.converted + ' 首 / ' + DATA.conversion.linesChanged + ' 行';
    } else if (DATA.conversion && DATA.conversion.mode === 'preview') {
      meta += ' · 预览：' + DATA.conversion.pending + ' 首待转换';
    }
    if (DATA.filesOmitted) meta += ' · 另有 ' + DATA.filesOmitted + ' 个文件未列出';
    if (DATA.linesTruncated) meta += ' · 部分歌曲行数超过单文件上限，仅显示前 1000 行';
    $('hero-meta').textContent = meta;

    var badges = $('hero-badges');
    clear(badges);
    badges.appendChild(el('span', 'badge info', '已转换 ' + DATA.conversion.converted));
    badges.appendChild(el('span', 'badge', '未转换 ' + unconvertedCount()));
    badges.appendChild(el('span', 'badge ' + (DATA.filesWithIssues > 0 ? 'warn' : 'ok'),
      '其中需要复核 ' + DATA.filesWithIssues));
  }

  function renderCards() {
    var summary = DATA.summary;
    var conversion = DATA.conversion;
    var cards = [
      { value: DATA.files.length, label: '全部文件', hot: false },
      { value: conversion.converted, label: '已转换', hot: false },
      { value: unconvertedCount(), label: '未转换', hot: false },
      { value: conversion.noChange, label: '无需转换', hot: false },
      { value: conversion.noLyrics || 0, label: '无歌词', hot: false },
      { value: DATA.filesWithIssues, label: '其中需要复核', hot: true },
      { value: conversion.pending || 0, label: '待转换', hot: false },
      { value: conversion.errors || 0, label: '错误', hot: false },
      { value: summary.pairs, label: '拆分对', hot: false },
      { value: DATA.flaggedLines, label: '异常行', hot: true },
      { value: summary.filesWithLrcBackup || 0, label: 'LRC 备份', hot: false }
    ];
    var root = $('cards');
    clear(root);
    cards.forEach(function (card) {
      var node = el('div', 'card' + (card.hot ? ' hot' : ''));
      node.appendChild(el('div', 'value', card.value));
      node.appendChild(el('div', 'label', card.label));
      root.appendChild(node);
    });
    var note = $('count-note');
    if (note) {
      note.textContent = '全部 ' + DATA.files.length + ' 个文件 = 已转换 ' + conversion.converted
        + ' + 未转换 ' + unconvertedCount() + '（无需转换 ' + conversion.noChange
        + ' + 无歌词 ' + (conversion.noLyrics || 0)
        + ' + 待转换 ' + (conversion.pending || 0) + ' + 跳过 ' + (conversion.skipped || 0)
        + ' + 错误 ' + (conversion.errors || 0) + '）'
        + '；其中需要复核 ' + DATA.filesWithIssues
        + ' 是这些文件里的内容异常，不重复相加。';
    }
  }

  function buildFlagFilter() {
    var select = $('flag-filter');
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '全部标记';
    select.appendChild(placeholder);
    var flags = {};
    (DATA.files || []).forEach(function (file) {
      uniqueFlags(file).forEach(function (flag) { flags[flag] = true; });
    });
    Object.keys(flags).sort().forEach(function (flag) {
      var option = document.createElement('option');
      option.value = flag;
      option.textContent = flag + ' (' + countFlag(flag) + ')';
      select.appendChild(option);
    });
    select.value = state.flag;
    select.addEventListener('change', function () {
      state.flag = select.value;
      state.selected = null;
      renderAll();
    });
  }

  function renderTabs() {
    var tabs = {
      converted: ['tab-converted', '已转换 ' + DATA.conversion.converted],
      unconverted: ['tab-unconverted', '未转换 ' + unconvertedCount()],
      issues: ['tab-issues', '需要复核 ' + DATA.filesWithIssues],
      all: ['tab-all', '全部歌曲 ' + DATA.files.length]
    };
    Object.keys(tabs).forEach(function (scope) {
      var pair = tabs[scope];
      var node = $(pair[0]);
      node.textContent = pair[1];
      node.classList.toggle('active', state.scope === scope);
      node.setAttribute('aria-selected', state.scope === scope ? 'true' : 'false');
    });
  }

  function renderSongs() {
    var files = visibleFiles();
    ensureSelection(files);
    var list = $('song-list');
    clear(list);
    $('song-count').textContent = files.length + ' 首';
    $('song-hint').textContent = state.scope === 'issues'
      ? '按异常数排序'
      : state.scope === 'unconverted' ? '未转换文件，按路径排序' : '按路径排序';

    if (files.length === 0) {
      var empty = el('div', 'empty');
      var scopeLabels = {
        converted: '已转换', unconverted: '未转换', issues: '需要复核', all: '全部歌曲'
      };
      empty.appendChild(el('strong', null, '没有“' + (scopeLabels[state.scope] || '') + '”的歌曲'));
      empty.appendChild(document.createTextNode(
        state.query || state.flag ? '换个搜索词或标记筛选试试。' : '这次转换没有这一类文件。',
      ));
      list.appendChild(empty);
      return;
    }

    files.forEach(function (file) {
      var button = el('button', 'song ' + (file.abnormal ? 'issue' : 'clean'));
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', file.path === state.selected ? 'true' : 'false');
      if (file.path === state.selected) button.classList.add('active');
      button.addEventListener('click', function () {
        state.selected = file.path;
        state.showAll = false;
        renderSongs();
        renderDetail();
      });

      var title = el('div', 'title');
      title.appendChild(el('span', 'dot'));
      title.appendChild(el('span', 'name', file.name));
      button.appendChild(title);
      button.appendChild(el('div', 'album', file.album || file.path));

      var counts = el('div', 'counts');
      counts.appendChild(el('span', 'badge ' + conversionClass(file), conversionLabel(file)));
      if (file.abnormal) {
        counts.appendChild(el('span', 'badge warn', file.flagged + ' 异常'));
      }
      counts.appendChild(el('span', 'badge', file.pairs + ' 对'));
      (file.flags || []).slice(0, 4).forEach(function (flag) {
        counts.appendChild(el('span', 'badge', flag));
      });
      button.appendChild(counts);
      list.appendChild(button);
    });
  }

  function renderLine(line) {
    var node = el('div', 'line ' + (line.flagged ? 'flagged' : 'clean'));
    var head = el('div', 'line-head');
    head.appendChild(el('span', 'time', line.timestamp));
    var nonstandard = line.reason && line.reason !== 'standard' && line.reason !== 'title-line';
    head.appendChild(el('span', 'reason' + (nonstandard ? ' nonstandard' : ''),
      REASON_LABEL[line.reason] || line.reason || ''));
    var flags = el('span', 'flags');
    (line.flags || []).forEach(function (flag) { flags.appendChild(el('span', 'flag', flag)); });
    head.appendChild(flags);
    node.appendChild(head);
    node.appendChild(el('div', 'jp', line.jp || line.original || ''));
    if (line.zh) node.appendChild(el('div', 'zh', line.zh));
    if (line.original && line.original !== line.jp) {
      node.appendChild(el('div', 'orig', '原文：' + line.original));
    }
    return node;
  }

  function renderDetail() {
    var file = selectedFile();
    var detail = $('detail');
    clear(detail);
    var toggle = $('toggle-lines');
    if (!file) {
      toggle.disabled = true;
      var empty = el('div', 'empty');
      empty.appendChild(el('strong', null, '未选择歌曲'));
      empty.appendChild(document.createTextNode('从左侧选择一首歌查看逐行结果。'));
      detail.appendChild(empty);
      return;
    }

    var head = el('div', 'detail-head');
    head.appendChild(el('h2', null, file.name));
    head.appendChild(el('p', 'detail-path', file.path));

    var meta = el('div', 'detail-meta');
    meta.appendChild(el('span', 'badge ' + conversionClass(file), conversionLabel(file)));
    if (file.conversionLinesChanged !== null) {
      meta.appendChild(el('span', 'badge', file.conversionLinesChanged + ' 行改写'));
    }
    meta.appendChild(el('span', 'badge ' + statusClass(file.status), '复核：' + statusLabel(file.status)));
    meta.appendChild(el('span', 'badge', file.format || '未知格式'));
    meta.appendChild(el('span', 'badge', file.pairs + ' 拆分对'));
    meta.appendChild(el('span', 'badge ' + (file.flagged > 0 ? 'warn' : 'ok'), file.flagged + ' 异常行'));
    (file.flags || []).forEach(function (flag) {
      meta.appendChild(el('span', 'badge danger', flag));
    });
    head.appendChild(meta);

    if (file.backup) {
      head.appendChild(el('p', 'backup', 'LRC 备份：' + file.backup));
    } else {
      head.appendChild(el('p', 'backup', 'LRC 备份：无（该文件不能与原始歌词对比或还原）'));
    }
    if (file.error) {
      head.appendChild(el('p', 'backup', '错误：' + file.error));
    }
    if (file.conversionError) {
      head.appendChild(el('p', 'backup', '转换错误：' + file.conversionError));
    }

    var actions = el('div', 'detail-actions');
    actions.appendChild(el('span', 'note',
      '异常 ' + file.flaggedLines + ' 行 / 全部 ' + file.lines.length + ' 行' +
      (file.linesTruncated ? '（已截断）' : '')));
    head.appendChild(actions);
    detail.appendChild(head);

    var lines = state.showAll ? file.lines : file.lines.filter(function (line) { return line.flagged; });
    if (lines.length === 0) {
      var emptyLines = el('div', 'empty');
      emptyLines.appendChild(el('strong', null, file.abnormal ? '歌曲级异常' : '没有异常行'));
      var message = file.abnormal
        ? '这个文件有歌曲级标记：' + (file.flags || []).join(', ') + '。逐行结果里没有可显示的异常行。'
        : '这首歌没有需要人工确认的拆分。';
      emptyLines.appendChild(document.createTextNode(message));
      if (!state.showAll && file.lines.length > 0) {
        emptyLines.appendChild(document.createTextNode(' 点击上方“显示该歌全部行”查看上下文。'));
      }
      detail.appendChild(emptyLines);
      toggle.disabled = file.lines.length === 0;
      toggle.textContent = state.showAll ? '只看异常行' : '显示该歌全部行';
      return;
    }
    toggle.disabled = false;
    toggle.textContent = state.showAll ? '只看异常行' : '显示该歌全部行';

    var list = el('div', 'lines');
    lines.forEach(function (line) { list.appendChild(renderLine(line)); });
    detail.appendChild(list);
  }

  function renderAll() {
    renderTabs();
    renderSongs();
    renderDetail();
  }

  function renderSummary() {
    renderHero();
    renderCards();
    buildFlagFilter();
  }

  [['tab-converted', 'converted'], ['tab-unconverted', 'unconverted'], ['tab-issues', 'issues'], ['tab-all', 'all']]
    .forEach(function (pair) {
      $(pair[0]).addEventListener('click', function () {
        state.scope = pair[1];
        state.selected = null;
        renderAll();
      });
    });
  $('search').addEventListener('input', function (event) {
    state.query = event.target.value || '';
    state.selected = null;
    renderSongs();
    renderDetail();
  });
  $('toggle-lines').addEventListener('click', function () {
    state.showAll = !state.showAll;
    renderDetail();
  });

  renderSummary();
  renderAll();
})();
</script>
</body>
</html>
`;
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render a report object as a standalone HTML document.
 * @param {object} report
 */
export function renderReviewReportHtml(report) {
  return renderHtml(report);
}

/**
 * Build a review report and write it as one self-contained HTML file.
 * @param {{ directory: string, output?: string, signal?: AbortSignal, conversion?: object }} options
 */
export function writeReviewReport(options) {
  const report = buildReviewReport(options);
  let output = options.output && String(options.output).trim() !== ''
    ? path.resolve(report.directory, String(options.output))
    : path.join(report.directory, DEFAULT_REPORT_NAME);
  if (path.extname(output) === '') output += '.html';

  fs.mkdirSync(path.dirname(output), { recursive: true });
  writeFileAtomic(output, Buffer.from(renderReviewReportHtml(report), 'utf8'));

  return {
    ok: true,
    directory: report.directory,
    path: output,
    generatedAt: report.generatedAt,
    summary: report.summary,
    conversion: report.conversion,
    filesScanned: report.summary.filesScanned,
    filesWithIssues: report.filesWithIssues,
    flaggedLines: report.flaggedLines,
    linesTotal: report.linesTotal,
    issueFiles: report.files
      .filter((file) => file.abnormal)
      .slice(0, 200)
      .map((file) => ({
        path: file.path,
        flagged: file.flagged,
        pairs: file.pairs,
        status: file.status,
        flags: file.flags,
      })),
    ...(report.filesOmitted ? { filesOmitted: report.filesOmitted } : {}),
    ...(report.linesTruncated ? { linesTruncated: true } : {}),
  };
}
