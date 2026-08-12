import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  proposalToAnnotation,
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
import {
  detectVadSpans,
  restoreWhisperTokenWords,
  transcribeAudio,
} from "../bin/core/transcription.mjs";

const execFileAsync = promisify(execFile);
const compileCli = fileURLToPath(new URL("../bin/compile-review-session.mjs", import.meta.url));

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

test("再生中発話へ近接するストロークを高信頼の frame アンカーとして採用する", () => {
  const { events } = parseEventsJsonl([
    '{"recT":0,"type":"start","timelineT":0,"playing":false}',
    '{"recT":0,"type":"play","timelineT":0}',
    '{"recT":9,"type":"tick","timelineT":9}',
    '{"recT":12,"type":"tick","timelineT":12}',
  ].join("\n"));
  const stroke = {
    id: "st-0001",
    tool: "pen",
    space: "content-rect",
    recTStart: 12.4,
    recTEnd: 13.1,
    frame: { timelineT: 7.25, sourceT: 777.5, cutIndex: 7 },
    points: [[0.1, 0.2], [0.8, 0.9]],
  };
  const reference = resolveUtteranceReference({
    utterance: { text: "ここを調整する", recT: [12, 15], words: [] },
    trace: buildTimelineTrace(events),
    cutMap: buildCutMap(snapshot),
    strokes: [stroke],
  });
  assert.equal(reference.resolutionMethod, "stroke-pair");
  assert.equal(reference.timelineT, stroke.frame.timelineT);
  assert.equal(reference.sourceT, stroke.frame.sourceT);
  assert.equal(reference.target, "cut:7");
  assert.equal(reference.confidence, "high");
  assert.equal(reference.pairedStroke, stroke);
});

test("再生中発話へ近接する rect ストロークも高信頼の frame アンカーとして採用する", () => {
  const { events } = parseEventsJsonl([
    '{"recT":0,"type":"start","timelineT":0,"playing":false}',
    '{"recT":0,"type":"play","timelineT":0}',
    '{"recT":9,"type":"tick","timelineT":9}',
    '{"recT":12,"type":"tick","timelineT":12}',
  ].join("\n"));
  const stroke = {
    id: "st-0002",
    tool: "rect",
    space: "content-rect",
    recTStart: 12.4,
    recTEnd: 13.1,
    frame: { timelineT: 7.25, sourceT: 777.5, cutIndex: 7 },
    box: [0.55, 0.55, 0.2, 0.2],
  };
  const reference = resolveUtteranceReference({
    utterance: { text: "ここを調整する", recT: [12, 15], words: [] },
    trace: buildTimelineTrace(events),
    cutMap: buildCutMap(snapshot),
    strokes: [stroke],
  });
  assert.equal(reference.resolutionMethod, "stroke-pair");
  assert.equal(reference.timelineT, stroke.frame.timelineT);
  assert.equal(reference.sourceT, stroke.frame.sourceT);
  assert.equal(reference.target, "cut:7");
  assert.equal(reference.confidence, "high");
  assert.equal(reference.pairedStroke, stroke);
});

test("停止中発話はアンカーを保ちつつ近接ストロークを添付する", () => {
  const { events } = parseEventsJsonl([
    '{"recT":0,"type":"start","timelineT":5,"playing":false}',
    '{"recT":6,"type":"end","timelineT":5}',
  ].join("\n"));
  const stroke = {
    id: "st-0002",
    tool: "pen",
    space: "content-rect",
    recTStart: 2.2,
    recTEnd: 2.8,
    frame: { timelineT: 18, sourceT: 108, cutIndex: 1 },
    points: [[0.2, 0.3], [0.7, 0.6]],
  };
  const reference = resolveUtteranceReference({
    utterance: { text: "ここを直す", recT: [2, 3], words: [] },
    trace: buildTimelineTrace(events),
    cutMap: buildCutMap(snapshot),
    strokes: [stroke],
  });
  assert.equal(reference.resolutionMethod, "stopped-frame");
  assert.equal(reference.timelineT, 5);
  assert.equal(reference.sourceT, 15);
  assert.equal(reference.target, "cut:0");
  assert.equal(reference.pairedStroke, stroke);
});

test("annotation へ端点を保った最大100点のストロークと sessionRef を埋め込む", () => {
  const points = Array.from({ length: 151 }, (_, index) => [index / 150, index / 300]);
  const pairedStroke = {
    id: "st-0012",
    tool: "pen",
    space: "content-rect",
    frame: { timelineT: 4, sourceT: 14, cutIndex: 0 },
    points,
  };
  const annotation = proposalToAnnotation({
    proposal: {
      transcript: "ここを直す",
      recRange: [1, 2],
      reference: {
        timelineT: 4,
        sourceT: 14,
        sourceRange: null,
        target: "cut:0",
        confidence: "high",
        candidates: [],
        pairedStroke,
      },
    },
    decision: { action: "annotate", reason: "編集指示", text: "ここを直す", confidence: "high" },
    sessionId: "s-0003",
    audioPath: "review/sessions/s-0003/audio.wav",
    createdAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(annotation.strokes.length, 1);
  assert.equal(annotation.strokes[0].points.length, 100);
  assert.deepEqual(annotation.strokes[0].points[0], points[0]);
  assert.deepEqual(annotation.strokes[0].points.at(-1), points.at(-1));
  assert.equal(annotation.strokes[0].sessionRef, "s-0003/st-0012");
  assert.deepEqual(annotation.strokes[0].frame, { sourceT: 14, cutIndex: 0 });
});

test("rect ストロークを region として annotation へ埋め込む", () => {
  const box = [0.55, 0.55, 0.2, 0.2];
  const annotation = proposalToAnnotation({
    proposal: {
      transcript: "ここを直す",
      recRange: [1, 2],
      reference: {
        timelineT: 4,
        sourceT: 14,
        sourceRange: null,
        target: "cut:0",
        confidence: "high",
        candidates: [],
        pairedStroke: {
          id: "st-0013",
          tool: "rect",
          space: "content-rect",
          frame: { timelineT: 4, sourceT: 14, cutIndex: 0 },
          box,
        },
      },
    },
    decision: { action: "annotate", reason: "編集指示", text: "ここを直す", confidence: "high" },
    sessionId: "s-0003",
    audioPath: "review/sessions/s-0003/audio.wav",
    createdAt: "2026-08-12T00:00:00.000Z",
  });
  assert.equal(annotation.strokes, null);
  assert.equal(annotation.targetKind, "region");
  assert.deepEqual(annotation.region, { box });
});

test("CLI が strokes.json を読み annotation へ着地し、破損時は warning へ劣化する", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "compile-review-strokes-"));
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(temporary, "review.json"),
    '{\n  "version": 0,\n  "annotations": [\n  ]\n}\n',
  );
  const sessionsRoot = path.join(temporary, "review", "sessions");
  await fs.mkdir(sessionsRoot, { recursive: true });

  for (const [sessionId, strokesSource] of [
    ["s-0001", JSON.stringify({
      version: 1,
      strokes: [{
        id: "st-0001",
        tool: "pen",
        space: "content-rect",
        recTStart: 2.1,
        recTEnd: 2.7,
        frame: { timelineT: 6, sourceT: 16, cutIndex: 0 },
        points: [[0.1, 0.2], [0.8, 0.9]],
      }],
    })],
    ["s-0002", "{broken"],
  ]) {
    const sessionDirectory = path.join(sessionsRoot, sessionId);
    await fs.mkdir(sessionDirectory);
    await fs.writeFile(path.join(sessionDirectory, "session.json"), JSON.stringify({
      version: 1,
      id: sessionId,
      status: "recorded",
      audio: "audio.wav",
      editSnapshot: "edit.snapshot.json",
      compiledAnnotations: null,
    }));
    await fs.writeFile(path.join(sessionDirectory, "edit.snapshot.json"), JSON.stringify({
      cuts: [{ in: 10, out: 30 }],
    }));
    await fs.writeFile(path.join(sessionDirectory, "events.jsonl"), [
      '{"recT":0,"type":"start","timelineT":0,"playing":false}',
      '{"recT":0.5,"type":"play","timelineT":0}',
      '{"recT":4,"type":"end","timelineT":3.5}',
    ].join("\n"));
    await fs.writeFile(path.join(sessionDirectory, "transcript.json"), JSON.stringify({
      version: 1,
      backend: "fixture",
      segments: [{
        start: 2,
        end: 3,
        text: "このカットを削除してください",
        words: [{ start: 2, end: 3, text: "このカットを削除してください" }],
      }],
    }));
    await fs.writeFile(path.join(sessionDirectory, "strokes.json"), strokesSource);
    await execFileAsync(process.execPath, [compileCli, temporary, "--session", sessionId, "--json"]);
  }

  const review = JSON.parse(await fs.readFile(path.join(temporary, "review.json"), "utf8"));
  assert.equal(review.annotations.length, 2);
  assert.equal(review.annotations[0].strokes[0].sessionRef, "s-0001/st-0001");
  assert.equal(review.annotations[0].sourceT, 16);
  assert.equal(review.annotations[1].strokes, null);
  const damagedReport = await fs.readFile(
    path.join(sessionsRoot, "s-0002", "compile-report.md"),
    "utf8",
  );
  assert.match(damagedReport, /strokes\.json を無視します/);

  const rectSessionId = "s-0003";
  const rectSessionDirectory = path.join(sessionsRoot, rectSessionId);
  await fs.mkdir(rectSessionDirectory);
  await fs.writeFile(path.join(rectSessionDirectory, "session.json"), JSON.stringify({
    version: 1,
    id: rectSessionId,
    status: "recorded",
    audio: "audio.wav",
    editSnapshot: "edit.snapshot.json",
    compiledAnnotations: null,
  }));
  await fs.writeFile(path.join(rectSessionDirectory, "edit.snapshot.json"), JSON.stringify({
    cuts: [{ in: 10, out: 30 }],
  }));
  await fs.writeFile(path.join(rectSessionDirectory, "events.jsonl"), [
    '{"recT":0,"type":"start","timelineT":0,"playing":false}',
    '{"recT":0.5,"type":"play","timelineT":0}',
    '{"recT":4,"type":"end","timelineT":3.5}',
  ].join("\n"));
  await fs.writeFile(path.join(rectSessionDirectory, "transcript.json"), JSON.stringify({
    version: 1,
    backend: "fixture",
    segments: [{
      start: 2,
      end: 3,
      text: "この範囲を明るくしてください",
      words: [{ start: 2, end: 3, text: "この範囲を明るくしてください" }],
    }],
  }));
  const box = [0.55, 0.55, 0.2, 0.2];
  await fs.writeFile(path.join(rectSessionDirectory, "strokes.json"), JSON.stringify({
    version: 1,
    strokes: [{
      id: "st-0003",
      tool: "rect",
      space: "content-rect",
      recTStart: 2.1,
      recTEnd: 2.7,
      frame: { timelineT: 6, sourceT: 16, cutIndex: 0 },
      box,
    }],
  }));
  await execFileAsync(process.execPath, [compileCli, temporary, "--session", rectSessionId, "--json"]);

  const reviewWithRect = JSON.parse(await fs.readFile(path.join(temporary, "review.json"), "utf8"));
  assert.equal(reviewWithRect.annotations.length, 3);
  assert.equal(reviewWithRect.annotations[2].strokes, null);
  assert.equal(reviewWithRect.annotations[2].targetKind, "region");
  assert.deepEqual(reviewWithRect.annotations[2].region, { box });
  const rectReport = await fs.readFile(
    path.join(rectSessionDirectory, "compile-report.md"),
    "utf8",
  );
  assert.doesNotMatch(rectReport, /stroke の形式が不正です/);
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

test("圧縮タイムスタンプを reject して whisper.cpp へ fallback する", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "compile-review-vad-"));
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const audioPath = path.join(temporary, "audio.wav");
  await writePcmWav(audioPath, 18, [
    [1.95, 3.05],
    [4.65, 6.15],
    [7.1, 7.45],
    [8.1, 9.2],
    [11.95, 12.25],
    [14.5, 17.85],
  ]);
  const vad = await detectVadSpans(audioPath);
  assert.deepEqual(
    vad.spans.map(({ start, end }) => [start, end]),
    [
      [1.95, 3.05],
      [4.65, 6.15],
      [7.1, 7.45],
      [8.1, 9.2],
      [11.95, 12.25],
      [14.5, 17.85],
    ],
  );
  const calls = [];
  const warnings = [];
  const transcript = await transcribeAudio({
    audioPath,
    transcribers: {
      speechAnalyzer: async () => {
        calls.push("speechanalyzer");
        return {
          result: {
            backend: "speechanalyzer",
            segments: timedSegments([[4.38, 6.4], [14.27, 15.16]]),
          },
          reason: null,
        };
      },
      whisper: async () => {
        calls.push("whisper-cpp");
        return {
          result: {
            backend: "whisper-cpp",
            segments: timedSegments([[0, 9.22], [9.22, 17.94]]),
          },
          reason: null,
        };
      },
    },
    logger: { warn: (warning) => warnings.push(warning) },
  });

  assert.deepEqual(calls, ["speechanalyzer", "whisper-cpp"]);
  assert.equal(transcript.backend, "whisper-cpp");
  assert.equal(transcript.provenance.backend, "whisper-cpp");
  assert.equal(transcript.provenance.fallbackFrom, "speechanalyzer");
  assert.match(transcript.provenance.reason, /coverage=0\.313 .*\/7\.700秒.*< 0\.700/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /タイムスタンプ健全性ゲートで結果を破棄/);
});

test("VAD 発話時間を十分に覆うタイムスタンプはそのまま採用する", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "compile-review-vad-"));
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const audioPath = path.join(temporary, "audio.wav");
  await writePcmWav(audioPath, 3, [[0.5, 1.5], [2, 2.5]]);
  let whisperCalled = false;
  const healthySegments = timedSegments([[0.45, 1.55], [1.95, 2.55]]);
  const transcript = await transcribeAudio({
    audioPath,
    transcribers: {
      speechAnalyzer: async () => ({
        result: { backend: "speechanalyzer", segments: healthySegments },
        reason: null,
      }),
      whisper: async () => {
        whisperCalled = true;
        throw new Error("健全な tier の後に fallback してはいけません");
      },
    },
    logger: { warn: () => assert.fail("健全なタイムスタンプで warning を出してはいけません") },
  });

  assert.equal(whisperCalled, false);
  assert.equal(transcript.backend, "speechanalyzer");
  assert.deepEqual(transcript.segments, healthySegments);
  assert.deepEqual(transcript.provenance, { backend: "speechanalyzer" });
});

function expectLocation(sourceT, cutIndex) {
  return {
    ...buildCutMap(snapshot).intervals[cutIndex],
    timelineT: sourceT < 100 ? sourceT - 10 : sourceT - 90,
    sourceT,
  };
}

function timedSegments(ranges) {
  return ranges.map(([start, end], index) => ({
    start,
    end,
    text: `発話${index + 1}`,
    words: [{ start, end, text: `発話${index + 1}` }],
  }));
}

async function writePcmWav(file, duration, speechSpans, sampleRate = 16000) {
  const frameCount = Math.round(duration * sampleRate);
  const data = Buffer.alloc(frameCount * 2);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate;
    const voiced = speechSpans.some(([start, end]) => time >= start && time < end);
    data.writeInt16LE(voiced ? 1000 : 0, frame * 2);
  }
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  await fs.writeFile(file, wav);
}
