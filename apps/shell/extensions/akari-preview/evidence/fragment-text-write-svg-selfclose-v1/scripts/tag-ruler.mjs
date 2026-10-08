// 検証用の物差し: HTML の文字列からタグ名の並びを取る（製品の fragment-source-write.mjs は呼ばない）。
// foreign: false = 自己終了タグ <x …/> をどこでも「開始だけ」と数える（修正前の数え方）
// foreign: true  = <svg> / <math> の中の自己終了タグだけ「開始 + 終了」と数える（ブラウザの HTML パーサと同じ）
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const TAG = /^<(?:"[^"]*"|'[^']*'|[^'">])*>/u;
const INTEGRATION = new Set(['foreignobject', 'desc', 'title']);

export function tagSequence(html, { foreign }) {
  const tags = [];
  const stack = [];
  let textNodes = 0;
  let cursor = 0;
  while (cursor < html.length) {
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[cursor] !== '<') {
      const next = html.indexOf('<', cursor);
      const end = next < 0 ? html.length : next;
      if (stack.length && html.slice(cursor, end).trim()) textNodes++;
      cursor = end;
      continue;
    }
    const match = html.slice(cursor).match(TAG);
    if (!match) { cursor++; continue; }
    const raw = match[0];
    cursor += raw.length;
    const closing = raw.match(/^<\/\s*([\w:-]+)/u);
    if (closing) {
      const name = closing[1].toLowerCase();
      tags.push('/' + name);
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].name === name) { stack.length = index; break; }
      }
      continue;
    }
    const opening = raw.match(/^<([\w:-]+)/u);
    if (!opening) continue;
    const name = opening[1].toLowerCase();
    const parent = stack[stack.length - 1];
    const namespace = name === 'svg' ? 'svg' : name === 'math' ? 'math'
      : parent && parent.namespace !== 'html' && !parent.integration ? parent.namespace : 'html';
    tags.push(name);
    const selfClosing = raw.endsWith('/>');
    if (namespace === 'html' || !foreign) {
      if ((name === 'style' || name === 'script') && !(selfClosing && !foreign)) {
        const rest = html.slice(cursor);
        const close = rest.match(new RegExp(`</${name}\\s*>`, 'i'));
        cursor = close ? cursor + close.index + close[0].length : html.length;
      } else if (!VOID.has(name) && !(selfClosing && !foreign)) {
        stack.push({ name, namespace, integration: namespace === 'svg' && INTEGRATION.has(name) });
      }
    } else if (selfClosing) {
      tags.push('/' + name);
    } else {
      stack.push({ name, namespace, integration: namespace === 'svg' && INTEGRATION.has(name) });
    }
  }
  return { tags, textNodes };
}

const show = tag => tag === undefined ? '(なし)' : tag.startsWith('/') ? `</${tag.slice(1)}>` : `<${tag}>`;

export function firstDifference(before, after) {
  const length = Math.max(before.length, after.length);
  for (let index = 0; index < length; index++) {
    if (before[index] !== after[index]) {
      return { index, position: index + 1, source: show(before[index]), edited: show(after[index]),
        sourceContext: before.slice(Math.max(0, index - 3), index + 3).map(show).join(' '),
        editedContext: after.slice(Math.max(0, index - 3), index + 3).map(show).join(' ') };
    }
  }
  return null;
}

export function compareTags(source, edited) {
  const result = {};
  for (const [key, foreign] of [['legacy', false], ['parser', true]]) {
    const a = tagSequence(source, { foreign });
    const b = tagSequence(edited, { foreign });
    result[key] = { sourceTags: a.tags.length, editedTags: b.tags.length,
      sourceTextNodes: a.textNodes, editedTextNodes: b.textNodes,
      firstDifference: firstDifference(a.tags, b.tags) };
  }
  return result;
}
