// LRC text handling: parse timed lines, split merged JP+translation lines, and
// keep every other line (metadata, blank lines, comments) untouched.

import { splitLyricLine, stripSlashDelimiter, HAN_RE, KANA_RE } from './language.js';

// One or more leading time tags followed by the text, e.g.
//   [00:12.34]text
//   [00:12.34][01:23.45]text
const TIMED_LINE_RE = /^((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/;

export function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * @typedef {object} LyricTransform
 * @property {string} text  transformed text
 * @property {number} changed  number of source lines that were split
 * @property {number} timedLines  number of timestamped non-empty source lines
 * @property {Record<string, number>} notes  split reason -> count
 */

/**
 * Split every merged Japanese/translation line of a lyric text.
 * Lines that are already correct are returned unchanged, which makes the
 * operation idempotent.
 *
 * @param {string} text
 * @returns {LyricTransform}
 */
export function transformLyricsText(text) {
  const eol = detectEol(text);
  const sourceLines = text.split(/\r?\n/);
  const parsed = sourceLines.map((line) => {
    const match = TIMED_LINE_RE.exec(line);
    return match ? { line, timeTags: match[1], body: match[2] } : null;
  });
  const output = [];
  const notes = {};
  let changed = 0;
  let timedLines = 0;

  for (let index = 0; index < sourceLines.length; index++) {
    const current = parsed[index];
    if (!current) {
      output.push(sourceLines[index]);
      continue;
    }

    const { timeTags, body } = current;
    if (!body) {
      output.push(current.line);
      continue;
    }
    timedLines++;

    // Already-split files contain JP/ZH pairs that share a timestamp. Never
    // split those JP lines again, otherwise a Japanese line ending in a kanji
    // word (e.g. "…深呼吸" or "…今") would be mistaken for a merged line.
    const isJapanese = KANA_RE.test(body);
    if (isJapanese) {
      const sameTimestamp = (other) =>
        other && other.timeTags === timeTags && other.body && !KANA_RE.test(other.body) && HAN_RE.test(other.body);
      if (sameTimestamp(parsed[index + 1]) || sameTimestamp(parsed[index - 1])) {
        output.push(current.line);
        continue;
      }
    }

    const split = splitLyricLine(body);
    if (!split) {
      output.push(current.line);
      continue;
    }

    const slashCleaned = stripSlashDelimiter(split.zh);
    if (slashCleaned !== null) split.zh = slashCleaned;

    output.push(timeTags + split.jp);
    output.push(timeTags + split.zh);
    changed++;
    notes[split.reason] = (notes[split.reason] || 0) + 1;
  }

  return { text: output.join(eol), changed, timedLines, notes };
}

// ---------------------------------------------------------------------------
// Text buffer encoding helpers (for standalone .lrc files)
// ---------------------------------------------------------------------------

/**
 * @param {Buffer} buffer
 * @returns {{ text: string, encoding: 'utf8'|'utf16le'|'utf16be', bom: boolean }}
 */
export function decodeTextBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      text: buffer.subarray(2).toString('utf16le'),
      encoding: 'utf16le',
      bom: true,
    };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const raw = Buffer.from(buffer.subarray(2, 2 + ((buffer.length - 2) & ~1)));
    raw.swap16();
    return { text: raw.toString('utf16le'), encoding: 'utf16be', bom: true };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf8', bom: true };
  }
  return { text: buffer.toString('utf8'), encoding: 'utf8', bom: false };
}

/**
 * @param {string} text
 * @param {{ encoding: 'utf8'|'utf16le'|'utf16be', bom: boolean }} meta
 * @returns {Buffer}
 */
export function encodeTextBuffer(text, meta) {
  if (meta.encoding === 'utf16le') {
    const body = Buffer.from(text, 'utf16le');
    return meta.bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
  }
  if (meta.encoding === 'utf16be') {
    const body = Buffer.from(text, 'utf16le');
    body.swap16();
    return meta.bom ? Buffer.concat([Buffer.from([0xfe, 0xff]), body]) : body;
  }
  const body = Buffer.from(text, 'utf8');
  return meta.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}
