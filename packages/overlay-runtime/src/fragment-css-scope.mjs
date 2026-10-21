// HTML 断片の CSS 衝突の自動スコープ。
//
// 同じページに載る 2 つ以上の断片が同じクラス名・@keyframes 名を定義していると、CSS は
// 文書全体に効くため、後から読み込んだ断片の規則が別の断片の要素にも当たる（実機報告
// 2026-10-20 §6: 同じ `.lbl-hashimoto` と `drift` を持つラベル 2 枚で、後の `left` が
// 先のラベルにも効いた）。Shadow DOM 等で丸ごと隔離すると既存の見た目が変わるため、
// **衝突している名前だけ**を断片ごとの接尾辞（`__f2`）で書き換える。
//
// 規則:
//   - 先に読み込んだ断片（edit.json の順で先のもの）は書き換えない
//   - 衝突の無い断片・衝突の無い名前は 1 バイトも変えない（文字列をそのまま返す）
//   - 書き換えは <style> 内のセレクタ・@keyframes 名・animation / animation-name の参照と、
//     その断片の HTML の class 属性を同じ対応表で行う
//   - 同じ断片ファイルの再利用（HTML が同一）は衝突ではない（lint と同じ判定）
//   - ランタイムがクラス名で要素を引く名前（`akari-` 名前空間とホストの予約名）は
//     書き換えない。断片に <script> を書けない規約（skills/author-overlay/SKILL.md）は
//     あるが、ランタイム側の data-属性駆動の部品がクラス名に依存する箇所があるため。
//
// この 1 実装をプレビュー（packages/preview-server）と書き出し（packages/render-cut /
// packages/gpu-export）が共有する（2 実装にしない）。DOM に依存しない純関数。

/** @typedef {{ id: string, html: string }} FragmentInput */
/** @typedef {{ id: string, html: string, changed: boolean, renames: { classes: Record<string, string>, keyframes: Record<string, string> } }} ScopedFragment */

// ランタイム・ホストがクラス名で要素を引く予約名。断片側の同名定義は書き換えない。
// - akari-*: interaction.js / text-split.js / world-runtime.js / render-cut captions /
//   gpu-export page-runtime が classList / querySelector で参照する
// - ホストが断片の外側に付けるクラス（.scene / .clip / .scene-content 等）
const GUARDED_CLASS_NAMES = new Set([
  'scene',
  'clip',
  'scene-content',
  'caption-row-plate',
  'preview-pane',
  'transport-controls',
]);
const GUARDED_CLASS_PREFIX = 'akari-';
// ランタイムは @keyframes 名を JS から参照しないが、akari-* は字幕生成器・ランタイムの
// 予約名前空間なので、既存素材の規則を動かさないために対象外にする。
const GUARDED_KEYFRAMES_PREFIX = 'akari-';

const KEYFRAMES_PATTERN = /^@(?:-webkit-)?keyframes\b/iu;
const AT_BLOCK_PATTERN = /^@(?:media|supports|container|layer|scope|document)\b/iu;
const ANIMATION_PROPERTY = /^(?:-webkit-)?animation(?:-name)?$/iu;
const CLASS_ATTRIBUTE = 'class';
const STYLE_ATTRIBUTE = 'style';

export function isGuardedFragmentCssName(kind, name) {
  if (typeof name !== 'string' || name === '') return true;
  if (kind === 'class') {
    return name.startsWith(GUARDED_CLASS_PREFIX) || GUARDED_CLASS_NAMES.has(name);
  }
  return name.startsWith(GUARDED_KEYFRAMES_PREFIX);
}

function isUrlStart(text, index) {
  if (!/^url\(/iu.test(text.slice(index, index + 4))) return false;
  return index === 0 || !/[\w-]/u.test(text[index - 1]);
}

function skipString(text, start) {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === quote) return index + 1;
    index += 1;
  }
  return text.length;
}

function skipUrl(text, start) {
  let index = start + 4;
  while (index < text.length) {
    const character = text[index];
    if (character === ')') return index + 1;
    if (character === '"' || character === "'") {
      index = skipString(text, index);
      continue;
    }
    if (character === '\\') {
      index += 2;
      continue;
    }
    index += 1;
  }
  return text.length;
}

/** CSS 識別子を読む（先頭の `.` の次から）。数字始まりはクラス名ではないので null。 */
function readCssIdent(value, start) {
  let index = start;
  let name = '';
  if (value[index] === '-' && value[index + 1] === '-') {
    name = '--';
    index += 2;
  } else if (value[index] === '-') {
    name = '-';
    index += 1;
  }
  if (index >= value.length) return null;
  while (index < value.length) {
    const character = value[index];
    if (character === '\\' && index + 1 < value.length) {
      const escaped = value[index + 1];
      if (/[\r\n]/u.test(escaped)) return name === '' || name === '-' ? null : { name, end: index };
      name += escaped;
      index += 2;
      continue;
    }
    if (/^[_a-zA-Z0-9-]$/u.test(character) || character.charCodeAt(0) >= 0x80) {
      name += character;
      index += 1;
      continue;
    }
    break;
  }
  if (name === '' || /^[-]?[0-9]/u.test(name)) return null;
  return { name, end: index };
}

function stripLeadingComments(text) {
  let value = text;
  while (true) {
    const match = /^\s*\/\*[\s\S]*?\*\//u.exec(value);
    if (!match) break;
    value = value.slice(match[0].length);
  }
  return value.trimStart();
}

function collectClassNames(text) {
  const names = new Set();
  let index = 0;
  let brackets = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipString(text, index);
      continue;
    }
    if ((character === 'u' || character === 'U') && isUrlStart(text, index)) {
      index = skipUrl(text, index);
      continue;
    }
    if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets = Math.max(0, brackets - 1);
    } else if (character === '.' && brackets === 0) {
      const ident = readCssIdent(text, index + 1);
      if (ident !== null) {
        names.add(ident.name);
        index = ident.end;
        continue;
      }
    }
    index += 1;
  }
  return names;
}

function keyframesName(prelude) {
  const text = stripLeadingComments(prelude);
  const match = /^@(?:-webkit-)?keyframes\s+(?:"([^"]*)"|'([^']*)'|([^\s{]+))/iu.exec(text);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3];
}

/**
 * CSS を「セレクタ / @keyframes 前置き / at-rule 前置き / 宣言」に区切って handlers に渡す。
 * handlers は置換後の文字列を返す（収集だけなら入力をそのまま返す）。
 * コメント・文字列・url() は区切りの対象外としてそのまま前置きへ残す。
 */
function walkCss(css, handlers) {
  let output = '';
  let pending = '';
  const stack = [];
  const mode = () => (stack.length ? stack[stack.length - 1] : 'top');
  const emit = (handler, text) => {
    output += handler(text);
    pending = '';
  };
  let index = 0;
  while (index < css.length) {
    const character = css[index];
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      const stop = end < 0 ? css.length : end + 2;
      pending += css.slice(index, stop);
      index = stop;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = skipString(css, index);
      pending += css.slice(index, end);
      index = end;
      continue;
    }
    if ((character === 'u' || character === 'U') && isUrlStart(css, index)) {
      const end = skipUrl(css, index);
      pending += css.slice(index, end);
      index = end;
      continue;
    }
    if (character === '{') {
      const current = mode();
      let next;
      if (current === 'keyframes') {
        emit(handlers.keyframeSelector, pending);
        next = 'keyframeRule';
      } else {
        const stripped = stripLeadingComments(pending);
        if (KEYFRAMES_PATTERN.test(stripped)) {
          emit(handlers.keyframesPrelude, pending);
          next = 'keyframes';
        } else if (AT_BLOCK_PATTERN.test(stripped)) {
          emit(handlers.atRulePrelude, pending);
          next = 'atBlock';
        } else {
          emit(handlers.selector, pending);
          next = 'rule';
        }
      }
      output += '{';
      stack.push(next);
      index += 1;
      continue;
    }
    if (character === '}') {
      const current = mode();
      if (current === 'rule' || current === 'keyframeRule') emit(handlers.declaration, pending);
      else emit(handlers.other, pending);
      output += '}';
      if (stack.length) stack.pop();
      index += 1;
      continue;
    }
    if (character === ';') {
      const current = mode();
      if (current === 'rule' || current === 'keyframeRule') emit(handlers.declaration, pending);
      else emit(handlers.other, pending);
      output += ';';
      index += 1;
      continue;
    }
    pending += character;
    index += 1;
  }
  emit(handlers.other, pending);
  return output;
}

function rewriteClassNames(text, names) {
  if (names.size === 0) return text;
  let output = '';
  let index = 0;
  let brackets = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      const stop = end < 0 ? text.length : end + 2;
      output += text.slice(index, stop);
      index = stop;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = skipString(text, index);
      output += text.slice(index, end);
      index = end;
      continue;
    }
    if ((character === 'u' || character === 'U') && isUrlStart(text, index)) {
      const end = skipUrl(text, index);
      output += text.slice(index, end);
      index = end;
      continue;
    }
    if (character === '[') {
      brackets += 1;
      output += character;
      index += 1;
      continue;
    }
    if (character === ']') {
      brackets = Math.max(0, brackets - 1);
      output += character;
      index += 1;
      continue;
    }
    if (character === '.' && brackets === 0) {
      const ident = readCssIdent(text, index + 1);
      if (ident !== null) {
        const replacement = names.get(ident.name);
        output += `.${replacement ?? text.slice(index + 1, ident.end)}`;
        index = ident.end;
        continue;
      }
    }
    output += character;
    index += 1;
  }
  return output;
}

function rewriteKeyframesPrelude(prelude, names) {
  if (names.size === 0) return prelude;
  return prelude.replace(
    /(@(?:-webkit-)?keyframes\s+)(?:"([^"]*)"|'([^']*)'|([^\s{]+))/iu,
    (match, lead, doubleQuoted, singleQuoted, bare) => {
      const name = doubleQuoted ?? singleQuoted ?? bare;
      const replacement = names.get(name);
      if (replacement === undefined) return match;
      const quoted = doubleQuoted !== undefined ? `"${replacement}"`
        : singleQuoted !== undefined ? `'${replacement}'` : replacement;
      return `${lead}${quoted}`;
    },
  );
}

function rewriteAnimationValue(value, names) {
  if (names.size === 0) return value;
  let output = '';
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (character === '/' && value[index + 1] === '*') {
      const end = value.indexOf('*/', index + 2);
      const stop = end < 0 ? value.length : end + 2;
      output += value.slice(index, stop);
      index = stop;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = skipString(value, index);
      output += value.slice(index, end);
      index = end;
      continue;
    }
    if ((character === 'u' || character === 'U') && isUrlStart(value, index)) {
      const end = skipUrl(value, index);
      output += value.slice(index, end);
      index = end;
      continue;
    }
    if (/[_a-zA-Z-]/u.test(character) || character.charCodeAt(0) >= 0x80) {
      const start = index;
      index += 1;
      while (index < value.length) {
        const next = value[index];
        if (/[_a-zA-Z0-9-]/u.test(next) || next.charCodeAt(0) >= 0x80) {
          index += 1;
          continue;
        }
        break;
      }
      const token = value.slice(start, index);
      output += names.get(token) ?? token;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

function rewriteAnimationDeclaration(declaration, names) {
  if (names.size === 0) return declaration;
  const colon = declaration.indexOf(':');
  if (colon < 0) return declaration;
  const property = declaration.slice(0, colon).trim();
  if (!ANIMATION_PROPERTY.test(property)) return declaration;
  return declaration.slice(0, colon + 1) + rewriteAnimationValue(declaration.slice(colon + 1), names);
}

function mapStyleDeclarations(value, transform) {
  let output = '';
  let start = 0;
  let depth = 0;
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (character === '"' || character === "'") {
      index = skipString(value, index);
      continue;
    }
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (character === ';' && depth === 0) {
      output += `${transform(value.slice(start, index))};`;
      start = index + 1;
    }
    index += 1;
  }
  output += transform(value.slice(start));
  return output;
}

function rewriteCss(css, classNames, keyframesNames) {
  if (classNames.size === 0 && keyframesNames.size === 0) return css;
  return walkCss(css, {
    selector: (text) => rewriteClassNames(text, classNames),
    atRulePrelude: (text) => rewriteClassNames(text, classNames),
    keyframesPrelude: (text) => rewriteKeyframesPrelude(text, keyframesNames),
    declaration: (text) => rewriteAnimationDeclaration(text, keyframesNames),
    keyframeSelector: (text) => text,
    other: (text) => text,
  });
}

function readTag(html, start) {
  // 属性値の中の ">" をタグ終端と誤認しない（引用符の中は [^'">] の外）。
  const match = /^<(\/?)\s*([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/u.exec(html.slice(start));
  if (!match) return null;
  return {
    raw: match[0],
    length: match[0].length,
    closing: match[1] === '/',
    name: match[2],
    selfClosing: /\/\s*>$/u.test(match[0]),
  };
}

function mapTagAttributes(raw, handlers) {
  const head = /^<\s*\/?\s*([A-Za-z][\w:-]*)/u.exec(raw);
  if (!head) return raw;
  const attributesStart = head[0].length;
  const trailing = raw.endsWith('/>') ? 2 : 1;
  const attributesEnd = Math.max(attributesStart, raw.length - trailing);
  const attributes = raw.slice(attributesStart, attributesEnd);
  const pattern = /([^\s=/>]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gud;
  const replacements = [];
  for (const match of attributes.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (name !== CLASS_ATTRIBUTE && name !== STYLE_ATTRIBUTE) continue;
    const span = match.indices[3] ?? match.indices[4] ?? match.indices[5];
    if (!span) continue;
    const value = attributes.slice(span[0], span[1]);
    const next = name === CLASS_ATTRIBUTE
      ? handlers.classValue(value) : handlers.styleValue(value);
    if (next !== value) replacements.push([span[0], span[1], next]);
  }
  let body = attributes;
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const [start, end, value] = replacements[index];
    body = body.slice(0, start) + value + body.slice(end);
  }
  return raw.slice(0, attributesStart) + body + raw.slice(attributesEnd);
}

/**
 * HTML を走査し、<style> の中身・class 属性・style 属性だけを handlers に通す。
 * タグ・コメント・<script> の中身はそのまま残す（断片の script はデータ宣言のみ）。
 */
function mapHtml(html, handlers) {
  let output = '';
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) {
      output += html.slice(cursor);
      break;
    }
    output += html.slice(cursor, start);
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      const stop = end < 0 ? html.length : end + 3;
      output += html.slice(start, stop);
      cursor = stop;
      continue;
    }
    const tag = readTag(html, start);
    if (!tag) {
      output += '<';
      cursor = start + 1;
      continue;
    }
    const name = tag.name.toLowerCase();
    if (!tag.closing && (name === 'script' || name === 'style') && !tag.selfClosing) {
      const closing = new RegExp(`</${name}\\s*>`, 'igu');
      closing.lastIndex = start + tag.length;
      const end = closing.exec(html);
      const contentEnd = end ? end.index : html.length;
      const content = html.slice(start + tag.length, contentEnd);
      output += mapTagAttributes(tag.raw, handlers);
      output += name === 'style' ? handlers.styleCss(content) : content;
      output += end ? end[0] : '';
      cursor = end ? closing.lastIndex : html.length;
      continue;
    }
    output += mapTagAttributes(tag.raw, handlers);
    cursor = start + tag.length;
  }
  return output;
}

/** 断片が宣言・使用しているクラス名と、宣言している @keyframes 名を集める。 */
export function collectFragmentCssNames(html) {
  const classes = new Set();
  const keyframes = new Set();
  const usedClasses = new Set();
  mapHtml(String(html ?? ''), {
    styleCss: (css) => {
      walkCss(css, {
        selector: (text) => {
          for (const name of collectClassNames(text)) classes.add(name);
          return text;
        },
        atRulePrelude: (text) => {
          for (const name of collectClassNames(text)) classes.add(name);
          return text;
        },
        keyframesPrelude: (text) => {
          const name = keyframesName(text);
          if (name !== null && name !== '') keyframes.add(name);
          return text;
        },
        declaration: (text) => text,
        keyframeSelector: (text) => text,
        other: (text) => text,
      });
      return css;
    },
    classValue: (value) => {
      for (const token of value.split(/\s+/u)) if (token !== '') usedClasses.add(token);
      return value;
    },
    styleValue: (value) => value,
  });
  return { classes, keyframes, usedClasses };
}

function rewriteClassValue(value, names) {
  if (names.size === 0) return value;
  return value.replace(/[^\s]+/gu, (token) => names.get(token) ?? token);
}

function rewriteFragmentHtml(html, classNames, keyframesNames) {
  if (classNames.size === 0 && keyframesNames.size === 0) return html;
  return mapHtml(html, {
    styleCss: (css) => rewriteCss(css, classNames, keyframesNames),
    classValue: (value) => rewriteClassValue(value, classNames),
    styleValue: (value) => mapStyleDeclarations(value,
      (declaration) => rewriteAnimationDeclaration(declaration, keyframesNames)),
  });
}

function uniqueSuffixName(name, index, usedNames) {
  const base = `${name}__f${index + 1}`;
  let candidate = base;
  let attempt = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}-${attempt}`;
    attempt += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

/**
 * 断片を読み込み順（edit.json の順）に並べて、後の断片の衝突名だけを書き換える。
 * 衝突が無ければ `html` は入力と同一の文字列（`changed: false`）。
 *
 * @param {FragmentInput[]} fragments
 * @returns {ScopedFragment[]}
 */
export function scopeFragmentCss(fragments) {
  if (!Array.isArray(fragments)) throw new TypeError('fragments must be an array');
  const entries = fragments.map((fragment, index) => ({
    id: String(fragment?.id ?? index),
    html: typeof fragment?.html === 'string' ? fragment.html : '',
  }));
  const collected = entries.map((entry) => collectFragmentCssNames(entry.html));

  // 既存の全名前（宣言・使用）と、これから作る名前の両方と衝突しない接尾辞を選ぶ。
  const usedClassNames = new Set();
  for (const names of collected) {
    for (const name of names.classes) usedClassNames.add(name);
    for (const name of names.usedClasses) usedClassNames.add(name);
  }
  const usedKeyframesNames = new Set();
  for (const names of collected) {
    for (const name of names.keyframes) usedKeyframesNames.add(name);
  }

  // 同じ名前を最初に宣言した断片は必ず無改名で残る（先に読み込んだ断片は書き換えない）。
  // 後続の断片は「最初の宣言者と同じ HTML か」だけを見ればよい: 同一 HTML の再利用は
  // lint と同じく衝突ではない。これで字幕 1,205 枚のような大量断片でも O(名前数) で済む。
  const firstClassOwner = new Map();
  const firstKeyframesOwner = new Map();
  const renamesByIndex = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const names = collected[index];
    const classRenames = new Map();
    const keyframesRenames = new Map();
    // 衝突 = 両方の断片が <style> で同じ名前を宣言していること（lint の重複警告と同じ判定）。
    // HTML で名前を使うだけ（規則を持たない）断片は、スタイルの衝突を作らない。
    for (const name of [...names.classes].sort()) {
      if (isGuardedFragmentCssName('class', name)) continue;
      const owner = firstClassOwner.get(name);
      if (owner === undefined) {
        firstClassOwner.set(name, entry.html);
        continue;
      }
      if (owner === entry.html) continue;
      classRenames.set(name, uniqueSuffixName(name, index, usedClassNames));
    }
    for (const name of [...names.keyframes].sort()) {
      if (isGuardedFragmentCssName('keyframes', name)) continue;
      const owner = firstKeyframesOwner.get(name);
      if (owner === undefined) {
        firstKeyframesOwner.set(name, entry.html);
        continue;
      }
      if (owner === entry.html) continue;
      keyframesRenames.set(name, uniqueSuffixName(name, index, usedKeyframesNames));
    }
    renamesByIndex.push({ classRenames, keyframesRenames });
  }

  return entries.map((entry, index) => {
    const { classRenames, keyframesRenames } = renamesByIndex[index];
    const html = classRenames.size === 0 && keyframesRenames.size === 0
      ? entry.html
      : rewriteFragmentHtml(entry.html, classRenames, keyframesRenames);
    return {
      id: entry.id,
      html,
      changed: html !== entry.html,
      renames: {
        classes: Object.fromEntries(classRenames),
        keyframes: Object.fromEntries(keyframesRenames),
      },
    };
  });
}
