import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runMediaCli } from "../bin/media.mjs";
import { resolveAnalyzeFootageScript, speechAnalyzerAvailable, transcribeMedia } from "../src/media/transcribe.mjs";

const scriptNames = ["transcribe-sa.mjs", "transcribe-cloud.mjs"];
const requirements = "SpeechAnalyzer は macOS 26 以上 + Command Line Tools が必要です";
const segments = [{ start: 0, end: 1, text: "test" }];
const success = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: "" });

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "akari-script-resolution-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  mkdirSync(path.join(project, ".akari"), { recursive: true });
  writeFileSync(path.join(project, "input.wav"), "mock audio");
  writeFileSync(path.join(project, ".akari", "connections.json"), JSON.stringify({
    providers: [{ id: "groq-test", doctor: { status: "ok" } }],
  }));
  const calls = [];
  const logs = [];
  const options = {
    repoRoot: root, cwd: project, noRecord: true, wordBook: false, unrecognized: false,
    ffmpegCommand: "mock-ffmpeg", ffprobeCommand: "mock-ffprobe",
    whisperBin: "mock-whisper", whisperModel: "mock-model",
    logger: (line) => logs.push(line),
    spawn(command, args) {
      calls.push({ command, args });
      if (command === "mock-ffprobe") return success({ format: { duration: 2 }, streams: [{ codec_type: "audio" }] });
      if (command === "mock-ffmpeg") return success({});
      if (command === "mock-whisper") {
        writeFileSync(`${args[args.indexOf("-of") + 1]}.json`, JSON.stringify({ segments }));
        return success({});
      }
      assert.equal(command, process.execPath);
      assert.ok(scriptNames.includes(path.basename(args[0])));
      return success({ available: true, segments });
    },
  };
  const candidate = (name, vendor = false) => path.join(root,
    ...(vendor ? ["packages", "akari-launcher", "vendor"] : []), "skills", "analyze-footage", "bin", name);
  const put = (name, vendor = false) => {
    const script = candidate(name, vendor);
    mkdirSync(path.dirname(script), { recursive: true });
    writeFileSync(script, "// mock implementation\n");
    return script;
  };
  return { root, options, calls, logs, candidate, put };
}

for (const name of scriptNames) {
  test(`${name}: モノレポ → vendor → null を毎回解決する`, (t) => {
    const f = fixture(t);
    assert.equal(resolveAnalyzeFootageScript(name, f.options), null);
    const vendor = f.put(name, true);
    assert.equal(resolveAnalyzeFootageScript(name, f.options), vendor);
    const monorepo = f.put(name);
    assert.equal(resolveAnalyzeFootageScript(name, f.options), monorepo);
    rmSync(monorepo);
    assert.equal(resolveAnalyzeFootageScript(name, f.options), vendor);
    rmSync(vendor);
    assert.equal(resolveAnalyzeFootageScript(name, f.options), null);
  });
}

test("vendor のみでも speechAnalyzerAvailable は --check を実行する", (t) => {
  const f = fixture(t);
  const vendor = f.put("transcribe-sa.mjs", true);
  assert.equal(speechAnalyzerAvailable(f.options), true);
  assert.deepEqual(f.calls, [{ command: process.execPath, args: [vendor, "--check"] }]);
  assert.deepEqual(f.logs, []);
});

for (const vendor of [false, true]) {
  test(`${vendor ? "vendor" : "モノレポ"}: 自動選択と SpeechAnalyzer 実行は解決したスクリプトを使う`, async (t) => {
    const f = fixture(t);
    const script = f.put("transcribe-sa.mjs", vendor);
    const result = await transcribeMedia("input.wav", f.options);
    assert.equal(result.backend, "speech-analyzer");
    assert.deepEqual(result.segments, segments);
    assert.deepEqual(f.calls.filter(({ command }) => command === process.execPath).map(({ args }) => args.slice(0, 2)),
      [[script, "--check"], [script, "--input"]]);
    assert.deepEqual(f.logs, []);
  });
}

for (const [reason, expected] of [
  [null, "SpeechAnalyzer の実装スクリプトが見つからない"],
  ["macOS 15.6 は 26 未満です", "macOS 26 未満"],
  ["swiftc が PATH 上にありません", "swiftc が無い"],
]) {
  test(`自動降格は stderr 1 行で理由を示し stdout JSON を保つ: ${expected}`, async (t) => {
    const f = fixture(t);
    if (reason) f.put("transcribe-sa.mjs", true);
    const stdout = [];
    const stderr = [];
    const spawn = f.options.spawn;
    const code = await runMediaCli(["transcribe", "input.wav", "--no-record"], {
      ...f.options, logger: undefined,
      stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line),
      spawn: (command, args) => args.includes("--check") ? success({ available: false, reason }) : spawn(command, args),
    });
    assert.equal(code, 0);
    assert.equal(stdout.length, 1);
    const result = JSON.parse(stdout[0]);
    assert.equal(result.backend, "whisper-cpp");
    assert.deepEqual(result.segments, segments);
    assert.equal(stderr.length, 1);
    assert.ok(stderr[0].includes(expected));
    if (!reason) {
      for (const vendor of [false, true]) assert.ok(stderr[0].includes(f.candidate("transcribe-sa.mjs", vendor)));
    }
    assert.doesNotMatch(stderr[0], /[\r\n]/);
  });
}

test("logger は降格ログを捕捉し改行を 1 行にする", async (t) => {
  const f = fixture(t);
  f.put("transcribe-sa.mjs");
  const spawn = f.options.spawn;
  await transcribeMedia("input.wav", {
    ...f.options,
    spawn: (command, args) => args.includes("--check")
      ? success({ available: false, reason: "check failed\nsecond line" }) : spawn(command, args),
  });
  assert.equal(f.logs.length, 1);
  assert.match(f.logs[0], /check failed second line/);
});

test("明示 whisper は SpeechAnalyzer のチェックも降格ログも出さない", async (t) => {
  const f = fixture(t);
  const result = await transcribeMedia("input.wav", { ...f.options, backend: "whisper-cpp" });
  assert.equal(result.backend, "whisper-cpp");
  assert.ok(f.calls.every(({ args }) => !args.includes("--check")));
  assert.deepEqual(f.logs, []);
});

test("明示 SpeechAnalyzer の欠落エラーは候補 2 つの絶対パスを含む", async (t) => {
  const f = fixture(t);
  assert.equal(speechAnalyzerAvailable(f.options), false);
  assert.deepEqual(f.calls, []);
  await assert.rejects(transcribeMedia("input.wav", { ...f.options, backend: "speech-analyzer" }), (error) => {
    assert.match(error.message, /^SpeechAnalyzer の実装が同梱されていません/);
    for (const vendor of [false, true]) assert.ok(error.message.includes(f.candidate("transcribe-sa.mjs", vendor)));
    assert.ok(!error.message.includes(requirements));
    return true;
  });
  assert.deepEqual(f.logs, []);
});

for (const reason of ["macOS 15.6 は 26 未満です", "swiftc が PATH 上にありません"]) {
  test(`明示 SpeechAnalyzer は環境要件エラーを示す: ${reason}`, async (t) => {
    const f = fixture(t);
    f.put("transcribe-sa.mjs", true);
    const spawn = f.options.spawn;
    const options = {
      ...f.options, backend: "speech-analyzer",
      spawn: (command, args) => args.includes("--check") ? success({ available: false, reason }) : spawn(command, args),
    };
    assert.equal(speechAnalyzerAvailable(options), false);
    await assert.rejects(transcribeMedia("input.wav", options), { message: requirements });
    assert.deepEqual(f.logs, []);
  });
}

test("チェック自体の失敗は利用不可となり原因を保持する", (t) => {
  const f = fixture(t);
  f.put("transcribe-sa.mjs");
  assert.equal(speechAnalyzerAvailable({ ...f.options, spawn: () => ({ status: 1, stderr: "node failed" }) }), false);
  assert.equal(speechAnalyzerAvailable({ ...f.options, spawn: () => ({ status: 0, stdout: "invalid JSON" }) }), false);
});

test("チェック後にスクリプトが移動しても実行時に vendor を再解決する", async (t) => {
  const f = fixture(t);
  const script = f.put("transcribe-sa.mjs");
  const vendor = f.put("transcribe-sa.mjs", true);
  const spawn = f.options.spawn;
  await transcribeMedia("input.wav", {
    ...f.options,
    spawn(command, args) {
      const result = spawn(command, args);
      if (args.includes("--check")) rmSync(script);
      return result;
    },
  });
  assert.equal(f.calls.find(({ args }) => args.includes("--input")).args[0], vendor);
});

for (const vendor of [false, true]) {
  test(`cloud は ${vendor ? "vendor" : "モノレポ"} のスクリプトを実行する`, async (t) => {
    const f = fixture(t);
    const script = f.put("transcribe-cloud.mjs", vendor);
    const result = await transcribeMedia("input.wav", { ...f.options, backend: "cloud:groq-test" });
    assert.equal(result.backend, "cloud:groq-test");
    assert.deepEqual(result.segments, segments);
    assert.equal(f.calls.find(({ args }) => args.includes("--send")).args[0], script);
    assert.deepEqual(f.logs, []);
  });
}

test("cloud はファイル欠落と実行失敗を区別する", async (t) => {
  const f = fixture(t);
  const options = { ...f.options, backend: "cloud:groq-test" };
  await assert.rejects(transcribeMedia("input.wav", options), (error) => {
    assert.match(error.message, /^クラウド文字起こしの実装が同梱されていません/);
    for (const vendor of [false, true]) assert.ok(error.message.includes(f.candidate("transcribe-cloud.mjs", vendor)));
    return true;
  });
  f.put("transcribe-cloud.mjs", true);
  await assert.rejects(transcribeMedia("input.wav", {
    ...options,
    spawn: (command, args) => args.includes("--send") ? { status: 1, stderr: "provider rejected request" } : options.spawn(command, args),
  }), { message: "クラウド文字起こしの実行に失敗しました: provider rejected request" });
  assert.deepEqual(f.logs, []);
});
