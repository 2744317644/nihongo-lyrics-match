import test from 'node:test';
import assert from 'node:assert/strict';

import { findId3Chunk, hashWavPayload, parseWav, replaceChunkData } from '../src/wav.js';
import { buildWav } from './helpers.js';

test('parses a RIFF/WAVE file and locates the id3 chunk', () => {
  const wav = buildWav({ usltText: '[00:01.00]日本語 中文' });
  const parsed = parseWav(wav);
  assert.deepEqual(
    parsed.chunks.map((c) => c.id),
    ['fmt ', 'data', 'id3 '],
  );
  assert.ok(findId3Chunk(parsed));

  for (const c of parsed.chunks) {
    assert.equal(wav.readUInt32LE(c.start + 4), c.size);
  }
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
});

test('replacing the id3 chunk keeps the audio chunk byte-identical', () => {
  const wav = buildWav({
    usltText: '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田',
  });
  const parsed = parseWav(wav);
  const id3Chunk = findId3Chunk(parsed);
  const beforeHash = hashWavPayload(wav, parsed, id3Chunk);

  const newData = Buffer.concat([Buffer.from('ID3', 'latin1')]);
  const rewritten = replaceChunkData(wav, parsed, id3Chunk, newData);
  const reparsed = parseWav(rewritten);
  const newId3Chunk = findId3Chunk(reparsed);

  const afterHash = hashWavPayload(rewritten, reparsed, newId3Chunk);
  assert.equal(beforeHash, afterHash);
  assert.equal(rewritten.readUInt32LE(4), rewritten.length - 8);

  const dataChunkBefore = parsed.chunks.find((c) => c.id === 'data');
  const dataChunkAfter = reparsed.chunks.find((c) => c.id === 'data');
  assert.ok(
    wav
      .subarray(dataChunkBefore.dataStart, dataChunkBefore.dataEnd)
      .equals(rewritten.subarray(dataChunkAfter.dataStart, dataChunkAfter.dataEnd)),
  );
});
