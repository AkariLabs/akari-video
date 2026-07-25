import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyReviewSource,
  appendAnnotationLine,
  parseReview,
  updateStatusLine,
} from "../lib/common/annotation-store.js";

function baseAnnotation(overrides = {}) {
  return {
    id: "a-0001",
    createdAt: "2026-07-24T16:42:14+09:00",
    src: null,
    sourceT: 132.4,
    sourceRange: null,
    timelineT: null,
    target: null,
    targetKind: null,
    region: null,
    strokes: null,
    refs: null,
    insertPosition: null,
    intent: null,
    text: "テスト注釈",
    input: "typed",
    audio: null,
    transcript: null,
    session: null,
    poses: null,
    status: "open",
    response: null,
    ...overrides,
  };
}

test("review セッション由来の annotation（session/strokes/transcript）を round-trip できる", () => {
  const annotation = baseAnnotation({
    input: "session",
    text: "[要確認] 停止位置での発話 — 対応不要なら resolved に。",
    transcript: "ここは今見えてますかね",
    session: { id: "s-0003", recRange: [9.22, 17.94], confidence: "low" },
    strokes: [
      {
        tool: "pen",
        space: "content-rect",
        frame: { sourceT: 132.4, cutIndex: 2 },
        points: [[0.42, 0.31], [0.43, 0.32]],
        sessionRef: "s-0001/st-0003",
      },
    ],
  });
  const source = appendAnnotationLine(emptyReviewSource(), annotation);
  const parsed = parseReview(source);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.annotations.length, 1);
  const [roundTripped] = parsed.annotations;
  assert.equal(roundTripped.input, "session");
  assert.equal(roundTripped.transcript, "ここは今見えてますかね");
  assert.deepEqual(roundTripped.session, { id: "s-0003", recRange: [9.22, 17.94], confidence: "low" });
  assert.equal(roundTripped.strokes.length, 1);
  assert.deepEqual(roundTripped.strokes[0], {
    tool: "pen",
    space: "content-rect",
    frame: { sourceT: 132.4, cutIndex: 2 },
    points: [[0.42, 0.31], [0.43, 0.32]],
    sessionRef: "s-0001/st-0003",
  });
});

test("session が不正な形（confidence 未知値・recRange 欠落）なら警告のうえ null に落とす", () => {
  const badSessionSource = source =>
    source.replace('"session":null', '"session":{"id":"s-0001","recRange":[0],"confidence":"maybe"}');
  const annotation = baseAnnotation({ input: "session" });
  const source = badSessionSource(appendAnnotationLine(emptyReviewSource(), annotation));
  const parsed = parseReview(source);
  assert.equal(parsed.annotations[0].session, null);
  assert.ok(parsed.warnings.some(warning => warning.includes("session")));
});

test("strokes が旧型（[number,number][] の素の配列）なら不正として無視する", () => {
  const legacyStrokesSource = source =>
    source.replace('"strokes":null', '"strokes":[[[0.1,0.2],[0.3,0.4]]]');
  const annotation = baseAnnotation();
  const source = legacyStrokesSource(appendAnnotationLine(emptyReviewSource(), annotation));
  const parsed = parseReview(source);
  assert.equal(parsed.annotations[0].strokes, null);
  assert.ok(parsed.warnings.some(warning => warning.includes("strokes")));
});

test("updateStatusLine は addressed→resolved だけを許可し、open からの直接遷移は拒否する（人間ゲート）", () => {
  const addressed = appendAnnotationLine(emptyReviewSource(), baseAnnotation({
    status: "addressed",
    response: { summary: "対応しました", action: "edited", respondedAt: "2026-07-24T20:20:40+09:00" },
  }));
  const resolved = updateStatusLine(addressed, "a-0001", ["addressed"], "resolved");
  assert.equal(parseReview(resolved).annotations[0].status, "resolved");

  const open = appendAnnotationLine(emptyReviewSource(), baseAnnotation({ status: "open" }));
  assert.throws(() => updateStatusLine(open, "a-0001", ["addressed"], "resolved"));
});

test("updateStatusLine は pretty-print 済み（id と status が別の行にある）review.json でも解決できる", () => {
  // 実データ（selection-dogfood 等）は appendAnnotationLine の 1 行 1 注釈形式ではなく、
  // 人手/他ツールが書いた整形済み JSON になり得る。id と status が同一行にあることを前提に
  // した旧実装はこの形式で「現在の状態（不明）」誤検知していた（本タスクの L1 実機検証で発見）。
  const prettySource = JSON.stringify({
    version: 0,
    annotations: [
      baseAnnotation({ id: "a-0001", status: "open" }),
      {
        ...baseAnnotation({ id: "a-0002", status: "addressed" }),
        response: { summary: "対応しました", action: "edited", respondedAt: "2026-07-24T20:20:40+09:00" },
      },
    ],
  }, null, 2) + "\n";
  const updated = updateStatusLine(prettySource, "a-0002", ["addressed"], "resolved");
  const parsed = parseReview(updated);
  assert.equal(parsed.annotations.find(a => a.id === "a-0002").status, "resolved");
  assert.equal(parsed.annotations.find(a => a.id === "a-0001").status, "open");
  assert.deepEqual(parsed.annotations.find(a => a.id === "a-0002").response, {
    summary: "対応しました", action: "edited", respondedAt: "2026-07-24T20:20:40+09:00",
  });
});

test("updateStatusLine は同一 id が複数あるとき安全側に倒して拒否する", () => {
  const duplicated = JSON.stringify({
    version: 0,
    annotations: [baseAnnotation({ id: "a-0001", status: "addressed" }), baseAnnotation({ id: "a-0001", status: "open" })],
  });
  assert.throws(() => updateStatusLine(duplicated, "a-0001", ["addressed"], "resolved"), /複数/);
});

// contract-2026-07-26-doc-image-annotations §1/§2: doc:<path>#<block-id> / image:<path> target は
// sourceT: null を許容する（動画面の注釈は従来どおり sourceT 必須のまま — 無退行を別テストで確認）。
test("sourceT: null は target が doc:<path>#<block-id> のとき警告なしで round-trip できる", () => {
  const annotation = baseAnnotation({
    sourceT: null,
    target: "doc:.akari/reports/analysis-report.html#asset-facts:clip-01",
  });
  const source = appendAnnotationLine(emptyReviewSource(), annotation);
  const parsed = parseReview(source);
  assert.equal(parsed.warnings.length, 0, parsed.warnings.join(" "));
  assert.equal(parsed.annotations.length, 1);
  assert.equal(parsed.annotations[0].sourceT, null);
  assert.equal(parsed.annotations[0].target, "doc:.akari/reports/analysis-report.html#asset-facts:clip-01");
});

test("sourceT: null は target が image:<path> のとき警告なしで round-trip できる", () => {
  const annotation = baseAnnotation({ sourceT: null, target: "image:assets/thumbnails/candidate-1.png" });
  const source = appendAnnotationLine(emptyReviewSource(), annotation);
  const parsed = parseReview(source);
  assert.equal(parsed.warnings.length, 0, parsed.warnings.join(" "));
  assert.equal(parsed.annotations[0].sourceT, null);
});

test("sourceT: null かつ doc:/image: 以外の target は表示は残すが警告する（劣化規約: 無言で捨てない）", () => {
  const annotation = baseAnnotation({ sourceT: null, target: "overlay:title-1" });
  const source = appendAnnotationLine(emptyReviewSource(), annotation);
  const parsed = parseReview(source);
  assert.equal(parsed.annotations.length, 1, "無言で捨てず注釈は残す");
  assert.equal(parsed.annotations[0].sourceT, null);
  assert.match(parsed.warnings.join(" "), /sourceT が null ですが target が doc: \/ image: 形式ではありません/);
});

test("動画面の注釈（target null・sourceT 数値）は無退行で従来どおり round-trip できる", () => {
  const annotation = baseAnnotation({ sourceT: 12.4, target: null, targetKind: "instant" });
  const source = appendAnnotationLine(emptyReviewSource(), annotation);
  const parsed = parseReview(source);
  assert.equal(parsed.warnings.length, 0, parsed.warnings.join(" "));
  assert.equal(parsed.annotations[0].sourceT, 12.4);
});
