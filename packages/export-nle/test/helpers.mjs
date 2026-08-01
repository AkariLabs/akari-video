// テスト用の最小 XML well-formed 検査（依存ゼロ規律のため自前実装）。
// タグの開閉対応・属性引用符・未エスケープ & のみを見る。DTD 検証はしない。

import assert from "node:assert/strict";

export function assertWellFormedXml(xml) {
  let rest = xml.replace(/^<\?xml[^>]*\?>\s*/, "").replace(/^<!DOCTYPE[^>]*>\s*/, "");
  const stack = [];
  const tagPattern = /<(\/?)([A-Za-z][\w.-]*)((?:\s+[\w.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let match;
  let consumed = 0;
  while ((match = tagPattern.exec(rest)) !== null) {
    assert.equal(match.index, consumed, `XML として解釈できない断片: ${rest.slice(consumed, consumed + 80)}`);
    consumed = match.index + match[0].length;
    const [, closing, name, , selfClosing, text] = match;
    if (text !== undefined) {
      assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(text), `未エスケープの & がある: ${text.slice(0, 60)}`);
      continue;
    }
    if (closing) {
      const opened = stack.pop();
      assert.equal(opened, name, `閉じタグ不一致: 開 ${opened} / 閉 ${name}`);
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  assert.equal(consumed, rest.length, `末尾に解釈できない断片が残る: ${rest.slice(consumed, consumed + 80)}`);
  assert.deepEqual(stack, [], `閉じられていないタグ: ${stack.join(" > ")}`);
}
