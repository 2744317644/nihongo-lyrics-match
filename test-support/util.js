// Shared test utilities: owned temporary directories and file hashing.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lyrics-review-'));
}

/**
 * Run `fn` with a unique temporary directory that is always removed.
 * @template T
 * @param {(dir: string) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function withTempDir(fn) {
  const dir = makeTempDir();
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function writeFixture(dir, name, buffer) {
  const target = path.join(dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  return target;
}

export function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
