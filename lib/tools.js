// Host tool definitions.
//
// The definitions are plain `ToolDefinition` objects built against the
// installed `@deepseek-ai/dsh-tools` contract (name, description, raw JSON
// Schema parameters, canonical output schema + render, execute). The bundle
// declares no dependency on any Harness package, so raw JSON Schema is used
// instead of `defineTool`.

import { convertDirectory } from './convert.js';
import { reviewDirectory, REVIEW_FLAGS } from './review.js';
import { revertPath } from './revert.js';
import { writeReviewReport } from './report.js';

/** @param {unknown} args @param {string[]} allowed */
function assertKnownArgs(args, allowed) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error(`arguments must be an object with: ${allowed.join(', ')}`);
  }
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) {
      throw new Error(`unknown argument "${key}"; supported arguments: ${allowed.join(', ')}`);
    }
  }
}

/** @param {Record<string, unknown>} args @param {string} name */
function requireString(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required and must be a non-empty string`);
  }
  return value;
}

/** @param {Record<string, unknown>} args @param {string} name @param {boolean} fallback */
function optionalBoolean(args, name, fallback) {
  const value = args[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

/** @param {Record<string, unknown>} args @param {string} name @param {number} fallback */
function optionalInteger(args, name, fallback) {
  const value = args[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

/** @param {Record<string, unknown>} args @param {string} name */
function optionalString(args, name) {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value;
}

/** @param {Record<string, number> | undefined} counts */
function histogramText(counts) {
  if (!counts) return '';
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => `${key} ${count}`)
    .join(', ');
}

/** @param {string} text @param {number} max */
function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** @param {string | null} error */
function errorText(error) {
  return error ? `  error: ${error}` : '';
}

const convertParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    directory: {
      type: 'string',
      description: 'Directory to scan. Subdirectories are included; .lyrics-backup, .bak and temp files are ignored.',
    },
    apply: {
      type: 'boolean',
      default: false,
      description: 'Write the split lyrics. Default false previews only and touches no file.',
    },
    force: {
      type: 'boolean',
      default: false,
      description: 'Split even when the lyrics contain no Simplified-Chinese marker. Default false skips pure-Japanese files.',
    },
    backup: {
      type: 'boolean',
      default: true,
      description: 'Write the original lyrics as an LRC backup under .lyrics-backup before the first rewrite. Default true; existing backups are never overwritten.',
    },
    review: {
      type: 'boolean',
      default: false,
      description: 'Append a compact flagged-split review after converting.',
    },
    report: {
      type: 'boolean',
      description: 'Generate the self-contained interactive HTML report after the run. Default true when apply is true, false for a preview. Use true with a preview to get a dry-run report.',
    },
  },
  required: ['directory'],
};

const convertOutput = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'mode', 'directory', 'summary', 'files'],
  properties: {
    ok: { type: 'boolean' },
    mode: { type: 'string', enum: ['preview', 'apply'] },
    directory: { type: 'string' },
    summary: { type: 'object', additionalProperties: true },
    files: { type: 'array' },
    filesOmitted: { type: 'integer' },
    review: { type: 'object', additionalProperties: true },
    report: { type: 'object', additionalProperties: true },
    reportError: { type: 'string' },
  },
};

const reviewParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    directory: {
      type: 'string',
      description: 'Directory that was converted. Only files in this directory and its subdirectories are reviewed.',
    },
    file: {
      type: 'string',
      description: 'Relative path of one file inside the directory to review instead of the whole directory.',
    },
    filter: {
      type: 'string',
      enum: ['flagged', 'all'],
      default: 'flagged',
      description: "Which line entries to return. 'flagged' (default) returns pairs that need a look; 'all' returns every split pair and title line.",
    },
    limit: {
      type: 'integer',
      default: 100,
      description: 'Maximum number of line entries to return, 1-1000. Summary counts are always complete.',
    },
  },
  required: ['directory'],
};

const reviewOutput = {
  type: 'object',
  additionalProperties: false,
  required: [
    'ok', 'directory', 'filter', 'limit', 'summary', 'files', 'lines',
    'linesMatched', 'linesReturned', 'truncated',
  ],
  properties: {
    ok: { type: 'boolean' },
    directory: { type: 'string' },
    filter: { type: 'string', enum: ['flagged', 'all'] },
    limit: { type: 'integer' },
    summary: { type: 'object', additionalProperties: true },
    files: { type: 'array' },
    lines: { type: 'array' },
    linesMatched: { type: 'integer' },
    linesReturned: { type: 'integer' },
    truncated: { type: 'boolean' },
    filesOmitted: { type: 'integer' },
    hint: { type: 'string' },
  },
};

const revertParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: {
      type: 'string',
      description: 'A file to restore from its LRC backup (or legacy .bak), or a directory whose backed-up files are all restored. A <.bak> path restores that legacy original.',
    },
    confirm: {
      type: 'boolean',
      description: 'Must be true. The tool refuses to overwrite any current file otherwise.',
    },
  },
  required: ['path', 'confirm'],
};

const revertOutput = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'mode', 'path', 'counts', 'restored', 'skipped', 'errors'],
  properties: {
    ok: { type: 'boolean' },
    mode: { type: 'string', enum: ['file', 'directory'] },
    path: { type: 'string' },
    counts: { type: 'object', additionalProperties: true },
    restored: { type: 'array' },
    skipped: { type: 'array' },
    skippedOmitted: { type: 'integer' },
    errors: { type: 'array' },
  },
};

const reportParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    directory: {
      type: 'string',
      description: 'Converted lyrics directory to review. The report lists songs with issues first and their flagged lines.',
    },
    output: {
      type: 'string',
      description: 'HTML output path. Relative paths resolve against the directory. Default: <directory>/lyrics-review-report.html.',
    },
  },
  required: ['directory'],
};

const reportOutput = {
  type: 'object',
  additionalProperties: false,
  required: [
    'ok', 'directory', 'path', 'generatedAt', 'summary',
    'filesScanned', 'filesWithIssues', 'flaggedLines', 'linesTotal', 'issueFiles',
  ],
  properties: {
    ok: { type: 'boolean' },
    directory: { type: 'string' },
    path: { type: 'string' },
    generatedAt: { type: 'string' },
    summary: { type: 'object', additionalProperties: true },
    conversion: { type: 'object', additionalProperties: true },
    filesScanned: { type: 'integer' },
    filesWithIssues: { type: 'integer' },
    flaggedLines: { type: 'integer' },
    linesTotal: { type: 'integer' },
    issueFiles: { type: 'array' },
    filesOmitted: { type: 'integer' },
    linesTruncated: { type: 'boolean' },
  },
};

/** @param {object} _args @param {object} value */
function renderReport(_args, value) {
  const lines = [];
  lines.push(`lyrics HTML review report: ${value.path}`);
  lines.push(
    `scanned ${value.filesScanned} file(s); songs with issues ${value.filesWithIssues}; `
    + `${value.summary.pairs} pair(s); flagged lines ${value.flaggedLines} of ${value.linesTotal}`,
  );
  if (value.conversion) {
    const mode = value.conversion.mode === 'apply'
      ? 'this run'
      : value.conversion.mode === 'preview' ? 'preview' : 'current state';
    lines.push(
      `conversion (${mode}): converted ${value.conversion.converted}, no change ${value.conversion.noChange}, `
      + `need review ${value.conversion.needsReview}, pending ${value.conversion.pending}`,
    );
  }
  const shown = value.issueFiles.slice(0, 12);
  if (shown.length > 0) {
    lines.push('songs with issues:');
    for (const file of shown) {
      const flags = file.flags && file.flags.length > 0 ? `  [${file.flags.join(', ')}]` : '';
      lines.push(`  ${file.flagged} flagged / ${file.pairs} pair(s): ${file.path}${flags}`);
    }
    if (value.issueFiles.length > shown.length) {
      lines.push(`  ... ${value.issueFiles.length - shown.length} more song(s) in the HTML report`);
    }
  } else {
    lines.push('No song needs review.');
  }
  if (value.filesOmitted) lines.push(`  ... ${value.filesOmitted} file(s) omitted from the report`);
  if (value.linesTruncated) lines.push('  ... some files exceeded the per-file line limit; the report shows the first 1000 lines');
  lines.push('Open the HTML file in a browser: the report is self-contained and read-only.');
  return [{ type: 'text', text: lines.join('\n') }];
}

/** @param {object} _args @param {{ files: object[], filesOmitted?: number }} value */
function renderConvert(_args, value) {
  const summary = value.summary;
  const lines = [];
  const extensions = histogramText(summary.byExtension);
  lines.push(`lyrics ${value.mode === 'apply' ? 'conversion' : 'preview'}: ${value.directory}`);
  lines.push(
    `scanned ${summary.scanned} file(s)${extensions ? ` (${extensions})` : ''}; `
    + `${value.mode === 'apply' ? 'changed' : 'would change'} ${summary.changed} file(s) / `
    + `${summary.linesChanged} line(s); already ok ${summary.alreadyOk}; no lyrics ${summary.noLyrics}; `
    + `skipped no-translation ${summary.skippedNoTranslation}; errors ${summary.errors}`,
  );
  if (value.mode === 'apply') {
    lines.push(`LRC backups created ${summary.backupsCreated}, reused ${summary.backupsReused}`);
  }

  const notable = value.files.filter((file) => file.status !== 'already-ok');
  for (const file of notable.slice(0, 15)) {
    const notes = histogramText(file.notes);
    const detail = file.status === 'error'
      ? errorText(file.error)
      : `  ${file.linesChanged}/${file.timedLines} line(s)${notes ? `  [${notes}]` : ''}${file.backup ? `  backup ${file.backup}` : ''}`;
    lines.push(`  ${file.status}: ${file.path}  [${file.format}]${detail}`);
  }
  if (notable.length > 15) lines.push(`  ... ${notable.length - 15} more non-clean file(s) not shown`);
  if (value.filesOmitted) lines.push(`  ... ${value.filesOmitted} file(s) omitted from the report`);

  if (value.review) {
    const reviewSummary = value.review.summary;
    lines.push(
      `review: ${reviewSummary.converted} converted, ${reviewSummary.manualEdits} manual edit(s), `
      + `${reviewSummary.flaggedPairs} flagged pair(s), ${reviewSummary.titleLines} title line(s)`,
    );
    const flags = histogramText(reviewSummary.flags);
    if (flags) lines.push(`review flags: ${flags}`);
  }

  if (value.report) {
    lines.push(`HTML report: ${value.report.path}`);
    lines.push(
      `report: converted ${value.report.converted}, no change ${value.report.noChange}, `
      + `need review ${value.report.needsReview}, pending ${value.report.pending}`,
    );
  } else if (value.reportError) {
    lines.push(`HTML report was not written: ${value.reportError}`);
  }

  if (value.mode !== 'apply') {
    lines.push('No file was written. Call again with apply: true to write; each file gets its original lyrics saved under .lyrics-backup first.');
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

/** @param {object} _args @param {object} value */
function renderReview(_args, value) {
  const summary = value.summary;
  const lines = [];
  lines.push(`lyrics review (${value.filter}): ${value.directory}`);
  lines.push(
    `files ${summary.filesScanned} | with backup ${summary.filesWithBackup} | `
    + `converted ${summary.converted} | manual edits ${summary.manualEdits} | `
    + `already ok ${summary.alreadyOk} | no lyrics ${summary.noLyrics} | errors ${summary.errors}`,
  );
  lines.push(
    `pairs ${summary.pairs} | flagged pairs ${summary.flaggedPairs} | title lines ${summary.titleLines}`,
  );
  const reasons = histogramText(summary.reasons);
  if (reasons) lines.push(`reasons: ${reasons}`);
  const flags = histogramText(summary.flags);
  if (flags) lines.push(`flags: ${flags}`);
  const fileFlags = histogramText(summary.fileFlags);
  if (fileFlags) lines.push(`file flags: ${fileFlags}`);
  if (summary.backupRoot) {
    lines.push(
      `backups: LRC ${summary.filesWithLrcBackup || 0} | legacy .bak ${summary.filesWithLegacyBackup || 0} | `
      + `none ${summary.noBackup} | root ${summary.backupRoot}`,
    );
  }

  for (const line of value.lines.slice(0, 15)) {
    const flagText = line.flags.length > 0 ? `  [${line.flags.join(', ')}]` : '';
    lines.push(
      `  ${line.file}: ${line.timestamp} ${clip(line.jp, 48)}`
      + `${line.zh ? ` | ${clip(line.zh, 48)}` : ''}  (${line.reason})${flagText}`,
    );
  }
  if (value.lines.length > 15) {
    lines.push(`  ... ${value.lines.length - 15} more line(s) in the result`);
  }
  if (value.linesMatched === 0) {
    lines.push(value.filter === 'flagged'
      ? 'No flagged lines: every split looks clean.'
      : 'No split pairs were found.');
  }
  if (value.truncated) {
    lines.push(
      `showing ${value.linesReturned} of ${value.linesMatched} matching line(s); `
      + "narrow with file, raise limit (<=1000), or set filter to 'flagged'.",
    );
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

/** @param {object} _args @param {object} value */
function renderRevert(_args, value) {
  const lines = [];
  lines.push(`restored ${value.counts.restored} file(s) from lyrics backups in ${value.path}`);
  for (const file of value.restored.slice(0, 15)) {
    const kind = file.backupKind ? `  ${file.backupKind === 'legacy' ? 'legacy .bak' : 'LRC backup'}` : '';
    lines.push(`  ${file.path}${kind}${file.verified === true ? '  verified' : file.verified === false ? '  VERIFY FAILED' : ''}`);
  }
  if (value.restored.length > 15) lines.push(`  ... ${value.restored.length - 15} more`);
  if (value.counts.skipped > 0) {
    lines.push(`skipped ${value.counts.skipped} file(s) without an LRC backup or legacy .bak`);
  }
  for (const failure of value.errors.slice(0, 10)) {
    lines.push(`  error: ${failure.path}: ${failure.error}`);
  }
  if (value.errors.length > 10) lines.push(`  ... ${value.errors.length - 10} more error(s)`);
  lines.push('The backups were kept; revert again or delete them when the result is right.');
  return [{ type: 'text', text: lines.join('\n') }];
}

/** @type {object[]} */
export const toolDefinitions = [
  {
    name: 'lyrics_convert',
    description:
      'Split merged Japanese/Chinese lyric lines into two lines with identical timestamps in WAV, MP3, FLAC, and LRC files. '
      + 'Previews by default; apply writes each file after verifying the rebuilt container. '
      + 'Conversion is idempotent: already-split and pure-Japanese files are skipped. '
      + 'The original lyrics are saved first as one LRC backup under <library>/.lyrics-backup, mirroring the original folders; '
      + 'audio containers are never copied. lyrics_review and lyrics_revert use these backups. '
      + 'After an apply, a self-contained interactive HTML report is generated by default '
      + '(converted songs, songs that needed no change, and songs that need review); pass report: false to skip it.',
    parameters: convertParameters,
    output: { schema: convertOutput, render: renderConvert },
    async execute(args, exec) {
      assertKnownArgs(args, ['directory', 'apply', 'force', 'backup', 'review', 'report']);
      const apply = optionalBoolean(args, 'apply', false);
      const wantReport = args.report === undefined ? apply : optionalBoolean(args, 'report', true);
      const conversion = convertDirectory({
        directory: requireString(args, 'directory'),
        apply,
        force: optionalBoolean(args, 'force', false),
        backup: optionalBoolean(args, 'backup', true),
        review: optionalBoolean(args, 'review', false),
        signal: exec && exec.signal,
      });
      if (wantReport) {
        try {
          const report = writeReviewReport({
            directory: conversion.directory,
            conversion,
            signal: exec && exec.signal,
          });
          conversion.report = {
            ok: true,
            path: report.path,
            generatedAt: report.generatedAt,
            converted: report.conversion.converted,
            noChange: report.conversion.noChange,
            needsReview: report.conversion.needsReview,
            pending: report.conversion.pending,
            noLyrics: report.conversion.noLyrics,
            errors: report.conversion.errors,
            linesChanged: report.conversion.linesChanged,
          };
        } catch (error) {
          conversion.reportError = error && error.message ? error.message : String(error);
        }
      }
      return conversion;
    },
  },
  {
    name: 'lyrics_review',
    description:
      'Review converted lyrics against their LRC backups (the .lyrics-backup folder, or legacy .bak copies) and report per-line split decisions and quality flags. '
      + 'Read-only. Compares the current file with the split of its backup to find missing pairs, manual edits, '
      + 'non-standard splits, Chinese/Japanese character mixing, and short translations. '
      + `Line flags: ${REVIEW_FLAGS.join(', ')}.`,
    parameters: reviewParameters,
    output: { schema: reviewOutput, render: renderReview },
    async execute(args, exec) {
      assertKnownArgs(args, ['directory', 'file', 'filter', 'limit']);
      const filter = args.filter === undefined ? 'flagged' : args.filter;
      if (filter !== 'flagged' && filter !== 'all') {
        throw new Error("filter must be 'flagged' or 'all'");
      }
      return reviewDirectory({
        directory: requireString(args, 'directory'),
        file: optionalString(args, 'file'),
        filter,
        limit: optionalInteger(args, 'limit', 100),
        signal: exec && exec.signal,
      });
    },
  },
  {
    name: 'lyrics_revert',
    description:
      'Restore the original lyrics from the centralized LRC backups (or legacy <file>.bak copies) for one file or for every backed-up file under a directory. '
      + 'Requires confirm: true. Files without a backup are left untouched, the backups are kept, '
      + 'and an audio container keeps its audio/cover bytes while only the lyric tag is rewritten.',
    parameters: revertParameters,
    output: { schema: revertOutput, render: renderRevert },
    async execute(args, exec) {
      assertKnownArgs(args, ['path', 'confirm']);
      if (args.confirm !== true) {
        throw new Error('lyrics_revert requires confirm: true');
      }
      return revertPath({
        path: requireString(args, 'path'),
        confirm: true,
        signal: exec && exec.signal,
      });
    },
  },
  {
    name: 'lyrics_report',
    description:
      'Generate one self-contained interactive HTML review report for a converted lyrics directory. '
      + 'The report lists songs with issues first; clicking a song shows its flagged lines with timestamps, '
      + 'both lyric halves, split reason, and flags. Read-only: it writes only the HTML report file and never '
      + 'changes lyrics or backups.',
    parameters: reportParameters,
    output: { schema: reportOutput, render: renderReport },
    async execute(args, exec) {
      assertKnownArgs(args, ['directory', 'output']);
      return writeReviewReport({
        directory: requireString(args, 'directory'),
        output: optionalString(args, 'output'),
        signal: exec && exec.signal,
      });
    },
  },
];
