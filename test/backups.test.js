import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BACKUP_DIR_NAME,
  backupFileName,
  lrcBackupPath,
  resolveBackupContext,
} from '../src/backups.js';
import { migrateBackups } from '../src/migrate.js';
import { buildWav } from './helpers.js';

const MERGED =
  '[00:00.00]作词 : Someone\r\n' +
  '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田\r\n';

test('resolves the backup root and mirrors the relative hierarchy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-backup-'));
  try {
    const context = resolveBackupContext(root);
    assert.equal(context.base, root);
    assert.equal(context.backupRoot, path.join(root, BACKUP_DIR_NAME));

    fs.mkdirSync(path.join(root, 'album'), { recursive: true });
    const wav = path.join(root, 'album', 'song.wav');
    fs.writeFileSync(wav, '');
    assert.equal(
      lrcBackupPath(wav, context),
      path.join(root, BACKUP_DIR_NAME, 'album', 'song.wav.lrc'),
    );

    const lrc = path.join(root, 'song.lrc');
    fs.writeFileSync(lrc, '');
    assert.equal(
      lrcBackupPath(lrc, context),
      path.join(root, BACKUP_DIR_NAME, 'song.lrc'),
    );
    assert.equal(backupFileName(lrc), 'song.lrc');

    // A subdirectory reuses the ancestor's backup root.
    fs.mkdirSync(path.join(root, BACKUP_DIR_NAME), { recursive: true });
    assert.deepEqual(resolveBackupContext(path.join(root, 'album')), {
      base: root,
      backupRoot: path.join(root, BACKUP_DIR_NAME),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migrates legacy .bak files to LRC backups and deletes them on apply', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-migrate-'));
  const album = path.join(root, 'album');
  const wav = path.join(album, 'song.wav');
  const lrc = path.join(root, 'song.lrc');

  try {
    fs.mkdirSync(album, { recursive: true });
    fs.writeFileSync(wav, buildWav({ usltText: MERGED }));
    fs.writeFileSync(`${wav}.bak`, buildWav({ usltText: MERGED }));
    fs.writeFileSync(lrc, MERGED, 'utf8');
    fs.writeFileSync(`${lrc}.bak`, MERGED, 'utf8');

    const preview = migrateBackups({ directory: root, apply: false });
    assert.equal(preview.summary.scanned, 2);
    assert.equal(preview.summary.created, 2);
    assert.equal(preview.summary.deleted, 0);
    assert.ok(!fs.existsSync(path.join(root, BACKUP_DIR_NAME)));
    assert.ok(fs.existsSync(`${wav}.bak`));

    const applied = migrateBackups({ directory: root, apply: true });
    assert.equal(applied.summary.created, 2);
    assert.equal(applied.summary.deleted, 2);
    assert.ok(applied.summary.bytesFreed > 0);
    assert.ok(!fs.existsSync(`${wav}.bak`));
    assert.ok(!fs.existsSync(`${lrc}.bak`));

    assert.equal(
      fs.readFileSync(path.join(root, BACKUP_DIR_NAME, 'album', 'song.wav.lrc'), 'utf8'),
      MERGED,
    );
    assert.equal(
      fs.readFileSync(path.join(root, BACKUP_DIR_NAME, 'song.lrc'), 'utf8'),
      MERGED,
    );

    // A second migration has nothing left to do.
    const again = migrateBackups({ directory: root, apply: true });
    assert.equal(again.summary.scanned, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migration keeps a .bak when an existing LRC backup disagrees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-migrate-'));
  const wav = path.join(root, 'song.wav');

  try {
    fs.writeFileSync(wav, buildWav({ usltText: MERGED }));
    fs.writeFileSync(`${wav}.bak`, buildWav({ usltText: MERGED }));
    const backupPath = path.join(root, BACKUP_DIR_NAME, 'song.wav.lrc');
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, 'different lyrics', 'utf8');

    const report = migrateBackups({ directory: root, apply: true });
    assert.equal(report.summary.errors, 1);
    assert.equal(report.summary.deleted, 0);
    assert.ok(fs.existsSync(`${wav}.bak`));
    assert.equal(fs.readFileSync(backupPath, 'utf8'), 'different lyrics');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
