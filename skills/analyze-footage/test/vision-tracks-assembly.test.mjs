// vision-tracks.mjs の「配管」テスト（実 Vision 検出は行わない）。
//
// vision-tracks-helper（Swift・実 Vision 検出）を dummy-helper.mjs（固定パターンの
// JSON Lines を吐くだけの Node スクリプト）へ --helper-bin で差し替え、
// ffmpeg デコード → helper → 契約 §2 のトラックファイル組み立て → analysis.json への
// 原子的追記、という配管だけを検証する。実 Vision の検出精度・座標妥当性は
// tasks/2026-08-11-vision-tracks-v0/report.md に実素材の実測として記録する
// （このテストの対象外 — person-matte-helper 同様、Swift 側は node --test で
// 直接検証できないため、配管とヘルパー実装は別レイヤーとして検証する）。
//
// darwin 専用: vision-tracks.mjs の availability チェックが macOS を前提にしており
// （--helper-bin を差し替えても checkAvailability() 自体は変わらない）、CI が
// 非 darwin ランナーの場合はこのテストをスキップする。

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const wrapperScript = resolve(here, "../bin/vision-tracks/vision-tracks.mjs");
const dummyHelper = resolve(here, "fixtures/vision-tracks/dummy-helper.mjs");
// リポ内の既存の合成テスト素材（単色 10 秒）を使う。dummy-helper は画素内容を
// 見ないため、実顔・実手が写っている必要はなく、ffmpeg が実際にデコードできる
// 動画であればよい。
const sourceVideo = resolve(here, "../../../test-project/source.mp4");

const isDarwin = process.platform === "darwin";

function runWrapper(args) {
  return spawnSync(process.execPath, [wrapperScript, ...args], { encoding: "utf8" });
}

function makeScratchProject() {
  const dir = mkdtempSync(join(tmpdir(), "vision-tracks-assembly-test-"));
  const analysisPath = join(dir, "analysis.json");
  const analysis = {
    version: 0,
    source: "../rel-source.mp4",
    transcript: [{ start: 0, end: 1, text: "existing transcript segment" }],
    keyframes: [],
    events: [],
    tracks: { speakers: [], faces: [], person_matte: null },
  };
  writeFileSync(analysisPath, JSON.stringify(analysis), "utf8");
  return { dir, analysisPath };
}

test(
  "helper をダミーへ差し替えると JSON Lines がそのままトラックファイルへ組み立てられる",
  { skip: isDarwin ? false : "vision-tracks.mjs の availability チェックが darwin 前提" },
  () => {
    const { dir, analysisPath } = makeScratchProject();
    try {
      const result = runWrapper([
        "--input", sourceVideo,
        "--analysis", analysisPath,
        "--kinds", "face,hand",
        "--fps", "2",
        "--helper-bin", dummyHelper,
      ]);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const reported = JSON.parse(result.stdout);
      assert.equal(reported.ok, true);
      assert.deepEqual(reported.kinds, ["face", "hand"]);

      const faceTrack = JSON.parse(readFileSync(join(dir, "vision", "face-landmarks.json"), "utf8"));
      const handTrack = JSON.parse(readFileSync(join(dir, "vision", "hand-pose.json"), "utf8"));

      // トラックファイルの器（契約 §2）。
      assert.equal(faceTrack.version, 0);
      assert.equal(faceTrack.kind, "face-landmarks");
      assert.equal(handTrack.kind, "hand-pose");
      assert.equal(faceTrack.sample_fps, 2);
      assert.equal(faceTrack.provider.name, "apple-vision");

      // 2 段上がる相対パス算出（analysis.json の source は 1 段上、トラックファイルは
      // さらに vision/ の 1 段下にあるため合計 2 段）。
      assert.equal(faceTrack.source.path, "../../rel-source.mp4");
      assert.equal(faceTrack.source.duration, 10);

      // face / hand で samples 件数が一致する（同じ helper 実行・同じフレーム数から
      // 組み立てているため）。
      assert.equal(faceTrack.samples.length, handTrack.samples.length);
      assert.ok(faceTrack.samples.length > 0, "少なくとも 1 フレームは処理している");

      // t は 0 起点で fps の逆数刻み（等間隔サンプリング — 契約 §2）。
      for (const [index, sample] of faceTrack.samples.entries()) {
        assert.equal(sample.t, index / 2);
      }

      // dummy-helper.mjs の固定パターン: 偶数フレームは検出あり、奇数フレームは
      // 検出ゼロ（空配列）。「検出ゼロのフレームも t を残す」（契約 §2）の配管を確認する。
      for (const [index, sample] of faceTrack.samples.entries()) {
        if (index % 2 === 0) {
          assert.equal(sample.detections.length, 1);
          assert.deepEqual(sample.detections[0].box, [0.1, 0.2, 0.3, 0.4]);
          assert.deepEqual(Object.keys(sample.detections[0].landmarks).sort(), [
            "inner_lips", "left_eye", "left_pupil", "outer_lips", "right_eye", "right_pupil",
          ]);
        } else {
          assert.deepEqual(sample.detections, []);
        }
      }
      for (const [index, sample] of handTrack.samples.entries()) {
        if (index % 2 === 0) {
          assert.equal(sample.detections.length, 1);
          assert.equal(sample.detections[0].chirality, "right");
          assert.deepEqual(sample.detections[0].joints, { thumb_tip: [0.4, 0.6], index_tip: [0.5, 0.5] });
        } else {
          assert.deepEqual(sample.detections, []);
        }
      }

      // analysis.json への additive マージ: 既存フィールドは無傷、tracks に 2 キー追加。
      const analysisAfter = JSON.parse(readFileSync(analysisPath, "utf8"));
      assert.deepEqual(analysisAfter.transcript, [{ start: 0, end: 1, text: "existing transcript segment" }]);
      assert.equal(analysisAfter.tracks.person_matte, null);
      assert.deepEqual(analysisAfter.tracks.speakers, []);
      assert.equal(analysisAfter.tracks.face_landmarks.path, "vision/face-landmarks.json");
      assert.equal(analysisAfter.tracks.face_landmarks.sample_fps, 2);
      assert.equal(analysisAfter.tracks.face_landmarks.provider, "apple-vision");
      assert.equal(analysisAfter.tracks.face_landmarks.tool, "vision-tracks.mjs v0");
      assert.equal(analysisAfter.tracks.hand_pose.path, "vision/hand-pose.json");
      assert.ok(!Object.prototype.hasOwnProperty.call(analysisAfter, "tmp"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "--kinds face のみを再実行すると face_landmarks だけ更新し、既存の hand_pose ポインタは残す（プル駆動・契約 §0 原則 1）",
  { skip: isDarwin ? false : "vision-tracks.mjs の availability チェックが darwin 前提" },
  () => {
    const { dir, analysisPath } = makeScratchProject();
    try {
      const first = runWrapper([
        "--input", sourceVideo,
        "--analysis", analysisPath,
        "--kinds", "face,hand",
        "--fps", "2",
        "--helper-bin", dummyHelper,
      ]);
      assert.equal(first.status, 0, first.stderr);
      const afterFirst = JSON.parse(readFileSync(analysisPath, "utf8"));
      const handPointerBefore = afterFirst.tracks.hand_pose;

      const second = runWrapper([
        "--input", sourceVideo,
        "--analysis", analysisPath,
        "--kinds", "face",
        "--fps", "2",
        "--helper-bin", dummyHelper,
      ]);
      assert.equal(second.status, 0, second.stderr);
      const afterSecond = JSON.parse(readFileSync(analysisPath, "utf8"));

      assert.deepEqual(afterSecond.tracks.hand_pose, handPointerBefore, "face のみの再実行で hand_pose は変わらない");
      assert.notEqual(
        afterSecond.tracks.face_landmarks.generated_at,
        afterFirst.tracks.face_landmarks.generated_at,
        "face_landmarks は再生成されて generated_at が更新される",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "analysis.json が存在しないと明確なエラーで拒否する",
  { skip: isDarwin ? false : "vision-tracks.mjs の availability チェックが darwin 前提" },
  () => {
    const result = runWrapper([
      "--input", sourceVideo,
      "--analysis", "/nonexistent/analysis.json",
      "--helper-bin", dummyHelper,
    ]);
    const reported = JSON.parse(result.stdout);
    assert.equal(reported.ok, false);
    assert.match(reported.reason, /analysis\.json が見つかりません/);
  },
);

test(
  "analysis.json の tracks が object でないと拒否する（tracks キー自体は必須のまま）",
  { skip: isDarwin ? false : "vision-tracks.mjs の availability チェックが darwin 前提" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "vision-tracks-assembly-test-"));
    try {
      const analysisPath = join(dir, "analysis.json");
      writeFileSync(analysisPath, JSON.stringify({ version: 0, source: "x.mp4" }), "utf8");
      const result = runWrapper([
        "--input", sourceVideo,
        "--analysis", analysisPath,
        "--helper-bin", dummyHelper,
      ]);
      const reported = JSON.parse(result.stdout);
      assert.equal(reported.ok, false);
      assert.match(reported.reason, /tracks が object ではありません/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
