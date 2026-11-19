// Revert engine: restore the original lyrics from the centralized LRC backup
// (`.lyrics-backup`) or, for files not migrated yet, from a legacy `<file>.bak`
// full-file copy. Read-only for every file without a backup.

import fs from 'node:fs';
import path from 'node:path';

import {
  findBackup,
  relativeBackupPath,
  resolveBackupContext,
} from './backups.js';
import { writeFileAtomic } from './fileops.js';
import { loadLyricsFile } from './formats.js';
import { readLyrics } from './lyrics-source.js';
import { collectFiles, relativePath } from './scan.js';

/**
 * Restore one file from an LRC backup.
 * - A `.lrc` source copies the raw backup file (byte-identical restore).
 * - An audio source rewrites only the lyric tag; audio/cover bytes are kept.
 *
 * @param {string} filePath
 * @param {string} backupPath
 */
function restoreFromLrc(filePath, backupPath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.lrc') {
    const backupBuffer = fs.readFileSync(backupPath);
    writeFileAtomic(filePath, backupBuffer);
    const restored = fs.readFileSync(filePath);
    if (!restored.equals(backupBuffer)) {
      throw new Error('verification failed: restored LRC bytes differ from the backup');
    }
    return { kind: 'lrc-copy', bytes: backupBuffer.length, verified: true };
  }

  const backupSnapshot = readLyrics(backupPath, { strictFlacUtf8: false });
  if (!backupSnapshot.hasLyrics) throw new Error('LRC backup has no lyrics');
  const loaded = loadLyricsFile(filePath);
  if (!loaded.hasLyrics) {
    throw new Error('current file has no lyric tag to restore');
  }
  const output = loaded.build(backupSnapshot.text);
  loaded.verify(output, backupSnapshot.text);
  writeFileAtomic(filePath, output);

  const written = readLyrics(filePath, { strictFlacUtf8: false });
  if (!written.hasLyrics || written.text !== backupSnapshot.text) {
    throw new Error('verification failed: restored lyrics do not match the LRC backup');
  }
  return { kind: 'lrc-rewrite', bytes: output.length, verified: true };
}

/**
 * Restore one file from a legacy full-file `.bak` copy.
 * @param {string} filePath
 * @param {string} backupPath
 */
function restoreFromLegacy(filePath, backupPath) {
  const backupBuffer = fs.readFileSync(backupPath);
  writeFileAtomic(filePath, backupBuffer);
  const restored = fs.readFileSync(filePath);
  return {
    kind: 'legacy-copy',
    bytes: backupBuffer.length,
    verified: restored.equals(backupBuffer),
  };
}

/**
 * @param {{ path: string, confirm: boolean, signal?: AbortSignal }} options
 */
export function revertPath(options) {
  if (options.confirm !== true) {
    throw new Error('lyrics_revert requires confirm: true: it overwrites current files with their original lyrics');
  }
  if (typeof options.path !== 'string' || options.path.trim() === '') {
    throw new Error('path must be a non-empty path string');
  }

  const target = path.resolve(options.path);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new Error(`path does not exist: ${target}`);
  }

  const restored = [];
  const skipped = [];
  const errors = [];
  const LIST_CAP = 500;
  let skippedTotal = 0;
  let mode;
  let root;

  /**
   * @param {string} filePath
   * @param {string} backupPath
   * @param {'lrc'|'legacy'} kind
   * @param {string} relative
   * @param {string} backupDisplay
   */
  const restore = (filePath, backupPath, kind, relative, backupDisplay) => {
    try {
      const result = kind === 'lrc'
        ? restoreFromLrc(filePath, backupPath)
        : restoreFromLegacy(filePath, backupPath);
      if (restored.length < LIST_CAP) {
        restored.push({
          path: relative,
          backup: backupDisplay,
          backupKind: kind,
          kind: result.kind,
          bytes: result.bytes,
          verified: result.verified,
        });
      }
    } catch (error) {
      errors.push({
        path: relative,
        error: error && error.message ? error.message : String(error),
      });
    }
  };

  // Explicit legacy path: `song.wav.bak` always restores that `.bak`.
  if (target.toLowerCase().endsWith('.bak')) {
    mode = 'file';
    const original = target.slice(0, -4);
    root = path.dirname(original);
    const relative = relativePath(root, original);
    try {
      const result = restoreFromLegacy(original, target);
      restored.push({
        path: relative,
        backup: `${relative}.bak`,
        backupKind: 'legacy',
        kind: result.kind,
        bytes: result.bytes,
        verified: result.verified,
      });
    } catch (error) {
      errors.push({ path: relative, error: error && error.message ? error.message : String(error) });
    }
  } else if (stat.isDirectory()) {
    mode = 'directory';
    root = target;
    const context = resolveBackupContext(target);
    const files = collectFiles(target);
    for (const filePath of files) {
      if (options.signal && options.signal.aborted) throw new Error('the lyrics operation was cancelled');
      const relative = relativePath(root, filePath);
      const backup = findBackup(filePath, context);
      if (!backup) {
        skippedTotal++;
        if (skipped.length < LIST_CAP) skipped.push({ path: relative, reason: 'no LRC backup or .bak' });
        continue;
      }
      restore(
        filePath,
        backup.path,
        backup.kind,
        relative,
        relativeBackupPath(backup.path, context),
      );
    }
  } else if (stat.isFile()) {
    mode = 'file';
    root = path.dirname(target);
    const context = resolveBackupContext(root);
    const relative = relativePath(root, target);
    const backup = findBackup(target, context);
    if (!backup) {
      skippedTotal++;
      skipped.push({ path: relative, reason: 'no LRC backup or .bak' });
    } else {
      restore(
        target,
        backup.path,
        backup.kind,
        relative,
        relativeBackupPath(backup.path, context),
      );
    }
  } else {
    throw new Error(`not a file or directory: ${target}`);
  }

  const result = {
    ok: errors.length === 0,
    mode,
    path: target,
    counts: {
      restored: restored.length,
      skipped: skippedTotal,
      errors: errors.length,
    },
    restored,
    skipped,
    errors,
  };
  if (skippedTotal > skipped.length) result.skippedOmitted = skippedTotal - skipped.length;
  return result;
}
