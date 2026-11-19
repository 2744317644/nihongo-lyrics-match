// Client bundle contract test.
//
// The browser half is hand-authored in the module-loader format, so this test
// executes its factory in a Node VM with a fake `window.__ModuleLoader__` and a
// minimal React, then checks the exact slot registration, the locale
// dictionaries, and effect disposal. It cannot prove rendering; installing and
// the live Slot inspection cover that separately.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client.js');
const SOURCE = fs.readFileSync(CLIENT, 'utf8');

function loadClient() {
  let registration;
  const fakeWindow = {
    __ModuleLoader__: {
      load(value) {
        registration = value;
      },
    },
  };
  const sandbox = {
    window: fakeWindow,
    console,
  };
  vm.runInNewContext(SOURCE, sandbox, { filename: CLIENT });
  assert.ok(registration, 'client.js must register a module factory');
  const fakeReact = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const flat = [];
      const push = (value) => {
        if (Array.isArray(value)) value.forEach(push);
        else if (value !== null && value !== undefined && value !== false) flat.push(value);
      };
      children.forEach(push);
      return { type, props: { ...(props || {}), children: flat } };
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useEffect() {},
    useRef(value) {
      return { current: value };
    },
  };
  const plugin = registration.factory((request) => {
    assert.equal(request, 'react');
    return fakeReact;
  });
  return { registration, plugin, fakeReact };
}

test('client module registers the package id and the settings.section slot', () => {
  const { registration, plugin } = loadClient();
  assert.equal(registration.id, 'dsh-nihongo-lyrics-match');
  assert.deepEqual([...plugin.inject], ['slots', 'locale']);

  const effects = [];
  const registered = [];
  const dictionaries = { zh: {}, en: {} };
  let active = 'zh';
  const locale = {
    register(namespace, language, dictionary) {
      assert.equal(namespace, 'lyricsReview');
      assert.ok(Object.keys(dictionaries).includes(language));
      assert.equal(dictionaries[language] === undefined, false);
      dictionaries[language] = dictionary;
      return () => {};
    },
    bind(namespace) {
      assert.equal(namespace, 'lyricsReview');
      return (key) => dictionaries[active][key] ?? key;
    },
    subscribe() {
      return () => {};
    },
  };
  const ctx = {
    get(name) {
      assert.equal(name, 'uiWorkspace');
      return undefined;
    },
    effect(callback) {
      const dispose = callback();
      effects.push(dispose);
      return dispose;
    },
    locale,
    slots: {
      inject(key, callback) {
        assert.equal(key, 'settings.section');
        return callback();
      },
      register(options, component) {
        registered.push({ options, component });
        return () => {};
      },
    },
  };

  plugin.apply(ctx);
  assert.equal(registered.length, 1);
  const { options } = registered[0];
  assert.equal(options.name, 'settings.section');
  assert.equal(options.id, 'nihongo-lyrics-match');
  assert.equal(typeof options.order, 'number');
  assert.equal(options.locale, 'lyricsReview');
  assert.equal(typeof options.label, 'function');
  assert.equal(typeof registered[0].component, 'function');

  assert.equal(options.label(), '歌词匹配');
  active = 'en';
  assert.equal(options.label(), 'Lyrics match');

  const injected = options.inject();
  assert.equal(typeof injected.subscribeLocale, 'function');
  assert.equal(injected.pickDirectory, undefined, 'no workspace picker without the service');

  for (const dispose of effects) {
    if (typeof dispose === 'function') dispose();
  }
});

test('client dictionaries are complete, balanced, and non-empty', () => {
  const effects = [];
  const captured = {};
  const locale = {
    register(namespace, language, dictionary) {
      captured[language] = dictionary;
      return () => {};
    },
    bind() {
      return (key) => key;
    },
    subscribe() {
      return () => {};
    },
  };
  const plugin = loadClient().plugin;
  plugin.apply({
    get() {
      return undefined;
    },
    effect(callback) {
      const dispose = callback();
      effects.push(dispose);
      return dispose;
    },
    locale,
    slots: {
      inject(_key, callback) {
        return callback();
      },
      register() {
        return () => {};
      },
    },
  });

  assert.deepEqual(Object.keys(captured).sort(), ['en', 'zh']);
  const enKeys = Object.keys(captured.en).sort();
  const zhKeys = Object.keys(captured.zh).sort();
  assert.deepEqual(zhKeys, enKeys, 'en and zh expose the same keys');
  assert.ok(enKeys.length >= 40, `expected a complete UI dictionary, got ${enKeys.length} keys`);
  for (const language of ['en', 'zh']) {
    for (const [key, value] of Object.entries(captured[language])) {
      assert.equal(typeof value, 'string', `${language}.${key} is a string`);
      assert.ok(value.trim() !== '', `${language}.${key} is not empty`);
    }
  }
  for (const dispose of effects) {
    if (typeof dispose === 'function') dispose();
  }
});

test('client bundle is self-contained: no static imports or Harness package requests', () => {
  assert.doesNotMatch(SOURCE, /^\s*import\s/mu);
  assert.equal([...SOURCE.matchAll(/window\.__ModuleLoader__\.load\(/gu)].length, 1, 'exactly one module registration');
  const requires = [...SOURCE.matchAll(/require\((['"])([^'"]+)\1\)/gu)].map((match) => match[2]);
  assert.deepEqual([...new Set(requires)], ['react']);
  assert.doesNotMatch(SOURCE, /@deepseek-ai\/dsh-client/u);
  assert.doesNotMatch(SOURCE, /document\.body/u);
  assert.match(SOURCE, /--dsw-alias-/u, 'panel styles use theme tokens');
  const css = SOURCE.slice(SOURCE.indexOf('const CSS = `'), SOURCE.indexOf('`;', SOURCE.indexOf('const CSS = `')));
  assert.ok(css.length > 1000, 'the panel ships its stylesheet');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/iu, 'no literal hex colors in the stylesheet');
  assert.doesNotMatch(css, /\b(?:rgba?|hsla?)\(/u, 'no literal rgb/hsl colors in the stylesheet');
  assert.doesNotMatch(css, /color:\s*(?:white|black)\b/u, 'no literal color names');
});

/** @param {unknown} node @returns {string} */
function collectText(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  if (node.props && Array.isArray(node.props.children)) return node.props.children.map(collectText).join(' ');
  return '';
}

test('panel renders its idle surface without throwing (render smoke, not visual verification)', () => {
  const { plugin } = loadClient();
  const registered = [];
  const locale = {
    register() {
      return () => {};
    },
    bind() {
      return (key) => key;
    },
    subscribe() {
      return () => {};
    },
  };
  plugin.apply({
    get() {
      return undefined;
    },
    effect(callback) {
      return callback();
    },
    locale,
    slots: {
      inject(_key, callback) {
        return callback();
      },
      register(options, component) {
        registered.push({ options, component });
        return () => {};
      },
    },
  });
  assert.equal(registered.length, 1);
  const Panel = registered[0].component;
  assert.equal(typeof Panel, 'function');

  const propsBase = {
    t: (key) => key,
    pickDirectory: undefined,
    subscribeLocale: () => () => {},
    close: () => {},
  };
  const tree = Panel(propsBase);
  assert.equal(tree.type, 'div');
  assert.equal(tree.props['data-lyrics-review-panel'], 'true');
  const text = collectText(tree);
  assert.match(text, /title/);
  assert.match(text, /idleTitle/);
  assert.match(text, /scan/);

  // The t seat may be absent on an unexpected composition; the panel still renders.
  const fallback = Panel({ pickDirectory: undefined, subscribeLocale: () => () => {} });
  assert.equal(fallback.type, 'div');
  assert.match(collectText(fallback), /title/);
});
