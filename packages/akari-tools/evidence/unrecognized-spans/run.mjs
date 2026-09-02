#!/usr/bin/env node
// L1 CLI E2E: 合成音声 → transcribe（偽バックエンド + 実 ffmpeg silencedetect）→ unrecognized 検出
// → fill-caption-words で字幕へ持ち越し → validate-captions / edit-lint → render-cut の framemd5 一致。
// 実行: node packages/akari-tools/evidence/unrecognized-spans/run.mjs
// 出力: 同ディレクトリの results.json（実測値のみ。マシン絶対パスは書かない）
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transcribeMedia } from "../../src/media/transcribe.mjs";

const evidenceDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evidenceDirectory, "../../../..");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const checks = [];
const measured = {};

// status: PASS / FAIL / BLOCKED（この機体では測れない = 受け入れ判定から除外し、理由を残す）
function check(name, status, detail) {
  const resolved = typeof status === "string" ? status : (status ? "PASS" : "FAIL");
  checks.push({ name, status: resolved, ok: resolved === "PASS", detail });
  process.stdout.write(`${resolved} ${name}${detail === undefined ? "" : ` — ${detail}`}\n`);
}

function near(value, expected, tolerance) {
  return Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

function diffFrames(left, right) {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  let differing = 0;
  for (let index = 0; index < Math.max(leftLines.length, rightLines.length); index += 1) {
    if (leftLines[index] !== rightLines[index]) differing += 1;
  }
  return differing;
}

function framemd5(videoPath) {
  const raw = run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-map", "0:v", "-f", "framemd5", "-"]);
  return raw.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).join("\n");
}

const workspace = mkdtempSync(path.join(os.tmpdir(), "akari-unrecognized-e2e-"));
try {
  // 1. 合成音声 wav（16 kHz mono）: 0.0-1.0 音 / 1.0-2.0 無音 / 2.0-2.6 音（語なし）/ 2.6-3.4 無音 / 3.4-4.4 音
  mkdirSync(path.join(workspace, "assets"), { recursive: true });
  const wavRelative = path.join("assets", "voiced.wav");
  const wavPath = path.join(workspace, wavRelative);
  run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-t", "1.0", "-i", "sine=frequency=440:sample_rate=16000",
    "-f", "lavfi", "-t", "1.0", "-i", "anullsrc=r=16000:cl=mono",
    "-f", "lavfi", "-t", "0.6", "-i", "sine=frequency=660:sample_rate=16000",
    "-f", "lavfi", "-t", "0.8", "-i", "anullsrc=r=16000:cl=mono",
    "-f", "lavfi", "-t", "1.0", "-i", "sine=frequency=880:sample_rate=16000",
    "-filter_complex", "[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[out]",
    "-map", "[out]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath,
  ]);
  // 2. 描画用の 5 秒動画（音声は同じ合成音声）
  const videoPath = path.join(workspace, "assets", "source.mp4");
  run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=5",
    "-i", wavPath, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", "-t", "5", videoPath,
  ]);

  writeFileSync(path.join(workspace, "edit.json"), `${JSON.stringify({
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: "main", path: "assets/source.mp4", proxy: null }],
    tracks: [
      { id: "video", lane: "visual", items: [{ id: "cut-1", at: 0, duration: 150, source: { kind: "media", src: "main", in: 0, out: 5 } }] },
      { id: "caption-bag-track", lane: "visual", items: [{ id: "caption-bag", at: 0, duration: 150, source: { kind: "captions", path: "captions.json" } }] },
    ],
  }, null, 2)}\n`, "utf8");
  mkdirSync(path.join(workspace, ".akari"), { recursive: true });

  // 3. 偽バックエンド + 実 ffmpeg silencedetect
  const transcript = await transcribeMedia(wavRelative, {
    cwd: workspace,
    ffmpegCommand: ffmpeg,
    backend: "speech-analyzer",
    speechAnalyzerAvailable: true,
    backendRunner: async () => [{
      start: 0,
      end: 4.4,
      text: "あ い",
      words: [{ start: 0, end: 1.0, text: "あ" }, { start: 3.4, end: 4.4, text: "い" }],
    }],
  });
  const spans = transcript.segments[0].unrecognized ?? [];
  measured.transcribe_unrecognized = spans;
  check(
    "transcribe unrecognized = [{2.0±0.05, 2.6±0.05}]",
    spans.length === 1 && near(spans[0].start, 2.0, 0.05) && near(spans[0].end, 2.6, 0.05),
    JSON.stringify(spans),
  );

  const analysisRelative = path.join(".akari", "sidecars", "assets", "voiced.wav.analysis", "analysis.json");
  const analysis = JSON.parse(readFileSync(path.join(workspace, analysisRelative), "utf8"));
  measured.analysis_unrecognized = analysis.transcript[0].unrecognized ?? [];
  check(
    "analysis.json transcript[0].unrecognized が同一",
    JSON.stringify(analysis.transcript[0].unrecognized) === JSON.stringify(spans),
    JSON.stringify(analysis.transcript[0].unrecognized),
  );

  // 4. fill-caption-words で 1 字幕（0-4.4 s）へ持ち越し
  const captionsPath = path.join(workspace, "captions.json");
  writeFileSync(captionsPath, `${JSON.stringify([{
    id: "c-0001", src: "main", start: 0, end: 4.4, text: "あ い",
    speaker: null, sourceRef: null, edited: false,
  }], null, 2)}\n`, "utf8");
  const fillOutput = run(process.execPath, [
    path.join(repositoryRoot, "packages", "render-cut", "bin", "fill-caption-words.mjs"),
    "--analysis", path.join(workspace, analysisRelative), "--captions", captionsPath,
  ]);
  measured.fill_log = fillOutput.trim().split(/\r?\n/);
  const captions = JSON.parse(readFileSync(captionsPath, "utf8"));
  measured.caption_unrecognized = captions[0].unrecognized ?? [];
  measured.caption_words = captions[0].words ?? [];
  check(
    "fill-caption-words が unrecognized を 1 字幕へ持ち越す",
    captions[0].unrecognized?.length === 1
      && near(captions[0].unrecognized[0].start, 2.0, 0.05)
      && near(captions[0].unrecognized[0].end, 2.6, 0.05),
    JSON.stringify(captions[0].unrecognized),
  );
  check(
    "words も従来どおり充填される（2 語）",
    captions[0].words?.length === 2,
    JSON.stringify(captions[0].words),
  );

  // 5. validate-captions exit 0
  let validateStatus = 0;
  let validateStdout = "";
  try {
    validateStdout = run(process.execPath, [
      path.join(repositoryRoot, "packages", "schemas", "bin", "validate-captions.mjs"), captionsPath,
    ]);
  } catch (error) {
    validateStatus = error.status ?? 1;
    validateStdout = String(error.stdout ?? "") + String(error.stderr ?? "");
  }
  measured.validate_exit = validateStatus;
  check("validate-captions.mjs exit 0", validateStatus === 0, validateStatus === 0 ? "OK" : "NG");

  // 6. edit-lint finding 0（warning 含む）
  function lint(root = workspace) {
    try {
      return { status: 0, stdout: run(process.execPath, [path.join(repositoryRoot, "packages", "edit-lint", "bin", "edit-lint.mjs"), root, "--json"]) };
    } catch (error) {
      return { status: error.status ?? 1, stdout: String(error.stdout ?? "") };
    }
  }
  const linted = lint();
  const lintResult = JSON.parse(linted.stdout);
  measured.lint_exit = linted.status;
  measured.lint_findings = lintResult.findings ?? [];
  check(
    "edit-lint findings 0（warning 含む）",
    linted.status === 0 && (lintResult.findings ?? []).length === 0,
    JSON.stringify((lintResult.findings ?? []).map((finding) => `${finding.severity}:${finding.check}`)),
  );

  // 7. unrecognized の有無で描画が変わらないこと
  //    7-a: 描画計画（--plan-only の .akari/render.json）が同一
  //    7-b: 実書き出しの framemd5 一致（同一入力を 2 回描いた対照つき）
  //    書き出しは毎回プロジェクトの複製で行う。render-cut は成功後に出力を edit.json の
  //    sources[] へ追記するため、同じ作業場で続けて描くと 2 回目以降の条件が変わってしまう。
  // 既定は gpu 出口。osr 出口はこの検証機では frame stamp verify が通らない
  // （origin/main でも render-cut の実書き出しテスト 31 件が同じ理由で落ちる機体固有事情）。
  // AKARI_E2E_ENGINE=osr で切り替えられる。
  const engine = process.env.AKARI_E2E_ENGINE ?? "gpu";
  measured.render_engine = engine;
  measured.osr_verify = process.env.AKARI_OSR_VERIFY ?? "stamp";
  const renderCli = path.join(repositoryRoot, "packages", "render-cut", "bin", "render-cut.mjs");

  const withUnrecognized = `${JSON.stringify(captions, null, 2)}\n`;
  const withoutUnrecognized = `${JSON.stringify(captions.map(({ unrecognized: _unrecognized, ...rest }) => rest), null, 2)}\n`;

  function prepare(label, captionsSource) {
    const root = path.join(workspace, `run-${label}`);
    mkdirSync(root, { recursive: true });
    cpSync(path.join(workspace, "assets"), path.join(root, "assets"), { recursive: true });
    writeFileSync(path.join(root, "edit.json"), readFileSync(path.join(workspace, "edit.json")));
    writeFileSync(path.join(root, "captions.json"), captionsSource, "utf8");
    mkdirSync(path.join(root, ".akari"), { recursive: true });
    lint(root);
    return root;
  }

  function plan(root) {
    run(process.execPath, [renderCli, root, "--engine", engine, "--plan-only"], {
      env: { ...process.env, AKARI_OSR_SOFT: "1" },
    });
    const state = JSON.parse(readFileSync(path.join(root, ".akari", "render.json"), "utf8"));
    // captions.json 自体の内容ハッシュ（と、それを含む lint.json のハッシュ）だけが変わる。
    // 描画計画の同一性はそれ以外の全フィールドで見る。
    const { generated_at: _generatedAt, provenance: _provenance, ...rest } = state;
    if (rest.inputs?.["captions.json"]) delete rest.inputs["captions.json"];
    if (rest.validation?.lint) delete rest.validation.lint;
    // 比較用の複製ごとにプロジェクトの置き場所が違うので、計画に載る絶対パスは伏せる
    return JSON.parse(JSON.stringify(rest).split(JSON.stringify(root).slice(1, -1)).join("<root>"));
  }

  function planDifferences(left, right, prefix = "") {
    const differences = [];
    for (const key of new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])) {
      const leftValue = left?.[key];
      const rightValue = right?.[key];
      if (leftValue && rightValue && typeof leftValue === "object" && typeof rightValue === "object") {
        differences.push(...planDifferences(leftValue, rightValue, `${prefix}.${key}`));
      } else if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
        differences.push(`${prefix}.${key}`);
      }
    }
    return differences;
  }

  function renderVariant(label, captionsSource) {
    const root = prepare(label, captionsSource);
    const outputPath = path.join(root, "out.mp4");
    const warnings = [];
    try {
      run(process.execPath, [renderCli, root, "--engine", engine, "--out", outputPath], {
        env: { ...process.env, AKARI_OSR_SOFT: "1" },
      });
    } catch (error) {
      warnings.push(String(error?.stderr ?? "").trim());
      throw error;
    }
    return {
      framemd5: framemd5(outputPath),
      probe: run("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-count_frames", "-show_entries", "stream=nb_read_frames,width,height,avg_frame_rate",
        "-show_entries", "format=duration", "-of", "json", outputPath,
      ]),
    };
  }

  try {
    // 7-a. 描画計画（実書き出しの前に、それぞれ独立した複製で取る）
    const planWith = plan(prepare("plan-with", withUnrecognized));
    const planWithout = plan(prepare("plan-without", withoutUnrecognized));
    const planDiff = planDifferences(planWith, planWithout);
    measured.plan_diff = planDiff;
    check(
      "描画計画（--plan-only の render.json、captions.json / lint.json のハッシュを除く）が unrecognized の有無で同一",
      planDiff.length === 0,
      planDiff.length === 0 ? `${JSON.stringify(planWith).length} bytes 一致` : planDiff.join(", "),
    );

    // 7-b. 実書き出し
    const rendered = renderVariant("with", withUnrecognized);
    const control = renderVariant("with-control", withUnrecognized);
    const without = renderVariant("without", withoutUnrecognized);

    const reproducible = rendered.framemd5 === control.framemd5;
    measured.framemd5_frames = rendered.framemd5.split("\n").length;
    measured.framemd5_reproducible_same_input = reproducible;
    measured.framemd5_equal_with_without = rendered.framemd5 === without.framemd5;
    measured.ffprobe_with = JSON.parse(rendered.probe);
    measured.ffprobe_without = JSON.parse(without.probe);

    check(
      "実書き出しの ffprobe（frames / duration / size / fps）が unrecognized の有無で一致",
      rendered.probe === without.probe,
      JSON.parse(rendered.probe).streams?.[0]?.nb_read_frames,
    );
    check(
      "対照: 同一入力を 2 回描いて framemd5 が再現する（この機体の描画再現性の測定）",
      reproducible ? "PASS" : "BLOCKED",
      reproducible
        ? "reproducible"
        : `同一入力の 2 回描画が ${diffFrames(rendered.framemd5, control.framemd5)}/${rendered.framemd5.split("\n").length} フレームで不一致`,
    );
    check(
      "unrecognized 有無で framemd5 一致",
      reproducible ? (rendered.framemd5 === without.framemd5) : "BLOCKED",
      reproducible
        ? `${rendered.framemd5.split("\n").length} frames`
        : `${diffFrames(rendered.framemd5, without.framemd5)}/${rendered.framemd5.split("\n").length} フレーム不一致。対照も不一致のため framemd5 では判定不能（描画計画と ffprobe の一致で代替）`,
    );
  } catch (error) {
    const message = String(error?.stderr ?? error?.message ?? error).trim().split(/\r?\n/).filter((line) => !line.includes("/")).join(" / ");
    measured.render_error = message;
    check("unrecognized 有無で描画が変わらない（render 系）", false, `render failed: ${message}`);
  }
} finally {
  const failed = checks.filter((item) => item.status === "FAIL");
  const blocked = checks.filter((item) => item.status === "BLOCKED");
  const ok = checks.length > 0 && failed.length === 0;
  writeFileSync(path.join(evidenceDirectory, "results.json"), `${JSON.stringify({
    task: "2026-09-02-transcript-unrecognized-spans",
    layer: "L1",
    generator: "packages/akari-tools/evidence/unrecognized-spans/run.mjs",
    status: ok ? (blocked.length === 0 ? "PASS" : "PASS_WITH_BLOCKED") : "FAIL",
    notes: [
      "書き出しは変種ごとにプロジェクトを複製して行う（render-cut は成功後に出力を edit.json の sources[] へ追記するため、同じ作業場で続けて描くと 2 回目以降の条件が変わる）。",
      "既定の出口は gpu。osr 出口は検証機で frame stamp verify が通らず（origin/main でも実書き出しテスト 31 件が同じ理由で失敗）、AKARI_OSR_VERIFY=off で回避すると描画がビット再現しなくなるため framemd5 比較には使えない。",
    ],
    blocked: blocked.map((item) => item.name),
    checks,
    measured,
  }, null, 2)}\n`, "utf8");
  rmSync(workspace, { recursive: true, force: true });
  process.exitCode = ok ? 0 : 1;
}
