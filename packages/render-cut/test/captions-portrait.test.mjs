import assert from "node:assert/strict";
import test from "node:test";

import { generateCaptionOverlays } from "../src/captions.mjs";

// 2026-08-03 縦長字幕改修: output が縦長（height > width）のとき、既定を
// 「行を短く（10 文字）・文字を大きく（幅 6%）・複数行になる字幕は行単位の順送り表示（reveal）」
// へ切り替える。横長の既定（20 文字 / 38px / 静的表示）は従来のまま。

const PORTRAIT = { width: 1080, height: 1920, fps: 30 };
const LANDSCAPE = { width: 1920, height: 1080, fps: 30 };

const LONG_TEXT = "今日は新しく届いたカメラを持って近所の公園まで散歩しました";

function words(text, start, end) {
  // text を 2 文字ずつの word に割って等間隔のタイミングを与える
  const chunks = Array.from(text).reduce((result, character, index) => {
    if (index % 2 === 0) result.push("");
    result[result.length - 1] += character;
    return result;
  }, []);
  const step = (end - start) / chunks.length;
  return chunks.map((chunk, index) => ({
    text: chunk,
    start: start + step * index,
    end: start + step * (index + 1),
  }));
}

test("縦長では複数行の字幕が reveal（行単位の順送り）へ自動昇格する", () => {
  const [overlay] = generateCaptionOverlays(
    [{ id: "c-0001", start: 0, end: 6, text: LONG_TEXT, words: words(LONG_TEXT, 0, 6) }],
    [],
    { output: PORTRAIT },
  );
  assert.match(overlay.html, /akari-caption--reveal/);
  assert.ok((overlay.html.match(/akari-caption__reveal-group/g) ?? []).length >= 2);
});

test("縦長の行分割は 10 文字予算で、1 行あたりの文字数が横長既定より短くなる", () => {
  const [overlay] = generateCaptionOverlays(
    [{ id: "c-0001", start: 0, end: 6, text: LONG_TEXT, words: words(LONG_TEXT, 0, 6) }],
    [],
    { output: PORTRAIT },
  );
  const lines = [...overlay.html.matchAll(/<p class="akari-caption__line">(.*?)<\/p>/g)]
    .map(([, markup]) => markup.replace(/<[^>]+>/g, ""));
  assert.ok(lines.length >= 3);
  for (const line of lines) {
    // word 境界スナップの +2 猶予まで許容
    assert.ok(Array.from(line).length <= 12, `line too long: ${line}`);
  }
});

test("縦長の既定フォントサイズは出力幅の 6%（1080 → 65px）", () => {
  const [overlay] = generateCaptionOverlays(
    [{ id: "c-0001", start: 0, end: 2, text: "こんにちは" }],
    [],
    { output: PORTRAIT },
  );
  assert.match(overlay.html, /font-size: var\(--caption-font-size, 65px\);/);
});

test("縦長でも 1 行に収まる字幕・words 不在の字幕は静的表示のまま", () => {
  const [short] = generateCaptionOverlays(
    [{ id: "c-0001", start: 0, end: 2, text: "こんにちは", words: words("こんにちは", 0, 2) }],
    [],
    { output: PORTRAIT },
  );
  assert.doesNotMatch(short.html, /akari-caption--reveal/);
  const [noWords] = generateCaptionOverlays(
    [{ id: "c-0002", start: 0, end: 6, text: LONG_TEXT }],
    [],
    { output: PORTRAIT },
  );
  assert.doesNotMatch(noWords.html, /akari-caption--reveal/);
});

test("縦長でも明示スタイル（karaoke 等）は自動昇格で上書きしない", () => {
  const [overlay] = generateCaptionOverlays(
    [{
      id: "c-0001",
      start: 0,
      end: 6,
      text: LONG_TEXT,
      style: "karaoke",
      words: words(LONG_TEXT, 0, 6),
    }],
    [],
    { output: PORTRAIT },
  );
  assert.match(overlay.html, /akari-caption--karaoke/);
  assert.doesNotMatch(overlay.html, /akari-caption--reveal/);
});

test("横長の既定は従来のまま（38px・静的表示・20 文字予算）", () => {
  const [overlay] = generateCaptionOverlays(
    [{ id: "c-0001", start: 0, end: 6, text: LONG_TEXT, words: words(LONG_TEXT, 0, 6) }],
    [],
    { output: LANDSCAPE },
  );
  assert.match(overlay.html, /font-size: var\(--caption-font-size, 38px\);/);
  assert.doesNotMatch(overlay.html, /akari-caption--reveal/);
  assert.deepEqual(
    overlay.html,
    generateCaptionOverlays(
      [{ id: "c-0001", start: 0, end: 6, text: LONG_TEXT, words: words(LONG_TEXT, 0, 6) }],
      [],
    )[0].html,
  );
});

test("maxCharacters の明示指定は縦長既定より優先される", () => {
  const [overlay] = generateCaptionOverlays(
    [{ id: "c-0001", start: 0, end: 6, text: LONG_TEXT }],
    [],
    { output: PORTRAIT, maxCharacters: 20 },
  );
  const lines = [...overlay.html.matchAll(/<p class="akari-caption__line">(.*?)<\/p>/g)];
  assert.ok(lines.length <= 2);
});
