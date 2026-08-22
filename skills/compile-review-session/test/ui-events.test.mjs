import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  buildProposals,
  proposalToAnnotation,
} from "../bin/core/compiler.mjs";
import {
  buildCutMap,
  buildTimelineTrace,
  buildUiTrace,
  parseEventsJsonl,
  resolveUtteranceReference,
} from "../bin/core/time-mapping.mjs";

const execFileAsync = promisify(execFile);
const compileCli = fileURLToPath(new URL("../bin/compile-review-session.mjs", import.meta.url));

const snapshot = {
  cuts: [
    { in: 10, out: 20 },
    { in: 100, out: 140 },
  ],
};

function stoppedTrace(timelineT) {
  const { events } = parseEventsJsonl([
    `{"recT":0,"type":"start","timelineT":${timelineT},"playing":false}`,
    `{"recT":30,"type":"end","timelineT":${timelineT}}`,
  ].join("\n"));
  return buildTimelineTrace(events);
}

test("buildUiTrace は ui.click / ui.tab / ui.panel を recT 順に取り出し、他イベントを無視する", () => {
  const { events } = parseEventsJsonl([
    '{"recT":0,"type":"start","timelineT":0,"playing":false}',
    '{"recT":5,"type":"ui.click","target":"timeline:cut:1","label":"カットB","intent":true}',
    '{"recT":2,"type":"ui.panel","target":"panel:assets","label":"素材パネル"}',
    '{"recT":3,"type":"ui.tab","target":"tab:assets-builtin","label":"組み込み"}',
    '{"recT":4,"type":"play","timelineT":0}',
  ].join("\n"));
  const trace = buildUiTrace(events);
  assert.equal(trace.warnings.length, 0);
  assert.deepEqual(trace.clicks, [{ recT: 5, target: "timeline:cut:1", label: "カットB", intent: true }]);
  assert.deepEqual(trace.panels, [{ recT: 2, target: "panel:assets", label: "素材パネル" }]);
  assert.deepEqual(trace.tabs, [{ recT: 3, target: "tab:assets-builtin", label: "組み込み" }]);
});

test("buildUiTrace は target の無い UI イベントを warning 付きで無視する（黙って落とさない）", () => {
  const { events } = parseEventsJsonl([
    '{"recT":0,"type":"start","timelineT":0,"playing":false}',
    '{"recT":1,"type":"ui.click","label":"素材パネル"}',
  ].join("\n"));
  const trace = buildUiTrace(events);
  assert.equal(trace.clicks.length, 0);
  assert.equal(trace.warnings.length, 1);
  assert.match(trace.warnings[0], /target がないためスキップします/);
});

test("時間窓外の ui.click は参照解決に影響しない", () => {
  const trace = stoppedTrace(5);
  const withoutUi = resolveUtteranceReference({
    utterance: { text: "ここを直す", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
  });
  const withFarUi = resolveUtteranceReference({
    utterance: { text: "ここを直す", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
    uiClicks: [{ recT: 200, target: "timeline:cut:1", label: "ここ", intent: true }],
  });
  assert.deepEqual(withFarUi, withoutUi);
  assert.equal(withFarUi.target, "cut:0");
  assert.equal(withFarUi.confidence, "high");
  assert.equal("uiCandidates" in withFarUi, false);
});

test("呼称が発話に含まれない受動クリックは対象を変えない（黙って断定しない）", () => {
  const trace = stoppedTrace(5);
  const reference = resolveUtteranceReference({
    utterance: { text: "ここを直す", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
    uiClicks: [{ recT: 12.5, target: "timeline:cut:1", label: "無関係パネル", intent: false }],
  });
  assert.equal(reference.target, "cut:0");
  assert.equal(reference.confidence, "high");
  assert.equal(reference.resolutionMethod, "stopped-frame");
});

test("呼称が一意に一致する ui.click は timeline:cut ターゲットを cuts[] から直接上書きする", () => {
  const trace = stoppedTrace(5);
  const reference = resolveUtteranceReference({
    utterance: { text: "カットBをこうして", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
    uiClicks: [{ recT: 12.5, target: "timeline:cut:1", label: "カットB", intent: false }],
  });
  assert.equal(reference.target, "cut:1");
  assert.equal(reference.sourceT, 100);
  assert.equal(reference.timelineT, 10);
  assert.equal(reference.confidence, "high");
  assert.equal(reference.resolutionMethod, "ui-click-cut");
});

test("intent: true は呼称一致より優先して一意候補として採用する", () => {
  const trace = stoppedTrace(5);
  const reference = resolveUtteranceReference({
    utterance: { text: "ここをこうして", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
    uiClicks: [
      { recT: 12.1, target: "timeline:cut:1", label: "無関係な呼称", intent: true },
      { recT: 12.4, target: "timeline:cut:0", label: "別の無関係な呼称", intent: false },
    ],
  });
  assert.equal(reference.target, "cut:1");
  assert.equal(reference.resolutionMethod, "ui-click-cut");
  assert.equal(reference.confidence, "high");
});

test("timeline:overlay ターゲットは overlays[].start を cutMap 経由で source 秒へ写像する", () => {
  const trace = stoppedTrace(5);
  const reference = resolveUtteranceReference({
    utterance: { text: "このオーバーレイの文字を直して", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
    overlays: [{ id: "ov-1", start: 5 }],
    uiClicks: [{ recT: 12.5, target: "timeline:overlay:ov-1", label: "オーバーレイ", intent: false }],
  });
  assert.equal(reference.target, "overlay:ov-1");
  assert.equal(reference.timelineT, 5);
  assert.equal(reference.sourceT, 15);
  assert.equal(reference.resolutionMethod, "ui-click-overlay");
  assert.equal(reference.confidence, "high");
});

test("asset ターゲットは timeline 位置を変えず refs だけを追加する", () => {
  const trace = stoppedTrace(5);
  const reference = resolveUtteranceReference({
    utterance: { text: "この素材に差し替えて", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
    uiClicks: [{ recT: 12.5, target: "asset:assets/broll/city.mp4", label: "素材", intent: false }],
  });
  assert.equal(reference.target, "cut:0");
  assert.equal(reference.sourceT, 15);
  assert.deepEqual(reference.refs, [{ path: "assets/broll/city.mp4" }]);
});

test("呼称一致する候補が複数残るときは対象を変えず confidence だけ low へ落とす", () => {
  const trace = stoppedTrace(5);
  const reference = resolveUtteranceReference({
    utterance: { text: "この素材の場面を直して", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
    uiClicks: [
      { recT: 12.2, target: "asset:assets/broll/a.mp4", label: "素材", intent: false },
      { recT: 12.6, target: "timeline:cut:1", label: "場面", intent: false },
    ],
  });
  assert.equal(reference.target, "cut:0", "対象は書き換えない");
  assert.equal(reference.sourceT, 15);
  assert.equal(reference.confidence, "low");
  assert.deepEqual(reference.uiCandidates, [
    { target: "asset:assets/broll/a.mp4", label: "素材" },
    { target: "timeline:cut:1", label: "場面" },
  ]);
});

test("intent クリックが複数あるとき呼称でさらに絞り込む", () => {
  const trace = stoppedTrace(5);
  const reference = resolveUtteranceReference({
    utterance: { text: "カットBをこうして", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
    uiClicks: [
      { recT: 12.1, target: "timeline:cut:0", label: "カットA", intent: true },
      { recT: 12.4, target: "timeline:cut:1", label: "カットB", intent: true },
    ],
  });
  assert.equal(reference.target, "cut:1");
  assert.equal(reference.confidence, "high");
});

test("解決できない ui.click ターゲット（未知の cut index / 不明語彙）は無視して既存解決を保つ", () => {
  const trace = stoppedTrace(5);
  const unknownCutIndex = resolveUtteranceReference({
    utterance: { text: "カットZをこうして", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
    uiClicks: [{ recT: 12.5, target: "timeline:cut:9", label: "カットZ", intent: true }],
  });
  assert.equal(unknownCutIndex.target, "cut:0");
  assert.equal(unknownCutIndex.confidence, "high");

  const unknownVocab = resolveUtteranceReference({
    utterance: { text: "素材パネルを見て", recT: [12, 13], words: [] },
    trace,
    cutMap: buildCutMap(snapshot),
    uiClicks: [{ recT: 12.5, target: "panel:assets", label: "素材パネル", intent: true }],
  });
  assert.equal(unknownVocab.target, "cut:0");
  assert.equal(unknownVocab.confidence, "high");
});

test("proposalToAnnotation は refs が無いとき refs キー自体を含めない（既存出力の形を変えない）", () => {
  const annotation = proposalToAnnotation({
    proposal: {
      transcript: "ここを直す",
      recRange: [1, 2],
      reference: {
        timelineT: 4, sourceT: 14, sourceRange: null, target: "cut:0",
        confidence: "high", candidates: [],
      },
    },
    decision: { action: "annotate", reason: "編集指示", text: "ここを直す", confidence: "high" },
    sessionId: "s-0001",
    audioPath: "review/sessions/s-0001/audio.wav",
    createdAt: "2026-08-11T00:00:00.000Z",
  });
  assert.equal("refs" in annotation, false);
  assert.equal("strokeRefs" in annotation, false);
});

test("proposalToAnnotation は reference.refs があるときだけ refs を書き込む", () => {
  const annotation = proposalToAnnotation({
    proposal: {
      transcript: "この素材に差し替えて",
      recRange: [1, 2],
      reference: {
        timelineT: 4, sourceT: 14, sourceRange: null, target: "cut:0",
        confidence: "high", candidates: [], refs: [{ path: "assets/broll/city.mp4" }],
      },
    },
    decision: { action: "annotate", reason: "編集指示", text: "この素材に差し替えて", confidence: "high" },
    sessionId: "s-0001",
    audioPath: "review/sessions/s-0001/audio.wav",
    createdAt: "2026-08-11T00:00:00.000Z",
  });
  assert.deepEqual(annotation.refs, [{ path: "assets/broll/city.mp4" }]);
});

test("buildProposals: 曖昧な UI 候補は [要確認] にその候補を書き添える", () => {
  const trace = stoppedTrace(5);
  const proposals = buildProposals({
    utterances: [{ text: "この素材の場面を直してください", recT: [12, 13], words: [] }],
    trace,
    cutMap: buildCutMap(snapshot),
    uiClicks: [
      { recT: 12.2, target: "asset:assets/broll/a.mp4", label: "素材", intent: false },
      { recT: 12.6, target: "timeline:cut:1", label: "場面", intent: false },
    ],
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].reference.confidence, "low");
});

test("CLI: ui.click が timeline:cut / timeline:overlay / asset を review.json の既存語彙へ着地させる", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "compile-review-ui-events-"));
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(temporary, "review.json"),
    '{\n  "version": 0,\n  "annotations": [\n  ]\n}\n',
  );
  const sessionDirectory = path.join(temporary, "review", "sessions", "s-0001");
  await fs.mkdir(sessionDirectory, { recursive: true });
  await fs.writeFile(path.join(sessionDirectory, "session.json"), JSON.stringify({
    version: 1,
    id: "s-0001",
    status: "recorded",
    audio: "audio.wav",
    editSnapshot: "edit.snapshot.json",
    compiledAnnotations: null,
  }));
  await fs.writeFile(path.join(sessionDirectory, "edit.snapshot.json"), JSON.stringify({
    cuts: [{ in: 10, out: 20 }, { in: 100, out: 140 }],
    overlays: [{ id: "ov-1", html: "overlays/ov-1.html", start: 5, duration: 2 }],
  }));
  await fs.writeFile(path.join(sessionDirectory, "events.jsonl"), [
    '{"recT":0,"type":"start","timelineT":0,"playing":false}',
    '{"recT":0.1,"type":"ui.click","target":"timeline:cut:1","label":"カットA","intent":true}',
    '{"recT":3.1,"type":"ui.click","target":"timeline:overlay:ov-1","label":"オーバーレイ"}',
    '{"recT":6.1,"type":"ui.click","target":"asset:assets/broll/city.mp4","label":"素材"}',
    '{"recT":20,"type":"end","timelineT":0}',
  ].join("\n"));
  await fs.writeFile(path.join(sessionDirectory, "transcript.json"), JSON.stringify({
    version: 1,
    backend: "fixture",
    segments: [
      {
        start: 0.5, end: 1.0, text: "カットAをこうして",
        words: [{ start: 0.5, end: 1.0, text: "カットAをこうして" }],
      },
      {
        start: 8, end: 8.5, text: "オーバーレイのテキストを直して",
        words: [{ start: 8, end: 8.5, text: "オーバーレイのテキストを直して" }],
      },
      {
        start: 9.5, end: 10, text: "この素材に差し替えて",
        words: [{ start: 9.5, end: 10, text: "この素材に差し替えて" }],
      },
    ],
  }));

  await execFileAsync(process.execPath, [compileCli, temporary, "--session", "s-0001", "--json"]);

  const review = JSON.parse(await fs.readFile(path.join(temporary, "review.json"), "utf8"));
  assert.equal(review.annotations.length, 3);
  const [cutAnnotation, overlayAnnotation, assetAnnotation] = review.annotations;

  assert.equal(cutAnnotation.target, "cut:1");
  assert.equal(cutAnnotation.sourceT, 100);
  assert.equal("refs" in cutAnnotation, false);

  assert.equal(overlayAnnotation.target, "overlay:ov-1");
  assert.equal(overlayAnnotation.sourceT, 15);

  assert.equal(assetAnnotation.target, "cut:0");
  assert.deepEqual(assetAnnotation.refs, [{ path: "assets/broll/city.mp4" }]);

  const report = await fs.readFile(path.join(sessionDirectory, "compile-report.md"), "utf8");
  assert.match(report, /ui-click-cut/);
  assert.match(report, /ui-click-overlay/);
});
