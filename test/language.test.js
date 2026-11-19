import test from 'node:test';
import assert from 'node:assert/strict';

import { splitLyricLine } from '../src/language.js';

test('splits a standard merged line at the translation boundary', () => {
  const result = splitLyricLine(
    '春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田',
  );
  assert.deepEqual(result, {
    jp: '春空に残る淋しさ そっと心を濡らした',
    zh: '春雨后留下的空寂轻轻沾湿心田',
    reason: 'standard',
  });
});

test('keeps the full translation when the translation itself contains spaces', () => {
  const result = splitLyricLine(
    '心配ごと 少し重い でもね きっと大丈夫 顾虑虽有些放不下 但一定没有大碍',
  );
  assert.equal(result.jp, '心配ごと 少し重い でもね きっと大丈夫');
  assert.equal(result.zh, '顾虑虽有些放不下 但一定没有大碍');
});

test('never splits credit lines', () => {
  assert.equal(splitLyricLine('作词 : Shihori'), null);
  assert.equal(splitLyricLine('Drums : 玉田豊夢'), null);
  assert.equal(splitLyricLine('Lyrics : Someone'), null);
});

test('leaves Japanese-only lines alone', () => {
  assert.equal(splitLyricLine('もう迷わない 夢見た空へ'), null);
  assert.equal(splitLyricLine('恋セヨ乙女 Happiness'), null);
  assert.equal(splitLyricLine('君のことが 好き'), null);
  assert.equal(splitLyricLine('Hello! (Hey!) Hello!! (Hey!)'), null);
});

test('moves a Japanese kanji word that the naive boundary would steal', () => {
  // 深呼吸 belongs to the Japanese half.
  const result = splitLyricLine(
    '小さな勇気 ポケットにつめて 深呼吸 将小小的勇气装进口袋 深呼吸',
  );
  assert.equal(result.jp, '小さな勇気 ポケットにつめて 深呼吸');
  assert.equal(result.zh, '将小小的勇气装进口袋 深呼吸');
  assert.equal(result.reason, 'te-form-shift');
});

test('keeps a te-form line when the translation really starts there', () => {
  const result = splitLyricLine('ねえ もしかして 呐 莫非');
  assert.equal(result.jp, 'ねえ もしかして');
  assert.equal(result.zh, '呐 莫非');
});

test('handles a translation that begins with Latin text', () => {
  const result = splitLyricLine('ファッションチェック、完了☆ Fashion check 完毕☆');
  assert.equal(result.jp, 'ファッションチェック、完了☆');
  assert.equal(result.zh, 'Fashion check 完毕☆');
  assert.equal(result.reason, 'ratio-fallback');
});

test('handles a Latin-start translation when no Han-start candidate exists', () => {
  const result = splitLyricLine('こんにちは Hello你好世界');
  assert.equal(result.jp, 'こんにちは');
  assert.equal(result.zh, 'Hello你好世界');
  assert.equal(result.reason, 'latin-start');
});

test('splits a kanji-only bilingual line (no kana)', () => {
  const result = splitLyricLine('変 (Good!) 身！！ (Cute!) 变 (Good!) 身！！ (Cute!)');
  assert.equal(result.jp, '変 (Good!) 身！！ (Cute!)');
  assert.equal(result.zh, '变 (Good!) 身！！ (Cute!)');
  assert.equal(result.reason, 'no-kana');
});

test('handles U+2009 THIN SPACE as the JP/translation separator', () => {
  const result = splitLyricLine(
    'まるでサーカス 魔法のような\u2009恍如马戏团魔法般的',
  );
  assert.equal(result.jp, 'まるでサーカス 魔法のような');
  assert.equal(result.zh, '恍如马戏团魔法般的');
});

test('handles a translation wrapped in curly quotes', () => {
  const result = splitLyricLine(
    '「なりたい私」が待ってる きっと最高の笑顔で “理想的我”就在前方等待',
  );
  assert.equal(result.jp, '「なりたい私」が待ってる きっと最高の笑顔で');
  assert.equal(result.zh, '“理想的我”就在前方等待');
});

test('moves the boundary when a Japanese word leaked into the translation', () => {
  const result = splitLyricLine('つくる間にみた 夏模様 是夏天的征兆');
  assert.equal(result.jp, 'つくる間にみた 夏模様');
  assert.equal(result.zh, '是夏天的征兆');
  assert.equal(result.reason, 'jp-only-residual');
});

test('splits where the leading Latin phrase repeats in the translation', () => {
  const result = splitLyricLine(
    'Calling Happy ⽣まれたてのBrand New Day Calling Happy 崭新的 Brand New Day',
  );
  assert.equal(result.jp, 'Calling Happy ⽣まれたてのBrand New Day');
  assert.equal(result.zh, 'Calling Happy 崭新的 Brand New Day');
  assert.equal(result.reason, 'latin-repeat');
});

test('does not split a title line with a dash artist', () => {
  assert.equal(splitLyricLine('心做し (COVER版) - 鹿乃'), null);
  assert.equal(splitLyricLine('なんでもないや 没什么大不了的 - Akie秋绘'), null);
});

test('splits a Latin-start translation after sentence-final punctuation', () => {
  const result = splitLyricLine(
    'Rainy…　そんな日は　靴音鳴らし Dancing！ rainy！即使是那样的天气  也要用鞋子踩出一段旋律 dancing！',
  );
  assert.equal(result.jp, 'Rainy…　そんな日は　靴音鳴らし Dancing！');
  assert.equal(result.zh, 'rainy！即使是那样的天气  也要用鞋子踩出一段旋律 dancing！');
  assert.equal(result.reason, 'latin-after-punct');
});

test('uses a thin space when the translation starts with Latin text', () => {
  const result = splitLyricLine(
    'ハローイエス 忘れられない物語へ\u2009HELLO YES 那未曾忘却的故事',
  );
  assert.equal(result.jp, 'ハローイエス 忘れられない物語へ');
  assert.equal(result.zh, 'HELLO YES 那未曾忘却的故事');
});

test('does not split a second time', () => {
  const jp = '春空に残る淋しさ そっと心を濡らした';
  const zh = '春雨后留下的空寂轻轻沾湿心田';
  assert.equal(splitLyricLine(jp), null);
  assert.equal(splitLyricLine(zh), null);
});
