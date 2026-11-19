// Centralized LRC backup model: one `.lyrics-backup` tree per library, mirroring
// the music folders. Audio containers are never copied; only their lyric text
// is stored, so review and revert keep working without duplicating audio.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  BACKUP_DIR_NAME,
  backupFileName,
  createLyricsBackup,
  findBackup,
  legacyBackupPath,
  lrcBackupPath,
  relativeBackupPath,
  resolveBackupContext,
} from '../lib/backups.js';
import { collectFiles } from '../lib/scan.js';
import { withTempDir } from '../test-support/util.js';

test('resolves one backup root and mirrors the music hierarchy', async () => {
  await withTempDir(async (dir) => {
    const context = resolveBackupContext(dir);
    assert.equal(context.base, dir);
    assert.equal(context.backupRoot, path.join(dir, BACKUP_DIR_NAME));

    const album = path.join(dir, 'Artist', 'Album');
    fs.mkdirSync(album, { recursive: true });
    const audio = path.join(album, 'song.flac');
    const lrc = path.join(album, 'song.lrc');
    fs.writeFileSync(audio, Buffer.alloc(0));
    fs.writeFileSync(lrc, Buffer.alloc(0));

    assert.equal(
      lrcBackupPath(audio, context),
      path.join(dir, BACKUP_DIR_NAME, 'Artist', 'Album', 'song.flac.lrc'),
    );
    assert.equal(
      lrcBackupPath(lrc, context),
      path.join(dir, BACKUP_DIR_NAME, 'Artist', 'Album', 'song.lrc'),
    );
    assert.equal(backupFileName(lrc), 'song.lrc');
    assert.equal(backupFileName(audio), 'song.flac.lrc');
    assert.equal(
      relativeBackupPath(lrcBackupPath(audio, context), context),
      '.lyrics-backup/Artist/Album/song.flac.lrc',
    );

    // A subdirectory scan reuses the library's existing backup root.
    fs.mkdirSync(path.join(dir, BACKUP_DIR_NAME), { recursive: true });
    assert.deepEqual(resolveBackupContext(album), context);
  });
});

test('creates LRC backups only: LRC bytes stay raw, audio stores lyric text', async () => {
  await withTempDir(async (dir) => {
    const context = resolveBackupContext(dir);
    const album = path.join(dir, 'album');
    fs.mkdirSync(album, { recursive: true });

    const lrcSource = path.join(album, 'song.lrc');
    const lrcBytes = Buffer.from('\uFEFF[00:01.00]春空に残る淋しさ そっと\n', 'utf8');
    fs.writeFileSync(lrcSource, lrcBytes);
    const lrcBackup = createLyricsBackup(lrcSource, context, { text: 'ignored', raw: true });
    assert.deepEqual(fs.readFileSync(lrcBackup), lrcBytes, 'LRC backup is a byte copy of the source LRC');

    const audioSource = path.join(album, 'track.flac');
    fs.writeFileSync(audioSource, Buffer.from('not really audio'));
    const audioBackup = createLyricsBackup(audioSource, context, {
      text: '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田',
    });
    assert.equal(audioBackup, path.join(dir, BACKUP_DIR_NAME, 'album', 'track.flac.lrc'));
    assert.equal(
      fs.readFileSync(audioBackup, 'utf8'),
      '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田',
    );
    assert.equal(fs.existsSync(`${audioSource}.bak`), false, 'audio source is not duplicated');
    assert.deepEqual(
      fs.readdirSync(path.join(dir, BACKUP_DIR_NAME, 'album')).sort(),
      ['song.lrc', 'track.flac.lrc'],
      'one LRC file beside the LRC backup, no audio copy',
    );
    assert.throws(() => createLyricsBackup(audioSource, context, { text: 'again' }), /EEXIST/u);

    // The backup tree is not part of the music scan.
    assert.deepEqual(collectFiles(dir).map((file) => path.relative(dir, file).split(path.sep).join('/')), [
      'album/song.lrc',
      'album/track.flac',
    ]);
  });
});

test('finds the nearest backup: LRC first, legacy .bak otherwise', async () => {
  await withTempDir(async (dir) => {
    const context = resolveBackupContext(dir);
    const source = path.join(dir, 'song.lrc');
    fs.writeFileSync(source, '[00:01.00]merged\n');

    assert.equal(findBackup(source, context), null);

    fs.writeFileSync(legacyBackupPath(source), '[00:01.00]legacy\n');
    assert.deepEqual(findBackup(source, context), { kind: 'legacy', path: legacyBackupPath(source) });

    createLyricsBackup(source, context, { text: '[00:01.00]lrc backup\n' });
    assert.deepEqual(findBackup(source, context), {
      kind: 'lrc',
      path: lrcBackupPath(source, context),
    });
  });
});
