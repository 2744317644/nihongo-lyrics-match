// Post-conversion review engine.
//
// For every supported file the engine re-runs the splitter on the LRC backup
// (or legacy `.bak` original), records the per-line decision, and compares
// that expectation with the current lyrics. It is strictly read-only.

import { CN_ONLY, JP_ONLY, hasChineseMarker } from './language.js';
import { analyzeLyricsText } from './lrc.js';
import { readLyrics } from './lyrics-source.js';
import {
  findBackup,
  relativeBackupPath,
  resolveBackupContext,
} from './backups.js';
import {
  bodiesByTimestamp,
  brokenTimestamps,
  cleanLength,
  collectFiles,
  parseTimedLines,
  relativePath,
  resolveDirectory,
  resolveFile,
  sameList,
  throwIfAborted,
} from './scan.js';

/** Flag vocabulary, in stable reporting order. */
export const REVIEW_FLAGS = Object.freeze([
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

const FLAG_SET = new Set(REVIEW_FLAGS);

/** @param {string} reason */
function isNonStandardReason(reason) {
  return reason !== 'standard';
}

/** @param {string[]} flags */
function normalizeFlags(flags) {
  return REVIEW_FLAGS.filter((flag) => flags.includes(flag));
}

/** @param {string} text */
function hasReplacementCharacter(text) {
  return text.includes('\uFFFD');
}

/** @param {string} text */
function hasChineseOnlyCharacter(text) {
  for (const ch of text) if (CN_ONLY.has(ch)) return true;
  return false;
}

/** @param {string} text */
function hasJapaneseOnlyCharacter(text) {
  for (const ch of text) if (JP_ONLY.has(ch)) return true;
  return false;
}

/**
 * Whether a body occurs at a timestamp other than `timeTags`.
 * @param {Map<string, Set<string>>} index
 * @param {string} body
 * @param {string} timeTags
 */
function occursElsewhere(index, body, timeTags) {
  const timestamps = index.get(body);
  if (!timestamps) return false;
  for (const timestamp of timestamps) if (timestamp !== timeTags) return true;
  return false;
}

/** @param {string} root @param {string} filePath @param {{ base: string, backupRoot: string }} context */
function reviewOneFile(root, filePath, context) {
  const relative = relativePath(root, filePath);
  const backupInfo = findBackup(filePath, context);
  const backupExists = backupInfo !== null;

  const entry = {
    path: relative,
    format: '',
    status: '',
    hasBackup: backupExists,
    backupKind: backupInfo ? backupInfo.kind : null,
    backup: backupInfo ? relativeBackupPath(backupInfo.path, context) : null,
    pairs: 0,
    flaggedPairs: 0,
    titleLines: 0,
    flagged: 0,
    flags: [],
    error: null,
  };
  /** @type {object[]} */
  const lines = [];
  /** @type {Record<string, number>} */
  const reasons = {};

  let current;
  try {
    current = readLyrics(filePath, { strictFlacUtf8: false });
  } catch (error) {
    entry.status = 'error';
    entry.error = error && error.message ? error.message : String(error);
    return { entry, lines, reasons };
  }
  entry.format = current.format;

  if (!current.hasLyrics || !String(current.text || '').trim()) {
    entry.status = 'no-lyrics';
    entry.flags.push('noLyrics');
    if (backupExists) entry.flags.push('manualEdit');
    return { entry, lines, reasons };
  }

  const fileFlags = new Set();
  if (!backupExists) fileFlags.add('noBackup');

  const currentTimed = parseTimedLines(current.text);
  const currentMap = bodiesByTimestamp(currentTimed);
  const broken = brokenTimestamps(currentTimed);
  if (broken.size > 0) fileFlags.add('timestampMismatch');
  if (hasReplacementCharacter(current.text)) fileFlags.add('mojibake');

  // Without a backup the current lyrics are the only source of truth: report
  // whether the directory still needs conversion, but never invent pairs.
  if (!backupExists) {
    const currentAnalysis = analyzeLyricsText(current.text);
    entry.status = currentAnalysis.changed > 0 ? 'would-change' : 'already-ok';
    entry.flags = normalizeFlags([...fileFlags]);
    return { entry, lines, reasons };
  }

  let backupSnapshot;
  try {
    backupSnapshot = readLyrics(backupInfo.path, { strictFlacUtf8: false });
  } catch (error) {
    entry.status = 'error';
    entry.error = `backup: ${error && error.message ? error.message : String(error)}`;
    entry.flags = normalizeFlags([...fileFlags, 'manualEdit']);
    return { entry, lines, reasons };
  }

  if (!backupSnapshot.hasLyrics) {
    entry.status = 'manual-edit';
    entry.flags = normalizeFlags([...fileFlags, 'manualEdit']);
    return { entry, lines, reasons };
  }

  if (hasReplacementCharacter(backupSnapshot.text)) fileFlags.add('mojibake');

  const analysis = analyzeLyricsText(backupSnapshot.text);
  for (const [reason, count] of Object.entries(analysis.notes)) {
    reasons[reason] = (reasons[reason] || 0) + count;
  }

  const expectedMap = bodiesByTimestamp(parseTimedLines(analysis.text));
  const currentEqualsExpected = current.text === analysis.text;
  entry.status = currentEqualsExpected
    ? (analysis.changed > 0 ? 'converted' : 'already-ok')
    : 'manual-edit';
  if (entry.status === 'manual-edit') fileFlags.add('manualEdit');

  // Body -> every timestamp where the current file contains it.
  /** @type {Map<string, Set<string>>} */
  const bodyTimestamps = new Map();
  for (const [timeTags, bodies] of currentMap) {
    for (const body of bodies) {
      const timestamps = bodyTimestamps.get(body);
      if (timestamps) timestamps.add(timeTags);
      else bodyTimestamps.set(body, new Set([timeTags]));
    }
  }

  for (const decision of analysis.decisions) {
    if (decision.kind === 'title') {
      entry.titleLines++;
      const flags = ['titleLine'];
      if (broken.has(decision.timeTags)) flags.push('timestampMismatch');
      if (hasReplacementCharacter(decision.body)) flags.push('mojibake');
      const currentBodies = currentMap.get(decision.timeTags) || [];
      if (!currentBodies.includes(decision.body)) flags.push('manualEdit');
      const normalized = normalizeFlags(flags);
      entry.flagged++;
      lines.push({
        file: relative,
        timestamp: decision.timeTags,
        original: decision.body,
        jp: decision.body,
        zh: '',
        reason: 'title-line',
        flags: normalized,
        flagged: true,
      });
      continue;
    }
    if (decision.kind !== 'split') continue;

    entry.pairs++;
    const flags = [];
    if (hasChineseOnlyCharacter(decision.jp)) flags.push('jpHasChineseOnly');
    if (hasJapaneseOnlyCharacter(decision.zh)) flags.push('zhHasJapaneseOnly');
    if (cleanLength(decision.zh) <= 3 && !hasChineseMarker(decision.zh)) flags.push('shortTranslation');
    if (hasReplacementCharacter(decision.body) || hasReplacementCharacter(decision.zh)) {
      flags.push('mojibake');
    }

    const expectedBodies = expectedMap.get(decision.timeTags) || [];
    const currentBodies = currentMap.get(decision.timeTags) || [];
    if (!sameList(expectedBodies, currentBodies)) {
      flags.push('manualEdit');
      const jpHere = currentBodies.includes(decision.jp);
      const zhHere = currentBodies.includes(decision.zh);
      if (!jpHere || !zhHere) {
        const moved = (!jpHere && occursElsewhere(bodyTimestamps, decision.jp, decision.timeTags))
          || (!zhHere && occursElsewhere(bodyTimestamps, decision.zh, decision.timeTags));
        flags.push(moved ? 'timestampMismatch' : 'missingPair');
      }
    }
    if (broken.has(decision.timeTags)) flags.push('timestampMismatch');

    const normalized = normalizeFlags(flags);
    const flagged = normalized.length > 0 || isNonStandardReason(decision.reason);
    if (flagged) {
      entry.flagged++;
      entry.flaggedPairs++;
    }
    lines.push({
      file: relative,
      timestamp: decision.timeTags,
      original: decision.body,
      jp: decision.jp,
      zh: decision.zh,
      reason: decision.reason,
      flags: normalized,
      flagged,
    });
  }

  entry.flags = normalizeFlags([...fileFlags]);
  return { entry, lines, reasons };
}

/**
 * Review a directory (or one file inside it) against its LRC backups
 * (`.lyrics-backup`) or legacy `.bak` originals.
 * @param {{ directory: string, file?: string, filter?: string, limit?: number }} options
 */
export function reviewDirectory(options) {
  const directory = resolveDirectory(options.directory);
  const context = resolveBackupContext(directory);
  const filter = options.filter === 'all' ? 'all' : 'flagged';
  const requestedLimit = options.limit === undefined || options.limit === null ? 100 : Number(options.limit);
  if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
    throw new Error('limit must be a positive number');
  }
  const limit = Math.min(Math.floor(requestedLimit), 1000);
  const onlyFile = options.file === undefined || options.file === null || options.file === ''
    ? null
    : resolveFile(directory, options.file);

  const files = onlyFile ? [onlyFile] : collectFiles(directory);
  const entries = [];
  /** @type {object[]} */
  const allLines = [];
  const summary = {
    filesScanned: files.length,
    filesWithBackup: 0,
    filesWithLrcBackup: 0,
    filesWithLegacyBackup: 0,
    backupRoot: context.backupRoot,
    backupBase: context.base,
    converted: 0,
    alreadyOk: 0,
    manualEdits: 0,
    noLyrics: 0,
    noBackup: 0,
    needsConversion: 0,
    errors: 0,
    pairs: 0,
    flaggedPairs: 0,
    titleLines: 0,
    reasons: {},
    flags: {},
    fileFlags: {},
  };

  for (const filePath of files) {
    throwIfAborted(options.signal);
    const reviewed = reviewOneFile(directory, filePath, context);
    entries.push(reviewed.entry);
    for (const line of reviewed.lines) allLines.push(line);

    if (reviewed.entry.hasBackup) summary.filesWithBackup++;
    else summary.noBackup++;
    if (reviewed.entry.backupKind === 'lrc') summary.filesWithLrcBackup++;
    else if (reviewed.entry.backupKind === 'legacy') summary.filesWithLegacyBackup++;
    if (reviewed.entry.status === 'converted') summary.converted++;
    else if (reviewed.entry.status === 'already-ok') summary.alreadyOk++;
    else if (reviewed.entry.status === 'manual-edit') summary.manualEdits++;
    else if (reviewed.entry.status === 'no-lyrics') summary.noLyrics++;
    else if (reviewed.entry.status === 'would-change') summary.needsConversion++;
    else if (reviewed.entry.status === 'error') summary.errors++;

    summary.pairs += reviewed.entry.pairs;
    summary.flaggedPairs += reviewed.entry.flaggedPairs;
    summary.titleLines += reviewed.entry.titleLines;

    for (const [reason, count] of Object.entries(reviewed.reasons)) {
      summary.reasons[reason] = (summary.reasons[reason] || 0) + count;
    }
    for (const flag of reviewed.entry.flags) {
      summary.fileFlags[flag] = (summary.fileFlags[flag] || 0) + 1;
    }
  }

  for (const line of allLines) {
    for (const flag of line.flags) {
      if (!FLAG_SET.has(flag)) continue;
      summary.flags[flag] = (summary.flags[flag] || 0) + 1;
    }
  }

  const selectedLines = filter === 'all' ? allLines : allLines.filter((line) => line.flagged);
  const shownLines = selectedLines.slice(0, limit);
  const selectedFiles = filter === 'all'
    ? entries
    : entries.filter((entry) => entry.flagged > 0 || entry.status === 'error'
      || (entry.flags.length > 0 && filter === 'flagged'));

  const filesCap = 500;
  const shownFiles = selectedFiles.slice(0, filesCap);

  const result = {
    ok: true,
    directory,
    filter,
    limit,
    summary,
    files: shownFiles,
    lines: shownLines,
    linesMatched: selectedLines.length,
    linesReturned: shownLines.length,
    truncated: shownLines.length < selectedLines.length || shownFiles.length < selectedFiles.length,
  };
  if (shownFiles.length < selectedFiles.length) result.filesOmitted = selectedFiles.length - shownFiles.length;
  if (result.truncated) {
    result.hint = `showing ${shownLines.length} of ${selectedLines.length} matching lines; narrow with file, raise limit (<=1000), or use filter to reduce the set`;
  }
  return result;
}
