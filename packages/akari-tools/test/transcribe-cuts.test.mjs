import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runMediaCli } from "../bin/media.mjs";
import { pickBasisByFillerHits, transcribeCutsMedia } from "../src/media/transcribe-cuts.mjs";
import { countFillerHits, FILLER_LEXICON } from "../src/media/filler-lexicon.mjs";
import { fixture, json, putJson, silenceSpans } from "./fixtures/transcribe-compare/helpers.mjs";

const readCuts = (f) => json(path.join(f.directory, "cuts.json"));

test("フィラー候補は SA の文字 words と whisper の語 words で件数・区間・reason が一致する", async (t) => {
  const text = "あの、前、えーと、後、まあ！";
  const results = [];
  for (const [backend, tokens] of [
    ["speech-analyzer", Array.from(text)],
    ["whisper-cpp", ["あの", "前", "えーと", "後", "まあ"]],
  ]) {
    const f = await fixture(t, [backend]);
    const file = path.join(f.directory, `transcripts/${backend}.json`);
    const data = await json(file);
    let cursor = 0;
    const words = tokens.map((token) => {
      const at = text.indexOf(token, cursor);
      cursor = at + token.length;
      return { text: token, start: 1 + at * 0.25, end: 1 + cursor * 0.25 };
    });
    data.segments = [{ text, start: 1, end: 1 + text.length * 0.25, words }];
    await putJson(file, data);
    for (const filler of ["off", "on"]) {
      const summary = await transcribeCutsMedia(f.target, { ...f.options, filler, silencesRunner: async () => [] });
      const fillers = (await readCuts(f)).candidates.filter((c) => c.kind === "filler");
      assert.equal(summary.by_kind.filler, 3, backend);
      assert.deepEqual(fillers.map((c) => c.text), ["あの、", "えーと、", "まあ"]);
      assert.deepEqual(fillers.map((c) => c.reason), ["冒頭のフィラー", "フィラー", "フィラー"]);
      assert.ok(fillers.every((c) => c.default_on === (filler === "on") && c.timing === undefined));
      if (filler === "off") results.push({ count: summary.by_kind.filler, spans: fillers.map((c) => [c.start, c.end]) });
    }
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0].spans, [[1, 1.5], [2.25, 3], [3.75, 4.25]]);
});

test("連続同一フィラーの塊は言い直しに譲り、離れた同一・連続する別語彙は残す", async (t) => {
  const f = await fixture(t, ["speech-analyzer"]);
  const file = path.join(f.directory, "transcripts/speech-analyzer.json");
  const data = await json(file);
  for (const [text, fillers, redos] of [
    ["あの、あの", 0, 1], ["あの、あの、あの", 0, 1],
    ["あのあの", 0, 1], ["あの、 \tあの", 0, 0],
    ["あの、まあ", 2, 0], ["あの、前、あの", 2, 0], ["あの。あの", 2, 0],
    ["まあ、あの、あの、えーと", 2, 1],
  ]) {
    data.segments = [{ text, start: 0, end: text.length * 0.5 }];
    await putJson(file, data);
    const summary = await transcribeCutsMedia(f.target, { ...f.options, silencesRunner: async () => [] });
    assert.equal(summary.by_kind.filler, fillers, text);
    assert.equal(summary.by_kind.redo, redos, text);
  }
});

test("採用フィラーと重なる言い直しは落とし、端が接する言い直しは残す", async (t) => {
  const f = await fixture(t, ["speech-analyzer"]);
  const file = path.join(f.directory, "transcripts/speech-analyzer.json");
  const data = await json(file);
  for (const [text, fillers, redos] of [["あのね、あのね", 2, 0], ["あの説明説明", 1, 0], ["あの、説明説明", 1, 1]]) {
    const words = Array.from(text).map((char, i) => ({ text: char, start: i * 0.5, end: (i + 1) * 0.5 }));
    // Give the comma no duration so the filler and the following redo touch exactly.
    if (text === "あの、説明説明") for (let i = 3; i < words.length; i += 1) {
      words[i].start -= 0.5;
      words[i].end -= 0.5;
    }
    data.segments = [{ text, start: 0, end: text.length * 0.5, words }];
    await putJson(file, data);
    const summary = await transcribeCutsMedia(f.target, { ...f.options, silencesRunner: async () => [] });
    assert.equal(summary.by_kind.filler, fillers, text);
    assert.equal(summary.by_kind.redo, redos, text);
    const candidates = (await readCuts(f)).candidates;
    assert.ok(candidates.filter((c) => c.kind === "redo").every((redo) => candidates
      .filter((c) => c.kind === "filler").every((filler) => !(filler.start < redo.end && filler.end > redo.start))));
  }
});

test("countFillerHits は長い語彙を優先し非重複で数える", () => {
  assert.equal(countFillerHits("あのー"), 1);
  assert.equal(countFillerHits("あのーそのーえーとうーん"), 4);
  for (const filler of FILLER_LEXICON) assert.equal(countFillerHits(filler), 1, filler);
});

test("countFillerHits は句読点・空白を落として本文を走査する", () => {
  assert.equal(countFillerHits("あの、まあ"), 2);
  assert.equal(countFillerHits("説明。あ、の まあ！"), 2);
});

test("countFillerHits は語彙のない本文と空文字列なら 0 件", () => {
  assert.equal(countFillerHits("説明です。"), 0);
  assert.equal(countFillerHits(""), 0);
});

test("basis は words のない本文だけでもフィラーヒット数が最多のエンジンを選ぶ", () => {
  const transcripts = [
    { backend: "whisper-cpp", segments: [{ text: "えー、説明" }] },
    { backend: "speech-analyzer", segments: [
      { text: "あの、説明、まあ" },
      { text: "えっと、説明" },
    ] },
  ];
  const before = structuredClone(transcripts);
  assert.deepEqual(pickBasisByFillerHits(transcripts), {
    basis: transcripts[1], hits: 3, reason: "filler_hits=3 (speech-analyzer) > 1 (whisper-cpp)",
  });
  assert.deepEqual(transcripts, before);
  assert.equal(pickBasisByFillerHits([transcripts[0]]).reason, "filler_hits=1 (whisper-cpp)");
});

test("basis のヒット数は words の文字単位・語単位・省略で変わらない", () => {
  const text = "説明、あのー、まあ、その";
  for (const words of [undefined, Array.from(text).map((text) => ({ text })),
    ["説明", "あのー", "まあ", "その"].map((text) => ({ text }))]) {
    const transcript = { backend: "speech-analyzer", segments: [{ text, ...(words ? { words } : {}) }] };
    assert.deepEqual(pickBasisByFillerHits([transcript]), {
      basis: transcript, hits: 3, reason: "filler_hits=3 (speech-analyzer)",
    });
  }
});

test("basis の同数ヒットは契約の優先順で選ぶ", () => {
  const transcripts = ["cloud-groq", "speech-analyzer", "whisper-cpp", "cloud-scribe"]
    .map((backend) => ({ backend, segments: [{ text: "あの、説明" }] }));
  assert.equal(pickBasisByFillerHits(transcripts).reason,
    "filler_hits=1 (cloud-scribe) > 1 (whisper-cpp) > 1 (speech-analyzer) > 1 (cloud-groq)");
  while (transcripts.length) {
    assert.equal(pickBasisByFillerHits(transcripts).basis, transcripts.at(-1));
    transcripts.pop();
  }
});

test("basis は全エンジン 0 件でも優先順、未知の backend 同士は入力順", () => {
  const transcripts = ["unknown-first", "cloud-groq", "speech-analyzer", "whisper-cpp", "cloud-scribe"]
    .map((backend) => ({ backend, segments: [{ text: "説明", words: [{ text: "説明" }] }] }));
  while (transcripts.length) {
    const result = pickBasisByFillerHits(transcripts);
    assert.equal(result.basis, transcripts.at(-1));
    assert.equal(result.hits, 0);
    transcripts.pop();
  }
  const unknown = ["unknown-first", "unknown-second"].map((backend) => ({ backend, segments: [] }));
  assert.equal(pickBasisByFillerHits(unknown).basis, unknown[0]);
});

test("fixture: filler 3 / redo 1 / silence 2 / unrecognized 1 はすべて既定 OFF", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const lines = [], errors = [];
  const exit = await runMediaCli(["transcribe-cuts", f.target], { ...f.options,
    stdout: (line) => lines.push(line), stderr: (line) => errors.push(line),
    silencesRunner: async (args) => {
      calls += 1;
      assert.equal(args.silenceDb, -35);
      assert.equal(args.silenceMinSec, 0.2);
      assert.deepEqual(args.range, { in: 0, out: 30 });
      return { silences: silenceSpans };
    },
  });
  assert.equal(exit, 0, errors.join("\n"));
  assert.equal(calls, 1);
  assert.equal(lines.length, 1);
  const summary = JSON.parse(lines[0]);
  assert.deepEqual(summary.by_kind, { filler: 3, redo: 1, silence: 2, unrecognized: 1 });
  assert.equal(summary.on, 0);
  const cuts = await readCuts(f);
  assert.equal(cuts.version, 1);
  assert.equal(cuts.basis, "cloud-scribe");
  assert.equal(cuts.basis_reason, "filler_hits=3 (cloud-scribe) > 3 (whisper-cpp) > 0 (speech-analyzer)");
  assert.equal(summary.basis_reason, cuts.basis_reason);
  assert.deepEqual(cuts.rules, { filler: "off", redo: "off", silence_min_sec: 1.5, silence_keep_sec: 0.5, silence_break_sec: 3, unrecognized: "off" });
  assert.deepEqual(cuts.hand_edited, []);
  assert.ok(cuts.candidates.every((c) => c.default_on === false && c.on === false));
  assert.deepEqual(cuts.candidates.filter((c) => c.kind === "silence").map((c) => [c.start, c.end, c.on]), [[23, 24.9, false], [26, 29.2, false]]);
  assert.ok(cuts.candidates.find((c) => c.kind === "unrecognized").on === false);
  const fillers = cuts.candidates.filter((c) => c.kind === "filler");
  assert.equal(fillers[0].timing, undefined);
  assert.equal(fillers[1].timing, "estimated");
  const redo = cuts.candidates.find((c) => c.kind === "redo");
  assert.equal(redo.text, "で、で、");
  assert.ok(redo.end < 15.1);
  t.diagnostic(`fixture stdout: ${lines[0]}`);
});

test("filler / redo は明示 on のときだけ既定 ON、rules に適用値を記録する", async (t) => {
  for (const [filler, redo] of [["on", "on"], ["on", "off"], ["off", "on"], ["off", "off"]]) {
    const f = await fixture(t);
    await transcribeCutsMedia(f.target, { ...f.options, filler, redo });
    const cuts = await readCuts(f);
    assert.equal(cuts.rules.filler, filler);
    assert.equal(cuts.rules.redo, redo);
    assert.ok(cuts.candidates.some((c) => c.kind === "filler"));
    assert.ok(cuts.candidates.some((c) => c.kind === "redo"));
    for (const candidate of cuts.candidates) {
      const expected = candidate.kind === "filler" ? filler === "on" : candidate.kind === "redo" && redo === "on";
      assert.equal(candidate.default_on, expected);
      assert.equal(candidate.on, expected);
    }
    const errors = [];
    assert.equal(await runMediaCli(["transcribe-cuts", f.target, "--filler", filler, "--redo", redo], {
      ...f.options, stdout: () => {}, stderr: (line) => errors.push(line),
    }), 0, errors.join("\n"));
    assert.deepEqual(await readCuts(f), cuts);
  }
});

test("既存の on は id で引き継ぎ、手直しの default_on 変更も人の採否を覆さない", async (t) => {
  const f = await fixture(t);
  Object.assign(f.options, { filler: "on", redo: "on" });
  await transcribeCutsMedia(f.target, f.options);
  const first = await readCuts(f);
  for (const candidate of first.candidates) candidate.on = !candidate.on;
  await putJson(path.join(f.directory, "cuts.json"), first);
  const chosen = first.candidates.find((candidate) => candidate.kind === "filler");
  const captions = [{ start: 0.4, end: 0.9, text: "手直し", edited: true }];
  await putJson(path.join(f.project, "captions.json"), { captions });
  const before = await readFile(path.join(f.project, "captions.json"), "utf8");
  await transcribeCutsMedia(f.target, f.options);
  const second = await readCuts(f);
  assert.deepEqual(second.candidates.map((c) => [c.id, c.on]), first.candidates.map((c) => [c.id, c.on]));
  assert.deepEqual(second.hand_edited, [{ candidate: chosen.id, line: 1 }]);
  assert.equal(second.candidates.find((c) => c.id === chosen.id).default_on, false);
  assert.equal(await readFile(path.join(f.project, "captions.json"), "utf8"), before);
});

test("caption の同区間の本文で手直しを判定し、フラグだけでは OFF にしない", async (t) => {
  const f = await fixture(t);
  Object.assign(f.options, { filler: "on", redo: "on" });
  await putJson(path.join(f.project, "captions.json"), [
    { start: 0.4, end: 0.9, text: "えー、", edited: true },
    { start: 7, end: 7.5, text: "修正", edited: false },
    { start: 18, end: 18.7, text: "別素材", src: "other.wav" },
  ]);
  await transcribeCutsMedia(f.target, f.options);
  const cuts = await readCuts(f);
  assert.deepEqual(cuts.hand_edited, [{ candidate: "filler-7.0", line: 2 }]);
  assert.equal(cuts.candidates.find((c) => c.id === "filler-7.0").on, false);
  assert.equal(cuts.candidates.find((c) => c.id === "filler-0.4").on, true);
});

test("basis 優先順と明示指定、無音の境界値と keep", async (t) => {
  for (const [engines, expected] of [
    [["whisper-cpp", "speech-analyzer"], "whisper-cpp"],
    [["speech-analyzer"], "speech-analyzer"],
  ]) {
    const f = await fixture(t, engines);
    assert.equal((await transcribeCutsMedia(f.target, f.options)).basis, expected);
  }
  const f = await fixture(t);
  const lines = [];
  assert.equal(await runMediaCli(["transcribe-cuts", f.target, "--basis", "speech-analyzer", "--silence-min", "1.5", "--silence-break", "3", "--silence-keep", "0.25"], {
    ...f.options, stdout: (line) => lines.push(line), stderr: () => {},
    silencesRunner: async () => [{ start: 0, end: 1.499 }, { start: 2, end: 3.5 }, { start: 4, end: 7 }],
  }), 0);
  assert.equal(JSON.parse(lines[0]).basis, "speech-analyzer");
  assert.equal(JSON.parse(lines[0]).basis_reason, "explicit (--basis speech-analyzer)");
  assert.equal((await readCuts(f)).basis_reason, "explicit (--basis speech-analyzer)");
  assert.deepEqual((await readCuts(f)).candidates.filter((c) => c.kind === "silence").map((c) => [c.start, c.end, c.on]), [[2, 3.25, false], [4, 6.75, false]]);
});

test("自動 basis は優先順よりフィラーヒット数を優先し、理由を sidecar と要約に残す", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.directory, "transcripts/speech-analyzer.json");
  const data = await json(file);
  data.segments = Array.from({ length: 5 }, (_, i) => ({ start: i, end: i + 0.5, text: "あの、説明" }));
  await putJson(file, data);
  const summary = await transcribeCutsMedia(f.target, f.options);
  const cuts = await readCuts(f);
  assert.equal(summary.basis, "speech-analyzer");
  assert.equal(cuts.basis, summary.basis);
  assert.equal(summary.basis_reason, "filler_hits=5 (speech-analyzer) > 3 (cloud-scribe) > 3 (whisper-cpp)");
  assert.equal(cuts.basis_reason, summary.basis_reason);
});

for (const [text, unit, count] of [["で、で、", "で", 2], ["あの、あの", "あの", 2], ["ちゃんと、ちゃんと、ちゃんと", "ちゃんと", 3]]) {
  test(`言い直し正例 ${text}: 語境界を含めず最後の 1 回を残す`, async (t) => {
    const f = await fixture(t, ["cloud-scribe"]);
    const file = path.join(f.directory, "transcripts/cloud-scribe.json");
    const data = await json(file);
    for (const prefix of ["", ...Array.from("、,。！？.!? ").map((boundary) => `前${boundary}`)]) {
      data.segments = [{ start: 0, end: 20, text: prefix + text,
        words: Array.from({ length: count }, (_, i) => ({ text: unit, start: 10 + i, end: 11 + i })),
      }];
      await putJson(file, data);
      await transcribeCutsMedia(f.target, f.options);
      const redos = (await readCuts(f)).candidates.filter((c) => c.kind === "redo");
      assert.equal(redos.length, 1, prefix + text);
      assert.equal(redos[0].text, text);
      assert.equal(redos[0].start, 10);
      assert.equal(redos[0].end, 10 + count - 1);
    }
  });
}

for (const text of ["いい", "かか", "ここ", "かかる", "見ているいる"]) {
  test(`言い直し負例 ${text}: 1 文字反復と語中の反復は拾わない`, async (t) => {
    const f = await fixture(t, ["cloud-scribe"]);
    const file = path.join(f.directory, "transcripts/cloud-scribe.json");
    const data = await json(file);
    data.segments = [{ start: 0, end: 2, text }];
    await putJson(file, data);
    await transcribeCutsMedia(f.target, f.options);
    assert.deepEqual((await readCuts(f)).candidates.filter((c) => c.kind === "redo"), []);
  });
}

test("未認識はエンジンをまたぐ和集合、退避版は無視", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.directory, "transcripts/whisper-cpp.json");
  const data = await json(file);
  data.segments[0].unrecognized = [{ start: 12, end: 14 }, { start: 13.5, end: 15 }];
  await putJson(file, data);
  await putJson(path.join(f.directory, "transcripts/whisper-cpp.old.json"), { invalid: true });
  await transcribeCutsMedia(f.target, f.options);
  assert.deepEqual((await readCuts(f)).candidates.filter((c) => c.kind === "unrecognized").map((c) => [c.start, c.end, c.default_on, c.on]), [[11.2, 15, false, false]]);
});

test("全フィラー語彙、語単位の中間フィラー、3 回の redo は最後の 1 回を残す", async (t) => {
  const f = await fixture(t, ["cloud-scribe"]);
  const file = path.join(f.directory, "transcripts/cloud-scribe.json");
  const data = await json(file);
  data.segments = FILLER_LEXICON.map((word, i) => ({ start: i, end: i + 0.8, text: `${word}、説明` }));
  data.segments.push({ start: 20, end: 23, text: "前、あの、後", words: [
    { text: "前", start: 20, end: 21 }, { text: "あの", start: 21, end: 22 }, { text: "後", start: 22, end: 23 },
  ] });
  data.segments.push({ start: 24, end: 27, text: "ちゃんと、ちゃんと、ちゃんと", words: [
    { text: "ちゃんと", start: 24, end: 25 }, { text: "ちゃんと", start: 25, end: 26 }, { text: "ちゃんと", start: 26, end: 27 },
  ] });
  await putJson(file, data);
  await transcribeCutsMedia(f.target, { ...f.options, silencesRunner: async () => [] });
  const cuts = await readCuts(f);
  assert.equal(cuts.candidates.filter((c) => c.kind === "filler").length, 15);
  const mid = cuts.candidates.find((c) => c.kind === "filler" && c.start === 21);
  assert.equal(mid.text, "あの、");
  assert.equal(mid.end, 22);
  assert.equal(mid.timing, undefined);
  const redo = cuts.candidates.find((c) => c.kind === "redo" && c.start === 24);
  assert.equal(redo.end, 26);
});

test("共有 runSilenceDetect の ffmpeg 引数を使い、素材異常は exit 2", async (t) => {
  const f = await fixture(t);
  let silenceArgs;
  await transcribeCutsMedia(f.target, { ...f.options, silencesRunner: undefined, spawn: (command, args) => {
    if (command === "fixture-ffprobe") return f.options.spawn();
    silenceArgs = args;
    return { status: 0, stdout: "", stderr: "silence_start: 23\nsilence_end: 25.4 | silence_duration: 2.4\n" };
  } });
  assert.ok(silenceArgs.includes("silencedetect=noise=-35dB:d=0.2"));
  assert.deepEqual(silenceArgs.slice(2, 8), ["-ss", "0", "-to", "30", "-i", path.join(f.project, f.target)]);
  const common = { ...f.options, stdout: () => {}, stderr: () => {} };
  assert.equal(await runMediaCli(["transcribe-cuts", "missing.wav"], common), 2);
  assert.equal(await runMediaCli(["transcribe-cuts", f.target], { ...common, spawn: () => ({ status: 1, stderr: "decode failed" }) }), 2);
  assert.equal(await runMediaCli(["transcribe-cuts", f.target, "--basis", "absent"], common), 1);
  assert.equal(await runMediaCli(["transcribe-cuts", f.target, "--silence-min", "-1"], common), 1);
  for (const flag of ["--filler", "--redo"]) {
    const errors = [];
    assert.equal(await runMediaCli(["transcribe-cuts", f.target, flag, "invalid"], {
      ...common, stderr: (line) => errors.push(line),
    }), 1);
    assert.match(errors[0], /on \/ off/);
  }
});
