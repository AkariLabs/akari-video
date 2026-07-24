import assert from "node:assert/strict";
import test from "node:test";

import {
  provisionalJudgement,
  segmentUtterances,
} from "../bin/core/compiler.mjs";
import {
  appendAnnotationLine,
  nextAnnotationNumber,
} from "../bin/core/review-store.mjs";
import {
  buildCutMap,
  buildTimelineTrace,
  parseEventsJsonl,
  resolveUtteranceReference,
} from "../bin/core/time-mapping.mjs";
import { restoreWhisperTokenWords } from "../bin/core/transcription.mjs";

const snapshot = {
  cuts: [
    { in: 10, out: 20 },
    { in: 100, out: 140 },
  ],
};

test("timelineT の cut 境界を半開区間で sourceT へ写像する", () => {
  const map = buildCutMap(snapshot);
  assert.deepEqual(map.locate(9.5), expectLocation(19.5, 0));
  assert.deepEqual(map.locate(10), expectLocation(100, 1));
  assert.deepEqual(map.locate(45), expectLocation(135, 1));
});

test("tick を正として recT から停止・再生位置を復元する", () => {
  const { events, warnings } = parseEventsJsonl([
    '{"recT":0,"type":"start","timelineT":0,"playing":false}',
    '{"recT":0,"type":"play","timelineT":0}',
    '{"recT":10,"type":"tick","timelineT":10}',
    '{"broken":',
  ].join("\n"));
  assert.equal(warnings.length, 1);
  const trace = buildTimelineTrace(events);
  assert.equal(trace.stateAt(12).timelineT, 12);
  assert.equal(trace.stateAt(12).playing, true);
});

test("再生中発話は 3 秒窓内の単一 cut 境界へ解決する", () => {
  const { events } = parseEventsJsonl([
    '{"recT":0,"type":"start","timelineT":0,"playing":false}',
    '{"recT":0,"type":"play","timelineT":0}',
    '{"recT":9,"type":"tick","timelineT":9}',
    '{"recT":12,"type":"tick","timelineT":12}',
  ].join("\n"));
  const reference = resolveUtteranceReference({
    utterance: { text: "調整する", recT: [12, 15], words: [] },
    trace: buildTimelineTrace(events),
    cutMap: buildCutMap(snapshot),
  });
  assert.equal(reference.sourceT, 100);
  assert.equal(reference.target, "cut:1");
  assert.equal(reference.resolutionMethod, "rewind-window-boundary");
  assert.equal(reference.confidence, "high");
});

test("0.3 秒未満の segment を結合し、文末 word で分割する", () => {
  const utterances = segmentUtterances([
    {
      start: 1,
      end: 2,
      text: "一つ目。",
      words: [{ start: 1, end: 2, text: "一つ目。" }],
    },
    {
      start: 2.2,
      end: 3,
      text: "二つ目",
      words: [{ start: 2.2, end: 3, text: "二つ目" }],
    },
  ]);
  assert.equal(utterances.length, 2);
  assert.equal(utterances[0].text, "一つ目。");
  assert.equal(utterances[1].text, "二つ目");
});

test("fixture の編集指示とテスト発話を暫定判定する", () => {
  assert.deepEqual(
    provisionalJudgement("テロップの文字をもう少し大きくしてください").action,
    "annotate",
  );
  assert.deepEqual(
    provisionalJudgement("えー、これはテストです、音声チェックです").action,
    "discard",
  );
});

test("review.json の既存 annotation バイト列を変更せず新しい行を足す", () => {
  const existingLine = '    {"id":"a-0001","text":"保持"}';
  const source = `{\n  "version": 0,\n  "annotations": [\n${existingLine}\n  ]\n}\n`;
  const updated = appendAnnotationLine(source, { id: "a-0002", text: "追加" });
  assert.ok(updated.includes(existingLine));
  assert.equal(updated.split(existingLine).length, 2);
  assert.deepEqual(JSON.parse(updated).annotations.map((item) => item.id), ["a-0001", "a-0002"]);
  assert.equal(nextAnnotationNumber(JSON.parse(updated).annotations), 3);
});

test("whisper token 境界で分断された UTF-8 bytes を連結して word に戻す", () => {
  const bytes = Buffer.from("テ", "utf8");
  const words = restoreWhisperTokenWords([
    {
      text: bytes.subarray(0, 2).toString("latin1"),
      offsets: { from: 1000, to: 1100 },
    },
    {
      text: bytes.subarray(2).toString("latin1"),
      offsets: { from: 1100, to: 1200 },
    },
  ], 1, 2);
  assert.deepEqual(words, [{ start: 1, end: 1.2, text: "テ" }]);
});

test("発話をまたぐ多段スクラブは発話終端の着地点へ高信頼で解決する", () => {
  const scrubSnapshot = {
    cuts: [
      { in: 0, out: 60 },
      { in: 1000, out: 1050, at: 60 },
      { in: 2000, out: 2060, at: 110 },
    ],
  };
  const { events } = parseEventsJsonl([
    '{"recT":0,"type":"start","timelineT":0,"playing":false}',
    '{"recT":11.21,"type":"seek","from":0,"to":100.06}',
    '{"recT":12.72,"type":"seek","from":100.06,"to":104.34}',
    '{"recT":12.97,"type":"seek","from":104.34,"to":115.17}',
    '{"recT":12.98,"type":"rate","value":0.9}',
    '{"recT":13.23,"type":"seek","from":115.17,"to":122.88}',
    '{"recT":17.32,"type":"seek","from":122.88,"to":71.25}',
    '{"recT":17.33,"type":"rate","value":1}',
    '{"recT":20.52,"type":"end","timelineT":71.25}',
  ].join("\n"));
  const reference = resolveUtteranceReference({
    utterance: { text: "この辺りを明るく調整する", recT: [9.22, 17.94], words: [] },
    trace: buildTimelineTrace(events),
    cutMap: buildCutMap(scrubSnapshot),
  });
  assert.equal(reference.target, "cut:1");
  assert.ok(Math.abs(reference.sourceT - 1011.25) < 0.05, `sourceT=${reference.sourceT}`);
  assert.equal(reference.confidence, "high");
  assert.notEqual(reference.confidence, "low");
});

function expectLocation(sourceT, cutIndex) {
  return {
    ...buildCutMap(snapshot).intervals[cutIndex],
    timelineT: sourceT < 100 ? sourceT - 10 : sourceT - 90,
    sourceT,
  };
}
