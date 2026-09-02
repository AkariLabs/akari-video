import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FADES,
  DEFAULT_LEVEL_TARGETS,
  DEFAULT_TRUE_PEAK_CEILING_DBTP,
  SHORT_CLIP_SEC,
  SHORT_PEAK_TARGET_DBFS,
  computeInsertLevel,
  roleForClip,
} from "../shared/insert-level.mjs";

test("公開定数を契約値に固定する", () => {
  assert.deepEqual(DEFAULT_LEVEL_TARGETS, { narration: -16, sfx: -18, jingle: -18, music: -20, ambience: -26, bgm: -26 });
  assert.equal(DEFAULT_TRUE_PEAK_CEILING_DBTP, -1);
  assert.deepEqual(DEFAULT_FADES.music, [0.2, 1]);
  assert.equal(SHORT_CLIP_SEC, 1);
  assert.equal(SHORT_PEAK_TARGET_DBFS, -3);
});

test("計測なしは none・gain 0・役割 fade", () => {
  assert.deepEqual(computeInsertLevel({ role: "jingle" }), {
    gain_db: 0, fade_in: 0, fade_out: 0.3, basis: "none",
    detail: { target: null, measured_value: null, peak_guard_applied: false, clamped: false },
  });
});

test("1 秒未満は sample peak 基準", () => {
  const result = computeInsertLevel({ role: "sfx", measured: { duration_sec: 0.3, integrated_lufs: -12, sample_peak_dbfs: -9 } });
  assert.equal(result.basis, "peak");
  assert.equal(result.gain_db, 6);
  assert.equal(result.detail.target, -3);
});

test("integrated_lufs null は sample peak 基準", () => {
  assert.equal(computeInsertLevel({ role: "sfx", measured: { duration_sec: 3, integrated_lufs: null, sample_peak_dbfs: -5 } }).gain_db, 2);
});

test("peak も無い場合は none", () => {
  assert.equal(computeInsertLevel({ role: "sfx", measured: { duration_sec: 0.3, integrated_lufs: null, sample_peak_dbfs: null } }).basis, "none");
});

test("通常尺は役割別 LUFS 基準", () => {
  const result = computeInsertLevel({ role: "narration", measured: { duration_sec: 3, integrated_lufs: -24 } });
  assert.equal(result.basis, "lufs");
  assert.equal(result.gain_db, 8);
});

test("true peak ceiling が gain を下げたときだけ guard を記録", () => {
  const result = computeInsertLevel({ role: "narration", measured: { duration_sec: 3, integrated_lufs: -30, true_peak_dbtp: -4 } });
  assert.equal(result.gain_db, 3);
  assert.equal(result.detail.peak_guard_applied, true);
});

test("上限 12 dB へクランプ", () => {
  const result = computeInsertLevel({ role: "music", measured: { duration_sec: 3, integrated_lufs: -50 } });
  assert.equal(result.gain_db, 12);
  assert.equal(result.detail.clamped, true);
});

test("下限 -60 dB へクランプ", () => {
  const result = computeInsertLevel({ role: "bgm", measured: { duration_sec: 3, integrated_lufs: 40 } });
  assert.equal(result.gain_db, -60);
  assert.equal(result.detail.clamped, true);
});

test("0.1 dB に丸め -0 を 0 にする", () => {
  assert.equal(computeInsertLevel({ role: "sfx", measured: { duration_sec: 3, integrated_lufs: -18.04 } }).gain_db, 0);
  assert.equal(computeInsertLevel({ role: "sfx", measured: { duration_sec: 3, integrated_lufs: -19.26 } }).gain_db, 1.3);
});

test("未知 role は targets と fades の両方で sfx", () => {
  const result = computeInsertLevel({ role: "dialogue", measured: { duration_sec: 3, integrated_lufs: -20 } });
  assert.equal(result.gain_db, 2);
  assert.deepEqual([result.fade_in, result.fade_out], [0, 0]);
});

test("custom targets と ceiling と fades を使える", () => {
  const result = computeInsertLevel({ role: "music", measured: { duration_sec: 3, integrated_lufs: -25, true_peak_dbtp: -2 }, targets: { music: -19 }, ceilingDbtp: -0.5, fades: { music: [1, 2], sfx: [0, 0] } });
  assert.equal(result.gain_db, 1.5);
  assert.deepEqual([result.fade_in, result.fade_out], [1, 2]);
});

test("roleForClip は明示 role と legacy collection を優先", () => {
  assert.equal(roleForClip({ role: "narration", collection: "bgm", path: "sting.wav", durationSec: 30 }), "narration");
  assert.equal(roleForClip({ collection: "bgm", path: "sting.wav", durationSec: 30 }), "bgm");
  assert.equal(roleForClip({ collection: "narration", path: "music.wav", durationSec: 30 }), "narration");
});

test("roleForClip は jingle / sting を jingle にする", () => {
  assert.equal(roleForClip({ path: "UI-JINGLE.wav", durationSec: 3 }), "jingle");
  assert.equal(roleForClip({ path: "end_sting.wav", durationSec: 3 }), "jingle");
});

test("roleForClip は ambience 名を判定する", () => {
  assert.equal(roleForClip({ path: "room-tone.wav", durationSec: 3 }), "ambience");
  assert.equal(roleForClip({ path: "forest_env.wav", durationSec: 3 }), "ambience");
});

test("roleForClip は 20 秒以上を music、それ以外を sfx にする", () => {
  assert.equal(roleForClip({ path: "loop.wav", durationSec: 20 }), "music");
  assert.equal(roleForClip({ path: "hit.wav", durationSec: 19.9 }), "sfx");
});

test("roleForClip は明示 sfx と未知 role も SFX ヒューリスティクスへ流す", () => {
  assert.equal(roleForClip({ role: "sfx", path: "ui-jingle.wav", durationSec: 3 }), "jingle");
  assert.equal(roleForClip({ role: "sfx", path: "bed.wav", durationSec: 25 }), "music");
  assert.equal(roleForClip({ role: "weird", path: "hit.wav", durationSec: 1 }), "sfx");
});
