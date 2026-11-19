// Small filesystem helpers: backups and atomic replacement.

import fs from 'node:fs';

/**
 * Copy `filePath` to `<filePath>.bak` unless that backup already exists.
 * @param {string} filePath
 * @returns {{ path: string, created: boolean }}
 */
export function createBackup(filePath) {
  const backupPath = `${filePath}.bak`;
  if (fs.existsSync(backupPath)) {
    return { path: backupPath, created: false };
  }

  fs.copyFileSync(filePath, backupPath);
  try {
    const stat = fs.statSync(filePath);
    fs.utimesSync(backupPath, stat.atime, stat.mtime);
  } catch {
    // timestamps are a nicety, never a reason to fail
  }
  return { path: backupPath, created: true };
}

/**
 * Write `buffer` to a sibling temp file, fsync it, then rename over the target.
 * @param {string} filePath
 * @param {Buffer} buffer
 */
export function writeFileAtomic(filePath, buffer) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tempPath, 'w');
  try {
    fs.writeFileSync(fd, buffer);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore cleanup failure, original error is more useful
    }
    throw error;
  }
}
