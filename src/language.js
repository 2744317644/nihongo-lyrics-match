// Japanese / Simplified-Chinese lyric heuristics.
//
// Many Chinese music apps merge a Japanese line and its translation into a
// single timed line, separated by a space:
//
//   [00:28.70]春空に残る淋しさ そっと心を濡らした 春雨后留下的空寂轻轻沾湿心田
//
// This module finds the boundary and returns the two halves so the caller can
// emit two lines that share the same timestamp.

export const KANA_RE = /[\u3040-\u30ff\u31f0-\u31ff\u31a0-\u31bf]/;
export const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

// Simplified Chinese characters that are (essentially) never used in Japanese
// text. Used to decide whether a file actually contains Chinese translations
// and to sanity-check the "te-form" boundary correction.
export const CN_ONLY = new Set([
  ...'们这说么过还让爱见样边进动听欢乐华书车时结开关门问间闻变种继觉记忆认为无专头东马鸟鱼龙风飞电话质经验处统发设计测软网络务项档码运输户账录权创删询报块协议证优监错误异维护顾虽犹调忧虑恼泪梦终给对队敌读带单导顶订冻栋夺饿尔饵贰罚阀贩饭访纺废费纷坟愤奋丰疯缝讽凤肤妇复该钙盖赶刚钢岗纲个巩沟构购够观馆惯归龟规柜贵滚锅汉贺红壶护沪户怀坏欢环换唤挥辉毁贿秽汇讳绘浑获货祸击鸡积极辑挤几剂济际纪夹价驾歼坚剑键舰艰浆奖讲酱胶骄娇搅矫较节洁诫紧谨惊颈镜纠举剧卷绝军凯颗壳课垦恳夸亏扩阔蜡赖蓝栏览懒烂滥捞劳垒类离丽厉联连帘脸练炼链粮两辆疗辽猎临邻灵岭领娄卢陆驴虑滤仑轮论罗萝逻锣骡络远佑你谁吗呢吧啊呀嘛哦嗯喂什怎很哪从众帮并亚产亲亿仅厂厅历压厌应跟找长树脑轻愿步站别窗层实收达续选择决划办跑喊现请约谢张场员图热气毕转',
]);

// Characters that only exist in Japanese forms (shinjitai etc.). Used only for
// lines that contain no kana at all, to tell a Japanese half from Chinese.
export const JP_ONLY = new Set([
  ...'変広気楽読単対発経続説転伝電話駅図団実薬験権売買値産顔頭題願類歳歴芸術戦価済車龍豊辺黒円関観覚鉄銀銅県様込畑峠働',
]);

// Full-width punctuation that can start a Chinese translation clause.
const CN_START_PUNCT_RE = /^[（「『【《〈〔〖]/;
// Some translations are wrapped in curly/straight quotes: `“理想的我”就在前方等待`.
// Only treat a quote as a Chinese opener when the next character is Han.
const QUOTE_START_RE = /^[“”‘’"']/;

function isChineseOpening(suf) {
  if (HAN_RE.test(suf[0])) return true;
  if (CN_START_PUNCT_RE.test(suf[0])) return true;
  if (suf[0] === '/' || suf[0] === '／') {
    const rest = suf.slice(1).trimStart();
    if (rest && HAN_RE.test(rest[0])) return true;
  }
  if (QUOTE_START_RE.test(suf[0]) && suf.length > 1 && HAN_RE.test(suf[1])) return true;
  return false;
}

/**
 * Strip the slash that some sources put between a Japanese line and its
 * Chinese translation, e.g. `…けれど /一份期待…` -> `…けれど` + `一份期待…`.
 * Conservative: only a leading `/` or `／`, only when the rest contains Han
 * but no kana, and only when the rest contains no further slash. Anything
 * else (A/B, URLs, 好き/嫌い, 他/她) is left untouched.
 * @param {string} zh
 * @returns {string | null} cleaned text, or null when the rule does not apply
 */
export function stripSlashDelimiter(zh) {
  if (!/^[\/／]/u.test(zh)) return null;
  const rest = zh.replace(/^[\/／]\s?/u, '');
  if (!rest || KANA_RE.test(rest) || !HAN_RE.test(rest)) return null;
  if (/[\/／]/u.test(rest)) return null;
  return rest;
}

// Some taggers separate the Japanese half from the translation with a regular
// space, others use U+2009 THIN SPACE (common in JPOP FLAC lyrics), an
// ideographic space, etc. Treat all Unicode whitespace as a possible boundary.
const SEPARATOR_RE = /[\s\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/;

function isSeparator(char) {
  return SEPARATOR_RE.test(char);
}

// `心做し (COVER版) - 鹿乃` is a title line, not a merged lyric line.
const TITLE_DASH_RE = /\s-\s([^-\s]{1,20})$/;

function looksLikeTitleLine(text) {
  const match = TITLE_DASH_RE.exec(text);
  if (!match) return false;
  const tail = match[1];
  // "Title - Artist" tails are normally kana-free names (e.g. "鹿乃",
  // "Akie秋绘"). Do not try to split title lines as lyrics.
  return !KANA_RE.test(tail);
}

const SENTENCE_END_RE = /[。！？!?…～☆♪〜]/;

function isSentenceEnd(char) {
  return SENTENCE_END_RE.test(char);
}

function hasUnclosedQuote(pre, close) {
  const open = close === '”' ? '“' : '‘';
  let depth = 0;
  for (const ch of pre) {
    if (ch === open) depth++;
    else if (ch === close) depth--;
  }
  return depth > 0;
}

// Lines that begin with a Latin phrase sometimes repeat that phrase at the
// start of the translation:
//   Calling Happy ⽣まれたてのBrand New Day Calling Happy 崭新的 Brand New Day
// In that case the second occurrence is the translation boundary.
const LEADING_LATIN_RE = /^([A-Za-z][A-Za-z0-9'’&.\-]*(?:\s+[A-Za-z][A-Za-z0-9'’&.\-]*)*)\s*/;

function splitAtRepeatedLatinPhrase(text) {
  const match = LEADING_LATIN_RE.exec(text);
  if (!match) return null;
  const phrase = match[1];
  if (phrase.length < 3) return null;

  let searchFrom = match[0].length;
  for (;;) {
    const second = text.indexOf(phrase, searchFrom);
    if (second < 0) return null;

    const after = text[second + phrase.length];
    if (after && /[A-Za-z0-9]/.test(after)) {
      searchFrom = second + 1;
      continue;
    }
    if (!isSeparator(text[second - 1])) {
      searchFrom = second + 1;
      continue;
    }

    const pre = text.slice(0, second - 1);
    const suf = text.slice(second);
    if (!KANA_RE.test(pre) || KANA_RE.test(suf) || !HAN_RE.test(suf)) {
      searchFrom = second + 1;
      continue;
    }
    return { jp: pre, zh: suf, reason: 'latin-repeat' };
  }
}

const META_LINE_RE =
  /^\s*(?:作词|作曲|编曲|作詞|作曲|編曲|歌|歌手|演唱|和声|制作|混音|母带|监制|出品|词|曲|Lyrics?|Lyricist|Composer|Arranger?|Arrange|Producer|Vocals?|Chorus|Drums|Bass|Guitars?|Guitar|Piano|Keyboards?|Strings|Mixing|Mastering|Recording|Engineer|Music)\s*[:：]/i;

/** Credit lines such as `作词 : Someone` or `Drums : Someone` must never be split. */
export function isMetaLine(text) {
  return META_LINE_RE.test(text);
}

/** True when the string contains at least one Simplified-Chinese-only character. */
export function hasChineseMarker(text) {
  for (const ch of text) if (CN_ONLY.has(ch)) return true;
  return false;
}

function cleanLength(text) {
  return text.replace(/\s/g, '').length;
}

function ratioOf(candidate) {
  return cleanLength(candidate.suf) / Math.max(1, cleanLength(candidate.pre));
}

function collectCandidates(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (!isSeparator(text[i])) continue;
    const pre = text.slice(0, i);
    const suf = text.slice(i + 1);
    if (!pre || !suf) continue;
    // Japanese half must contain kana; translation half must not.
    if (!KANA_RE.test(pre) || KANA_RE.test(suf)) continue;
    if (!HAN_RE.test(suf)) continue; // without CJK this is almost certainly not a translation
    // A space immediately before the closing quote of a Japanese quotation is
    // inside the quotation, not the JP/translation boundary.
    if ((suf[0] === '”' || suf[0] === '’') && hasUnclosedQuote(pre, suf[0])) continue;
    out.push({
      i,
      pre,
      suf,
      sep: text[i],
      strict: isChineseOpening(suf),
    });
  }
  return out;
}

/**
 * Split a merged `Japanese + space + translation` line.
 *
 * @param {string} text lyric text without the timestamp
 * @returns {{jp: string, zh: string, reason: string} | null} null when the line
 *   is already correct / is not a translated Japanese line / is metadata.
 */
function splitLyricLineInner(text) {
  if (isMetaLine(text) || looksLikeTitleLine(text)) return null;

  if (!KANA_RE.test(text)) {
    return splitNoKanaBilingualLine(text);
  }

  const repeatedLatin = splitAtRepeatedLatinPhrase(text);
  if (repeatedLatin) return repeatedLatin;

  const collected = collectCandidates(text);
  if (collected.length === 0) return null;

  // U+2009 THIN SPACE is used by some JPOP lyric sources exclusively at the
  // Japanese/translation boundary, while ordinary ASCII spaces also occur
  // inside the Japanese and Chinese halves. When the line contains a thin
  // space, only consider thin-space boundaries.
  // A bracketed translation is a whole unit: prefer the boundary before the
  // opening bracket even when the translation itself contains a thin space.
  // Do not let a later bracket inside the translation override an earlier
  // Chinese-start candidate (the normal JP/ZH boundary).
  const thinCandidates = collected.filter((c) => c.sep === '\u2009');
  let candidates = collected;
  if (thinCandidates.length > 0) {
    const firstThin = thinCandidates[0];
    const bracketsBeforeThin = collected.filter((c) => c.strict && CN_START_PUNCT_RE.test(c.suf[0]) && c.i < firstThin.i);
    if (bracketsBeforeThin.length > 0) {
      candidates = bracketsBeforeThin;
    } else {
      // A thin space may separate two Japanese words (`聞こえた 声`); a later
      // bracketed translation is the real boundary. But if the text between
      // the thin space and that bracket is already Chinese, the thin space was
      // the JP/ZH boundary (`…元気は100％で 以现在… 「谢谢你！」`).
      const bracketsAfterThin = collected.filter((c) => {
        if (!c.strict || !CN_START_PUNCT_RE.test(c.suf[0]) || c.i <= firstThin.i) return false;
        const between = text.slice(firstThin.i + 1, c.i).trim();
        return !hasChineseMarker(between);
      });
      candidates = bracketsAfterThin.length > 0 ? bracketsAfterThin : thinCandidates;
    }
  }

  const strict = candidates.filter((c) => c.strict);

  // No candidate starts with CJK punctuation/Han: accept one only when the
  // suffix really carries Chinese content (translation that begins with Latin).
  // A U+2009 thin space is itself a strong boundary marker, so on those lines
  // accept the first thin-space candidate even if the translation starts with
  // Latin and contains no Chinese-only character (e.g. "HELLO YES 那未曾忘却的故事").
  if (strict.length === 0) {
    if (thinCandidates.length > 0) {
      const first = thinCandidates[0];
      return { jp: first.pre, zh: first.suf, reason: 'latin-start' };
    }
    const chinese = candidates.find((c) => hasChineseMarker(c.suf));
    return chinese ? { jp: chinese.pre, zh: chinese.suf, reason: 'latin-start' } : null;
  }

  let pick = strict[0];
  let reason = 'standard';

  // A few sources leave a tiny translation fragment (e.g. "完毕☆") when the
  // Japanese half also contains Latin words. Never let the translation be
  // absurdly shorter than the Japanese half; in that case pick the candidate
  // whose length ratio is closest to 1:1 instead of blindly taking the first
  // candidate (which may cut inside a Japanese Latin phrase).
  if (ratioOf(pick) < 0.28) {
    const target = 1;
    let best = pick;
    let bestDistance = Math.abs(ratioOf(pick) - target);
    for (const candidate of candidates) {
      const distance = Math.abs(ratioOf(candidate) - target);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best !== pick) {
      pick = best;
      reason = 'ratio-fallback';
    }
  }

  // A translation may begin with Latin text even when a later Han-start
  // candidate exists:
  //   Rainy…　そんな日は　靴音鳴らし Dancing！ rainy！即使是那样的天气 …
  // If an earlier candidate starts with Latin, carries Chinese content and
  // follows sentence-final punctuation, prefer it when its ratio is closer
  // to 1:1 than the current pick.
  {
    let best = pick;
    let bestDistance = Math.abs(ratioOf(pick) - 1);
    for (const candidate of candidates) {
      if (candidate.i >= pick.i) continue;
      if (!/[A-Za-z]/.test(candidate.suf[0])) continue;
      if (!hasChineseMarker(candidate.suf)) continue;
      if (!isSentenceEnd(candidate.pre.slice(-1))) continue;
      const distance = Math.abs(ratioOf(candidate) - 1);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best !== pick) {
      pick = best;
      reason = 'latin-after-punct';
    }
  }

  // Te/de-form guard:
  //   [03:07.49]小さな勇気 ポケットにつめて 深呼吸 将小小的勇气装进口袋 深呼吸
  // The first space starts a Japanese kanji word ("深呼吸"), not the translation.
  // If the Japanese half ends in て/で, the candidate translation is as long as
  // (or longer than) the Japanese half, and its first token is a short kanji
  // word without Chinese-only characters, move the boundary one candidate right.
  if (/[てで]$/.test(pick.pre) && ratioOf(pick) >= 1.0) {
    const index = strict.indexOf(pick);
    const firstToken = pick.suf.split(/\s+/)[0];
    if (
      index >= 0 &&
      index + 1 < strict.length &&
      firstToken.length <= 3 &&
      !hasChineseMarker(firstToken)
    ) {
      pick = strict[index + 1];
      reason = 'te-form-shift';
    }
  }

  // If the chosen translation still contains Japanese-only forms (e.g.
  // `つくる間にみた 夏模様 是夏天的征兆`), the boundary is one Japanese word too
  // early. Simplified-Chinese translations never use forms such as 様/変/広/気.
  if (hasJapaneseOnly(pick.suf)) {
    const later = strict.filter((c) => c.i > pick.i && !hasJapaneseOnly(c.suf));
    if (later.length > 0) {
      pick = later[0];
      reason = 'jp-only-residual';
    }
  }

  return { jp: pick.pre, zh: pick.suf, reason };
}

/**
 * Split a merged line and remove a slash used purely as the JP/translation
 * delimiter. Internal slashes (A/B, 他/她) are left untouched.
 * @param {string} text
 * @returns {{jp: string, zh: string, reason: string} | null}
 */
export function splitLyricLine(text) {
  const split = splitLyricLineInner(text);
  if (!split) return null;
  const cleaned = stripSlashDelimiter(split.zh);
  if (cleaned !== null) split.zh = cleaned;
  return split;
}

function hasJapaneseOnly(text) {
  for (const ch of text) if (JP_ONLY.has(ch)) return true;
  return false;
}

/**
 * A line without kana can still be a merged pair when the Japanese half is
 * kanji-only, e.g. `変 (Good!) 身！！ (Cute!) 变 (Good!) 身！！ (Cute!)`.
 * Split at the space right before the first Simplified-Chinese-only character,
 * but only when the left half contains a Japanese-only character.
 */
function splitNoKanaBilingualLine(text) {
  if (!HAN_RE.test(text)) return null;

  const chars = [...text];
  const firstChinese = chars.findIndex((ch) => CN_ONLY.has(ch));
  if (firstChinese <= 0) return null;

  let space = -1;
  for (let i = firstChinese - 1; i >= 0; i--) {
    if (isSeparator(chars[i])) {
      space = i;
      break;
    }
  }
  if (space <= 0) return null;

  const jp = chars.slice(0, space).join('');
  const zh = chars.slice(space + 1).join('');
  if (!jp || !zh) return null;
  if (![...jp].some((ch) => JP_ONLY.has(ch))) return null;
  if (!hasChineseMarker(zh)) return null;

  return { jp, zh, reason: 'no-kana' };
}
