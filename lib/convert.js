// Conversion engine shared by the Host tool and the Web API.
//
// Semantics match the lyrics-split CLI: preview unless `apply`, write an LRC
// backup under `.lyrics-backup` before the first rewrite, verify the rebuilt
// container, and re-read the written file before reporting success.

import fs from 'node:fs';

import {
  createLyricsBackup,
  lrcBackupPath,
  relativeBackupPath,
  resolveBackupContext,
} from './backups.js';
import { writeFileAtomic } from './fileops.js';
import { extOf, loadLyricsFile } from './formats.js';
import { hasChineseMarker } from './language.js';
import { analyzeLyricsText } from './lrc.js';
import { readLyrics } from './lyrics-source.js';
import { reviewDirectory } from './review.js';
import {
  collectFiles,
  relativePath,
  resolveDirectory,
  throwIfAborted,
} from './scan.js';

const FILE_RESULT_CAP = 500;

/**
 * @param {string} relative
 * @param {{ byExtension: Record<string, number> }} summary
 */
function countExtension(relative, summary) {
  const ext = extOf(relative).replace(/^\./, '') || '(none)';
  summary.byExtension[ext] = (summary.byExtension[ext] || 0) + 1;
}

/**
 * @param {{ directory: string, apply?: boolean, force?: boolean,
 *   backup?: boolean, review?: boolean, signal?: AbortSignal }} options
 */
export function convertDirectory(options) {
  const directory = resolveDirectory(options.directory);
  const apply = options.apply === true;
  const force = options.force === true;
  const backup = options.backup !== false;
  const wantReview = options.review === true;

  const files = collectFiles(directory);
  const backupContext = apply && backup ? resolveBackupContext(directory) : null;
  const results = [];
  const summary = {
    mode: apply ? 'apply' : 'preview',
    scanned: files.length,
    changed: 0,
    alreadyOk: 0,
    noLyrics: 0,
    skippedNoTranslation: 0,
    errors: 0,
    linesChanged: 0,
    linesTotal: 0,
    backupsCreated: 0,
    backupsReused: 0,
    backupRoot: backupContext ? backupContext.backupRoot : null,
    byExtension: {},
  };

  for (let index = 0; index < files.length; index++) {
    throwIfAborted(options.signal);
    const filePath = files[index];
    const relative = relativePath(directory, filePath);
    countExtension(relative, summary);

    const result = {
      path: relative,
      format: '',
      status: '',
      timedLines: 0,
      linesChanged: 0,
      notes: {},
      backup: null,
      backupKind: null,
      verified: null,
      error: null,
    };

    try {
      const snapshot = readLyrics(filePath, { strictFlacUtf8: true });
      result.format = snapshot.format;

      if (!snapshot.hasLyrics || !String(snapshot.text || '').trim()) {
        result.status = 'no-lyrics';
        summary.noLyrics++;
        results.push(result);
        continue;
      }

      const analysis = analyzeLyricsText(snapshot.text);
      result.timedLines = analysis.timedLines;
      result.linesChanged = analysis.changed;
      result.notes = analysis.notes;
      summary.linesTotal += analysis.timedLines;

      if (analysis.changed === 0) {
        result.status = 'already-ok';
        summary.alreadyOk++;
        results.push(result);
        continue;
      }

      if (!force && !hasChineseMarker(snapshot.text)) {
        result.status = 'skipped-no-translation';
        summary.skippedNoTranslation++;
        results.push(result);
        continue;
      }

      if (!apply) {
        result.status = 'would-change';
        summary.changed++;
        summary.linesChanged += analysis.changed;
        results.push(result);
        continue;
      }

      // The writer needs the complete container; previews never load audio.
      const loaded = loadLyricsFile(filePath);
      if (!loaded.hasLyrics) throw new Error('lyrics disappeared between read and write');
      const output = loaded.build(analysis.text);
      loaded.verify(output, analysis.text);

      if (backup) {
        const lrcPath = lrcBackupPath(filePath, backupContext);
        if (fs.existsSync(lrcPath)) {
          const existing = readLyrics(lrcPath, { strictFlacUtf8: false });
          if (existing.text !== snapshot.text) {
            throw new Error(
              `existing LRC backup differs from the current lyrics: ${relativeBackupPath(lrcPath, backupContext)}`,
            );
          }
          summary.backupsReused++;
          result.backup = relativeBackupPath(lrcPath, backupContext);
        } else {
          const backupPath = createLyricsBackup(filePath, backupContext, {
            text: snapshot.text,
            raw: extOf(filePath) === '.lrc',
          });
          const check = readLyrics(backupPath, { strictFlacUtf8: false });
          if (check.text !== snapshot.text) {
            throw new Error('backup verification failed: LRC lyrics do not match the original');
          }
          summary.backupsCreated++;
          result.backup = relativeBackupPath(backupPath, backupContext);
        }
        result.backupKind = 'lrc';
      }

      writeFileAtomic(filePath, output);

      const written = readLyrics(filePath, { strictFlacUtf8: true });
      if (!written.hasLyrics || written.text !== analysis.text) {
        throw new Error('verification failed: rewritten lyrics do not match the split text');
      }
      result.verified = true;
      result.status = 'changed';
      summary.changed++;
      summary.linesChanged += analysis.changed;
    } catch (error) {
      result.status = 'error';
      result.error = error && error.message ? error.message : String(error);
      summary.errors++;
    }

    results.push(result);
  }

  const shown = results.slice(0, FILE_RESULT_CAP);
  const report = {
    ok: summary.errors === 0,
    mode: summary.mode,
    directory,
    summary,
    files: shown,
  };
  if (shown.length < results.length) report.filesOmitted = results.length - shown.length;

  if (wantReview) {
    throwIfAborted(options.signal);
    const review = reviewDirectory({ directory, filter: 'flagged', limit: 20 });
    report.review = {
      summary: review.summary,
      lines: review.lines,
      linesMatched: review.linesMatched,
      truncated: review.truncated,
    };
  }

  return report;
}
