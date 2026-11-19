// LRC lyric backups.
//
// A backup stores the original lyric text, not a copy of the audio container:
//   <library root>/.lyrics-backup/<relative dir>/<file name>.lrc
// The relative directory structure mirrors the music library. A `.lrc` source
// keeps its own file name; an audio source gets `<name>.wav.lrc` etc.
//
// Legacy `<file>.bak` backups (full file copies from older versions) are still
// found and can be restored byte-for-byte until they are migrated.

import fs from 'node:fs';
import path from 'node:path';

export const BACKUP_DIR_NAME = '.lyrics-backup';

/**
 * Find the backup folder for a music directory.
 *
 * If this directory or one of its ancestors already contains `.lyrics-backup`,
 * the nearest one is reused (so scanning a subdirectory keeps using the same
 * centralized backup tree). Otherwise a `.lyrics-backup` folder at the scanned
 * directory's root is proposed.
 *
 * @param {string} directory
 * @returns {{ base: string, backupRoot: string }}
 */
export function resolveBackupContext(directory) {
  const absolute = path.resolve(directory);
  let current = absolute;

  for (;;) {
    const candidate = path.join(current, BACKUP_DIR_NAME);
    try {
      if (fs.statSync(candidate).isDirectory()) {
        return { base: current, backupRoot: candidate };
      }
    } catch {
      // not here, keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return { base: absolute, backupRoot: path.join(absolute, BACKUP_DIR_NAME) };
}

/**
 * Backup file name for a source file.
 * - `song.wav`  -> `song.wav.lrc`
 * - `song.flac` -> `song.flac.lrc`
 * - `song.lrc`  -> `song.lrc` (the backup is itself an LRC file)
 *
 * @param {string} sourcePath
 * @returns {string}
 */
export function backupFileName(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  const name = path.basename(sourcePath);
  return extension === '.lrc' ? name : `${name}.lrc`;
}

/**
 * Canonical LRC backup path for a source file.
 * @param {string} sourcePath
 * @param {{ base: string, backupRoot: string }} context
 * @returns {string}
 */
export function lrcBackupPath(sourcePath, context) {
  const relative = path.relative(context.base, sourcePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`source is outside the backup root: ${sourcePath}`);
  }
  const relativeDirectory = path.dirname(relative);
  return path.join(
    context.backupRoot,
    relativeDirectory === '.' ? '' : relativeDirectory,
    backupFileName(sourcePath),
  );
}

/** Legacy full-file backup path created by older versions. */
export function legacyBackupPath(sourcePath) {
  return `${sourcePath}.bak`;
}

/**
 * Find the best available backup for a source file. LRC backups take priority
 * over legacy `.bak` copies.
 *
 * @param {string} sourcePath
 * @param {{ base: string, backupRoot: string }} context
 * @returns {{ kind: 'lrc'|'legacy', path: string } | null}
 */
export function findBackup(sourcePath, context) {
  const lrcPath = lrcBackupPath(sourcePath, context);
  if (fs.existsSync(lrcPath)) return { kind: 'lrc', path: lrcPath };
  const legacyPath = legacyBackupPath(sourcePath);
  if (fs.existsSync(legacyPath)) return { kind: 'legacy', path: legacyPath };
  return null;
}

/**
 * Path relative to the backup root's parent, for reports.
 * @param {string} backupPath
 * @param {{ base: string }} context
 */
export function relativeBackupPath(backupPath, context) {
  return path.relative(context.base, backupPath).split(path.sep).join('/');
}

/**
 * Create an LRC backup. Refuses to overwrite an existing backup.
 *
 * @param {string} sourcePath
 * @param {{ base: string, backupRoot: string }} context
 * @param {{ text?: string, raw?: boolean }} content
 * @returns {string} absolute backup path
 */
export function createLyricsBackup(sourcePath, context, content = {}) {
  const backupPath = lrcBackupPath(sourcePath, context);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });

  const buffer = content.raw
    ? fs.readFileSync(sourcePath)
    : Buffer.from(content.text ?? '', 'utf8');

  fs.writeFileSync(backupPath, buffer, { flag: 'wx' });
  return backupPath;
}
