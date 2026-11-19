// Host web-API tests: parameter validation, trust checks, read-only review,
// and a temporary-copy revert through the real HTTP route table.

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { convertDirectory } from '../lib/convert.js';
import {
  REVIEW_ROUTE,
  REVERT_ROUTE,
  WebApiError,
  installReviewApi,
  reviewRequest,
  revertRequest,
} from '../lib/web-api.js';
import { sha256File, withTempDir } from '../test-support/util.js';

const LYRICS = [
  '[00:01.00]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田',
  '[00:02.00]きれいな世界 美丽的世界',
  '[00:03.00]心做し (COVER版) - 鹿乃',
  '',
].join('\n');

/** @param {string} dir */
function writeLyrics(dir) {
  const file = `${dir}/song.lrc`;
  fs.writeFileSync(file, LYRICS, 'utf8');
  return file;
}

function fakeWebServer() {
  return {
    routes: new Map(),
    register(route) {
      this.routes.set(route.path, route);
      return () => this.routes.delete(route.path);
    },
  };
}

async function withHttpServer(fn) {
  const webServer = fakeWebServer();
  const dispose = installReviewApi(webServer);
  const server = http.createServer((req, res) => {
    const pathname = (req.url || '').split('?')[0];
    const route = webServer.routes.get(pathname);
    if (!route) {
      res.writeHead(404);
      res.end();
      return;
    }
    route.handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    return await fn({ port, webServer });
  } finally {
    dispose();
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * @param {number} port
 * @param {string} path
 * @param {{ method?: string, body?: unknown, raw?: string, origin?: string | false, headers?: Record<string, string> }} options
 */
function request(port, path, options = {}) {
  const method = options.method || 'POST';
  const payload = options.raw !== undefined
    ? options.raw
    : options.body === undefined ? undefined : JSON.stringify(options.body);
  const headers = { ...(options.headers || {}) };
  if (payload !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(payload));
  }
  const origin = options.origin === false ? undefined : options.origin || `http://127.0.0.1:${port}`;
  if (origin !== undefined) headers.origin = origin;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

test('reviewRequest returns the canonical review shape and accepts filters', async () => {
  await withTempDir(async (dir) => {
    writeLyrics(dir);
    convertDirectory({ directory: dir, apply: true });

    const flagged = reviewRequest({ directory: dir });
    assert.equal(flagged.ok, true);
    assert.equal(flagged.filter, 'flagged');
    assert.equal(flagged.limit, 100);
    assert.equal(flagged.summary.pairs, 2);
    assert.equal(flagged.summary.titleLines, 1);
    assert.ok(flagged.files.length > 0);
    assert.ok(Array.isArray(flagged.lines));

    const all = reviewRequest({ directory: dir, filter: 'all', limit: 1 });
    assert.equal(all.filter, 'all');
    assert.equal(all.linesReturned, 1);
    assert.equal(all.truncated, true);
    assert.ok(all.linesMatched >= 2);
    assert.equal(typeof all.hint, 'string');

    const one = reviewRequest({ directory: dir, file: 'song.lrc', filter: 'all' });
    assert.equal(one.summary.filesScanned, 1);
    assert.equal(one.summary.pairs, 2);
  });
});

test('reviewRequest rejects invalid parameters with a 400 WebApiError', async () => {
  await withTempDir(async (dir) => {
    writeLyrics(dir);
    const cases = [
      [{}, /directory is required/],
      [{ directory: '' }, /directory must be a non-empty string/],
      [{ directory: `${dir}/missing` }, /does not exist/],
      [{ directory: dir, file: '../outside.lrc' }, /inside the directory|does not exist/],
      [{ directory: dir, filter: 'other' }, /filter must be/],
      [{ directory: dir, limit: 0 }, /limit must be/],
      [{ directory: dir, limit: 1.5 }, /limit must be/],
    ];
    for (const [body, expected] of cases) {
      assert.throws(
        () => reviewRequest(body),
        (error) => error instanceof WebApiError && error.status === 400 && expected.test(error.message),
        JSON.stringify(body),
      );
    }
    assert.throws(() => reviewRequest(null), WebApiError);
    assert.throws(() => reviewRequest([]), WebApiError);
  });
});

test('reviewRequest is read-only: no writes, no backup, unchanged hash and mtime', async () => {
  await withTempDir(async (dir) => {
    const file = writeLyrics(dir);
    const before = sha256File(file);
    const mtimeBefore = fs.statSync(file).mtimeMs;

    reviewRequest({ directory: dir, filter: 'all', limit: 1000 });
    reviewRequest({ directory: dir, file: 'song.lrc' });

    assert.equal(sha256File(file), before);
    assert.equal(fs.statSync(file).mtimeMs, mtimeBefore);
    assert.equal(fs.existsSync(`${file}.bak`), false);
  });
});

test('revertRequest restores one file from its LRC backup and keeps the backup', async () => {
  await withTempDir(async (dir) => {
    const file = writeLyrics(dir);
    const originalHash = sha256File(file);
    const backup = path.join(dir, '.lyrics-backup', 'song.lrc');

    const applied = convertDirectory({ directory: dir, apply: true });
    assert.equal(applied.summary.changed, 1);
    assert.notEqual(sha256File(file), originalHash);
    assert.equal(fs.existsSync(backup), true);
    assert.equal(fs.existsSync(`${file}.bak`), false);
    const backupHash = sha256File(backup);

    const result = revertRequest({ directory: dir, file: 'song.lrc', confirm: true });
    assert.equal(result.ok, true);
    assert.equal(result.counts.restored, 1);
    assert.equal(result.restored[0].verified, true);
    assert.equal(result.restored[0].backupKind, 'lrc');
    assert.equal(sha256File(file), originalHash);
    assert.equal(sha256File(backup), backupHash, 'revert keeps the LRC backup unchanged');

    const after = reviewRequest({ directory: dir });
    assert.equal(after.summary.manualEdits, 1, 'an unsplit file reads as a manual edit after revert');
  });
});

test('revertRequest requires confirm: true and stays inside the directory', async () => {
  await withTempDir(async (dir) => {
    writeLyrics(dir);
    assert.throws(() => revertRequest({ directory: dir, file: 'song.lrc' }), WebApiError);
    assert.throws(() => revertRequest({ directory: dir, file: 'song.lrc', confirm: false }), WebApiError);
    assert.throws(() => revertRequest({ directory: dir, file: '../outside.lrc', confirm: true }), WebApiError);
  });
});

test('HTTP routes: same-origin JSON contract, method and content-type checks', async () => {
  await withTempDir(async (dir) => {
    writeLyrics(dir);
    await withHttpServer(async ({ port }) => {
      const ok = await request(port, REVIEW_ROUTE, { body: { directory: dir } });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.ok, true);
      assert.match(String(ok.headers['content-type']), /^application\/json/);
      assert.equal(ok.headers['cache-control'], 'no-store');
      assert.equal(ok.headers['x-content-type-options'], 'nosniff');

      const foreignOrigin = await request(port, REVIEW_ROUTE, {
        body: { directory: dir },
        origin: 'http://example.com',
      });
      assert.equal(foreignOrigin.status, 403);

      const noOrigin = await request(port, REVIEW_ROUTE, { body: { directory: dir }, origin: false });
      assert.equal(noOrigin.status, 200, 'Desktop file:// pages reach the route without an Origin header');
      assert.equal(noOrigin.json.ok, true);

      const nullOrigin = await request(port, REVIEW_ROUTE, { body: { directory: dir }, origin: 'null' });
      assert.equal(nullOrigin.status, 200, 'an opaque file:// origin is accepted on the loopback route');

      const rebinding = await request(port, REVIEW_ROUTE, {
        body: { directory: dir },
        origin: `http://attacker.example:${port}`,
        headers: { host: `attacker.example:${port}` },
      });
      assert.equal(rebinding.status, 403);

      const wrongMethod = await request(port, REVIEW_ROUTE, { method: 'GET', origin: false });
      assert.equal(wrongMethod.status, 405);
      assert.equal(wrongMethod.headers.allow, 'POST');

      const wrongType = await request(port, REVIEW_ROUTE, {
        raw: JSON.stringify({ directory: dir }),
        headers: { 'content-type': 'text/plain' },
      });
      assert.equal(wrongType.status, 415);

      const badJson = await request(port, REVIEW_ROUTE, { raw: 'not json' });
      assert.equal(badJson.status, 400);
      assert.match(badJson.json.error, /not valid JSON/);

      const badParams = await request(port, REVIEW_ROUTE, { body: { directory: dir, filter: 'nope' } });
      assert.equal(badParams.status, 400);
      assert.match(badParams.json.error, /filter must be/);
    });
  });
});

test('HTTP route revert restores a temporary copy through the endpoint', async () => {
  await withTempDir(async (dir) => {
    const file = writeLyrics(dir);
    const originalHash = sha256File(file);
    convertDirectory({ directory: dir, apply: true });
    assert.notEqual(sha256File(file), originalHash);

    await withHttpServer(async ({ port }) => {
      const refused = await request(port, REVERT_ROUTE, {
        body: { directory: dir, file: 'song.lrc', confirm: false },
      });
      assert.equal(refused.status, 400);
      assert.match(refused.json.error, /confirm must be true/);

      const escaped = await request(port, REVERT_ROUTE, {
        body: { directory: dir, file: '../song.lrc', confirm: true },
      });
      assert.equal(escaped.status, 400);

      const restored = await request(port, REVERT_ROUTE, {
        body: { directory: dir, file: 'song.lrc', confirm: true },
        origin: false,
      });
      assert.equal(restored.status, 200, 'restore also works through a Desktop bridge without Origin');
      assert.equal(restored.json.counts.restored, 1);
      assert.equal(restored.json.restored[0].verified, true);
      assert.equal(restored.json.restored[0].backupKind, 'lrc');
      assert.equal(sha256File(file), originalHash);
      assert.equal(fs.existsSync(path.join(dir, '.lyrics-backup', 'song.lrc')), true);
      assert.equal(fs.existsSync(`${file}.bak`), false);
    });
  });
});

test('installReviewApi registers exactly two routes and disposal removes them', async () => {
  const webServer = fakeWebServer();
  const dispose = installReviewApi(webServer);
  assert.deepEqual([...webServer.routes.keys()].sort(), [REVIEW_ROUTE, REVERT_ROUTE].sort());
  dispose();
  assert.equal(webServer.routes.size, 0);

  await withTempDir(async (dir) => {
    writeLyrics(dir);
    await withHttpServer(async ({ port, webServer: routes }) => {
      routes.routes.clear();
      const missing = await request(port, REVIEW_ROUTE, { body: { directory: dir } });
      assert.equal(missing.status, 404);
    });
  });
});
