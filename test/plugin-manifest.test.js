// Bundle manifest and display-resource contract.
//
// Plugin Manager reads these files without activating the plugin, so a typo in
// an export, a missing `files` entry, or an invalid locale/icon path is not
// caught by the Host or Client tests.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const LOCALES = ['en', 'zh'];

test('manifest declares the Host plugin, the Client half, and the display resources', () => {
  assert.equal(MANIFEST.name, 'dsh-nihongo-lyrics-match');
  assert.equal(MANIFEST.type, 'module');
  assert.equal(MANIFEST.exports['.'], './index.js');
  assert.equal(MANIFEST.exports['./client'], './client.js');
  assert.equal(MANIFEST.exports['./icon'], './icon.svg');
  assert.equal(MANIFEST.exports['./locale/*.json'], './locale/*.json');
  assert.equal(MANIFEST.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(MANIFEST.dsh.client.platform, 'web');
  assert.equal(MANIFEST.dsh.client.immediately, true);
  for (const dependency of [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-settings-general',
    '@deepseek-ai/dsh-client-ui-workspace',
  ]) {
    assert.ok(MANIFEST.dsh.client.inject.includes(dependency), `client inject lists ${dependency}`);
  }

  const files = MANIFEST.files;
  for (const entry of ['index.js', 'client.js', 'cordis.patch.yml', 'lib', 'locale/*.json', 'docs', 'icon.svg']) {
    assert.ok(files.includes(entry), `files lists ${entry}`);
  }
  for (const entry of files) {
    if (entry.includes('*')) continue;
    assert.ok(fs.existsSync(path.join(ROOT, entry)), `packaged file exists: ${entry}`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'lib', 'web-api.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'client.js')));
});

test('locale metadata is valid JSON with a title, description, and existing detail document', () => {
  for (const language of LOCALES) {
    const file = path.join(ROOT, 'locale', `${language}.json`);
    const locale = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(typeof locale.meta.title, 'string');
    assert.ok(locale.meta.title.trim() !== '', `${language} title`);
    assert.equal(typeof locale.meta.description, 'string');
    assert.ok(locale.meta.description.includes('lyrics_convert'), `${language} description names the tools`);
    assert.match(locale.meta.detail, /^docs\/DETAIL(?:\.(?:en|zh))?\.md$/u, `${language} detail path`);
    const detail = path.join(ROOT, ...locale.meta.detail.split('/'));
    assert.ok(fs.existsSync(detail), `${language} detail document exists`);
    const document = fs.readFileSync(detail, 'utf8');
    assert.match(document, /^!\[[^\]]+\]\(preview\.svg\)$/mu, `${language} detail has the feature image`);
    assert.doesNotMatch(document, /does not add a Web UI panel/u, 'stale no-UI statement removed');
    assert.doesNotMatch(document, /不添加 Web 界面面板/u, 'stale no-UI statement removed');
  }
});

test('icon is a self-contained SVG within the icon budget', () => {
  const icon = fs.readFileSync(path.join(ROOT, 'icon.svg'));
  assert.ok(icon.length > 0 && icon.length <= 256 * 1024, 'icon size');
  const text = icon.toString('utf8');
  assert.match(text, /^<svg[^>]*width="36"[^>]*height="36"[^>]*viewBox="0 0 36 36"/u);
  assert.doesNotMatch(text, /<script|<style|foreignObject|<image/u);
});
