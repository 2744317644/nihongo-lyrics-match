// Migrate legacy `<file>.bak` full-file backups to centralized LRC backups.
//
// For every `<file>.bak` under the directory:
//   - read the original lyrics from the .bak container;
//   - write `<library>/.lyrics-backup/<relative dir>/<file>.lrc`;
//   - verify the LRC text, then delete the .bak unless --keep-bak.
//
// Preview is the default; nothing is written or deleted without --apply.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  lrcBackupPath,
  resolveBackupContext,
  relativeBackupPath,
} from './backups.js';
import { readLyrics } from './lyrics-source.js';

const SUPPORTED = new Set(['.wav', '.mp3', '.flac', '.lrc']);

/** @param {string} text */
function hashText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function collectBakFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.lyrics-backup') continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.toLowerCase().endsWith('.bak')) files.push(full);
    }
  }
  return files.sort();
}

/**
 * @param {string} directory
 * @param {string} absolute
 */
function displayRelative(directory, absolute) {
  return path.relative(directory, absolute).split(path.sep).join('/');
}

/**
 * @param {{ directory: string, apply?: boolean, keepBak?: boolean,
 *   signal?: AbortSignal }} options
 */
export function migrateBackups(options) {
  const root = path.resolve(options.directory);
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    throw new Error(`directory does not exist: ${root}`);
  }
  if (!stat.isDirectory()) throw new Error(`not a directory: ${root}`);

  const apply = options.apply === true;
  const keepBak = options.keepBak === true;
  const context = resolveBackupContext(root);
  const files = collectBakFiles(root);

  const results = [];
  const summary = {
    mode: apply ? 'apply' : 'preview',
    directory: root,
    backupRoot: context.backupRoot,
    scanned: files.length,
    created: 0,
    reused: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
    bytesFreed: 0,
  };

  for (const bakPath of files) {
    if (options.signal && options.signal.aborted) throw new Error('migration cancelled');
    const original = bakPath.slice(0, -4);
    const result = {
      original: displayRelative(root, original),
      bak: displayRelative(root, bakPath),
      backup: '',
      status: '',
      lyricsHash: null,
      bytes: 0,
      error: null,
    };

    try {
      const extension = path.extname(original).toLowerCase();
      if (!SUPPORTED.has(extension)) {
        result.status = 'skipped';
        result.error = `unsupported source type: ${extension || '(none)'}`;
        summary.skipped++;
        results.push(result);
        continue;
      }
      if (!fs.existsSync(original)) {
        result.status = 'skipped';
        result.error = 'original file does not exist';
        summary.skipped++;
        results.push(result);
        continue;
      }

      const backupPath = lrcBackupPath(original, context);
      result.backup = relativeBackupPath(backupPath, context);
      const backupStat = fs.existsSync(backupPath) ? fs.statSync(backupPath) : null;

      const snapshot = readLyrics(bakPath, { strictFlacUtf8: false });
      if (!snapshot.hasLyrics) {
        result.status = 'skipped';
        result.error = 'backup has no lyrics';
        summary.skipped++;
        results.push(result);
        continue;
      }

      const lyrics = snapshot.text;
      result.lyricsHash = hashText(lyrics);

      if (backupStat) {
        const existing = readLyrics(backupPath, { strictFlacUtf8: false });
        if (existing.text !== lyrics) {
          throw new Error('an LRC backup already exists with different lyrics');
        }
        result.status = 'reused';
        summary.reused++;
      } else {
        if (apply) {
          fs.mkdirSync(path.dirname(backupPath), { recursive: true });
          if (extension === '.lrc') {
            fs.writeFileSync(backupPath, fs.readFileSync(bakPath), { flag: 'wx' });
          } else {
            fs.writeFileSync(backupPath, Buffer.from(lyrics, 'utf8'), { flag: 'wx' });
          }
          const verify = readLyrics(backupPath, { strictFlacUtf8: false });
          if (verify.text !== lyrics) {
            throw new Error('verification failed: written LRC does not match the backup lyrics');
          }
        }
        result.status = 'created';
        summary.created++;
      }

      result.bytes = fs.statSync(bakPath).size;

      if (apply && !keepBak) {
        fs.rmSync(bakPath);
        result.status = 'migrated';
        summary.deleted++;
        summary.bytesFreed += result.bytes;
      }
    } catch (error) {
      result.status = 'error';
      result.error = error && error.message ? error.message : String(error);
      summary.errors++;
    }

    results.push(result);
  }

  return { ok: summary.errors === 0, summary, files: results };
}
