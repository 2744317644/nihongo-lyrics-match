// Directory scanning, path validation, and timed-line indexing shared by the
// Host tools. Everything here is read-only.

import fs from 'node:fs';
import path from 'node:path';

import { extOf } from './formats.js';
import { TIMED_LINE_RE } from './lrc.js';

/** Extensions the splitter handles. */
export const SUPPORTED_EXTS = new Set(['wav', 'mp3', 'flac', 'lrc']);

/**
 * Resolve and validate a caller-supplied directory.
 * @param {unknown} input
 * @returns {string} absolute directory path
 */
export function resolveDirectory(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('directory must be a non-empty path string');
  }
  const resolved = path.resolve(input);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`directory does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) throw new Error(`not a directory: ${resolved}`);
  return resolved;
}

/**
 * Stop a long directory walk when the caller cancels the tool call.
 * @param {AbortSignal | undefined} signal
 */
export function throwIfAborted(signal) {
  if (!signal || !signal.aborted) return;
  const error = new Error('the lyrics operation was cancelled');
  error.name = 'AbortError';
  throw error;
}

/** POSIX-style path relative to `root`, stable across platforms. */
export function relativePath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

/**
 * Walk a directory for supported audio/lyric files.
 * Symlinked directories are not followed; the walk stays inside `root`.
 *
 * @param {string} root absolute directory
 * @returns {string[]} absolute file paths, sorted
 */
export function collectFiles(root) {
  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === '.git'
          || entry.name === 'node_modules'
          || entry.name === '.lyrics-backup'
        ) continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.bak') || entry.name.includes('.tmp-')) continue;
      if (!SUPPORTED_EXTS.has(extOf(fullPath).replace(/^\./, ''))) continue;
      files.push(fullPath);
    }
  }

  return files.sort();
}

/**
 * Resolve one relative file path and keep it inside the reviewed directory.
 * @param {string} root absolute directory
 * @param {unknown} input relative (or absolute) file path
 * @returns {string} absolute file path
 */
export function resolveFile(root, input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('file must be a non-empty path string');
  }
  const candidate = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input);
  const rootReal = fs.realpathSync(root);
  let candidateReal;
  try {
    candidateReal = fs.realpathSync(candidate);
  } catch {
    throw new Error(`file does not exist: ${candidate}`);
  }
  const prefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
  if (candidateReal !== rootReal && !candidateReal.startsWith(prefix)) {
    throw new Error(`file must remain inside the directory: ${candidate}`);
  }
  const stat = fs.statSync(candidateReal);
  if (!stat.isFile()) throw new Error(`not a file: ${candidate}`);
  if (!SUPPORTED_EXTS.has(extOf(candidateReal).replace(/^\./, ''))) {
    throw new Error(`unsupported file type: ${path.basename(candidateReal)}`);
  }
  return candidateReal;
}

/**
 * Split lyric text into timed lines without interpreting them.
 * @param {string} text
 * @returns {{ index: number, line: string, timeTags: string, body: string }[]}
 */
export function parseTimedLines(text) {
  const lines = [];
  const sourceLines = text.split(/\r?\n/);
  for (let index = 0; index < sourceLines.length; index++) {
    const match = TIMED_LINE_RE.exec(sourceLines[index]);
    if (match) lines.push({ index, line: sourceLines[index], timeTags: match[1], body: match[2] });
  }
  return lines;
}

/**
 * Milliseconds of the first time tag in a tag group. Used only to detect a
 * broken timestamp sequence, never to rewrite tags.
 * @param {string} timeTags
 * @returns {number | null}
 */
export function timestampMs(timeTags) {
  const match = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(timeTags);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
  return minutes * 60000 + seconds * 1000 + Math.round(fraction * 1000);
}

/** Remove all whitespace; used for translation-length heuristics. */
export function cleanLength(text) {
  return text.replace(/\s/g, '').length;
}

/** Compare two string arrays for exact equality. */
export function sameList(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/**
 * Group parsed lines by their exact time-tag text, preserving order.
 * @param {{ timeTags: string, body: string }[]} timedLines
 * @returns {Map<string, string[]>}
 */
export function bodiesByTimestamp(timedLines) {
  const map = new Map();
  for (const line of timedLines) {
    const bodies = map.get(line.timeTags);
    if (bodies) bodies.push(line.body);
    else map.set(line.timeTags, [line.body]);
  }
  return map;
}

/**
 * Timestamps whose lyric line goes backwards in the current file.
 * @param {{ timeTags: string }[]} timedLines
 * @returns {Set<string>}
 */
export function brokenTimestamps(timedLines) {
  const broken = new Set();
  let previous = null;
  for (const line of timedLines) {
    const value = timestampMs(line.timeTags);
    if (value === null) continue;
    if (previous !== null && value < previous) broken.add(line.timeTags);
    previous = value;
  }
  return broken;
}
