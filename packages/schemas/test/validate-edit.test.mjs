import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-edit.mjs");
const exampleRoot = join(packageRoot, "examples");

function run(exampleDir) {
  return spawnSync(process.execPath, [cliPath, join(exampleRoot, exampleDir, "edit.json")], {
    encoding: "utf8",
  });
}

test("existing v0 sample passes unchanged (non-regression)", () => {
  const executed = run("edit-v0-sample");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("existing v1 sample passes unchanged (non-regression)", () => {
  const executed = run("edit-v1-sample");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("narration with bgm and full provenance passes", () => {
  const executed = run("edit-narration-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("narration id must match n-#### pattern", () => {
  const executed = run("edit-narration-invalid-id");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /audio\.narration\[0\]\.id は n- に続く 4 桁の数字である必要があります/,
  );
});

test("narration gain_db must stay within [-60, 12]", () => {
  const executed = run("edit-narration-gain-out-of-range");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /audio\.narration\[0\]\.gain_db は -60 から 12 の範囲の有限数である必要があります/,
  );
});

test("narration provenance is required", () => {
  const executed = run("edit-narration-missing-provenance");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /audio\.narration\[0\]\.provenance は object である必要があります/,
  );
});

test("voicevox provider requires credit", () => {
  const executed = run("edit-narration-voicevox-missing-credit");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /audio\.narration\[0\]\.provenance\.credit は provider が voicevox のとき必須です/,
  );
});

test("bgm + sfx (2 items) + narration coexist and pass", () => {
  const executed = run("edit-bgm-sfx-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("bgm.path is required", () => {
  const executed = run("edit-bgm-missing-path");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.bgm\.path は空でない文字列である必要があります/);
});

test("bgm/sfx gain_db must stay within [-60, 12]", () => {
  const executed = run("edit-bgm-sfx-gain-out-of-range");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /audio\.bgm\.gain_db は -60 から 12 の範囲の有限数である必要があります/,
  );
  assert.match(
    executed.stderr,
    /audio\.sfx\[0\]\.gain_db は -60 から 12 の範囲の有限数である必要があります/,
  );
});

test("bgm.ducking must be a boolean", () => {
  const executed = run("edit-bgm-ducking-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.bgm\.ducking は boolean である必要があります/);
});

test("bgm.fadeIn/fadeOut (reserved seat opened) pass validation", () => {
  const executed = run("edit-bgm-fade-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("bgm.fadeIn must be a non-negative finite number", () => {
  const executed = run("edit-bgm-fade-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.bgm\.fadeIn は 0 以上の有限数である必要があります/);
});

test("sfx[].t must be a non-negative finite number", () => {
  const executed = run("edit-sfx-t-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.sfx\[0\]\.t は 0 以上の有限数である必要があります/);
});

test("v1 (sources form) with bgm/sfx passes ($defs/audio is shared by v0 and v1)", () => {
  const executed = run("edit-v1-bgm-sfx-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("cuts[].speed / cuts[].transition_out / output.look / source.chroma_key / audio.master coexist and pass", () => {
  const executed = run("edit-render-basics-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("cuts[].speed must be greater than zero", () => {
  const executed = run("edit-speed-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /cuts\[0\]\.speed は 0 より大きい有限数である必要があります/);
});

test("output.look.intensity must stay within [0, 1]", () => {
  const executed = run("edit-look-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /output\.look\.intensity は 0 から 1 の範囲の有限数である必要があります/,
  );
});

test("source.chroma_key.color is required", () => {
  const executed = run("edit-chroma-key-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /source\.chroma_key\.color は空でない文字列である必要があります/);
});

test("cuts[].transition_out.type must be dissolve/fade-black/fade-white", () => {
  const executed = run("edit-transition-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /cuts\[0\]\.transition_out\.type は dissolve\/fade-black\/fade-white のいずれかである必要があります/,
  );
});

test("audio.bgm: null is tolerated as equivalent to omitted (contract-2026-07-14 says omission = no BGM; real fieldtest data spells that as explicit null, the same convention as source.proxy)", () => {
  const executed = run("edit-bgm-null-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("audio.master.denoise/loudnorm are validated", () => {
  const executed = run("edit-master-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.master\.denoise は off\/std\/strong のいずれかである必要があります/);
  assert.match(
    executed.stderr,
    /audio\.master\.loudnorm は -70 から 0 の範囲の有限数である必要があります/,
  );
});

test("layers with a baked fx and a chroma-keyed video PinP passes", () => {
  const executed = run("edit-layers-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("layers[].id must be unique", () => {
  const executed = run("edit-layers-invalid-duplicate-id");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /layers\[\]\.id が重複しています: dup/);
});

test("chroma_key is rejected on a baked layer (video-only field)", () => {
  const executed = run("edit-layers-invalid-chroma-key-on-baked");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /layers\[0\]\.chroma_key は kind が video のときのみ使用できます/,
  );
});

test("layers[].blend must be a known ffmpeg blend mode", () => {
  const executed = run("edit-layers-invalid-bad-blend");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /layers\[0\]\.blend は .*のいずれかである必要があります/);
});

test("beats (見せ場マーカー) v0: 3 items with mixed kinds and optional basis pass", () => {
  const executed = run("edit-beats-v0-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("beats v1: src present / omitted (single-source compatibility) both pass", () => {
  const executed = run("edit-beats-v1-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("beats[].id must match b-#### pattern", () => {
  const executed = run("edit-beats-invalid-id");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /beats\[0\]\.id は b- に続く 4 桁の数字である必要があります/);
});

test("beats[].id must be unique within the file", () => {
  const executed = run("edit-beats-duplicate-id");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /beats\[\]\.id が重複しています: b-0001/);
});

test("beats[].strength must stay within [0, 1]", () => {
  const executed = run("edit-beats-strength-out-of-range");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /beats\[0\]\.strength は 0 から 1 の範囲の有限数である必要があります/,
  );
  assert.match(
    executed.stderr,
    /beats\[1\]\.strength は 0 から 1 の範囲の有限数である必要があります/,
  );
});

test("beats[].kind is required", () => {
  const executed = run("edit-beats-missing-kind");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /beats\[0\]\.kind は空でない文字列である必要があります/);
});

test("beats[].src must reference sources[].id in v1", () => {
  const executed = run("edit-beats-v1-src-missing-reference");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /beats\[0\]\.src が sources\[\]\.id を参照していません: s9/);
});

test("beats[].src is rejected in v0 (no sources[] to reference)", () => {
  const executed = run("edit-beats-v0-src-present");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /beats\[0\]\.src は version 0 では使用できません/);
});

test("emphasis_words (語レベル演出) v0: 3 words with mixed emotions and optional style_hint pass", () => {
  const executed = run("edit-emphasis-words-v0-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("emphasis_words v1: src present / omitted (single-source compatibility) both pass", () => {
  const executed = run("edit-emphasis-words-v1-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("emphasis_words[].id must match e-#### pattern", () => {
  const executed = run("edit-emphasis-words-invalid-id");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /emphasis_words\[0\]\.id は e- に続く 4 桁の数字である必要があります/,
  );
});

test("emphasis_words[].t_end must be greater than t_start", () => {
  const executed = run("edit-emphasis-words-range-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /emphasis_words\[0\]\.t_end は t_start より大きい必要があります/);
  assert.match(executed.stderr, /emphasis_words\[1\]\.t_end は t_start より大きい必要があります/);
});

test("emphasis_words[].word must be a non-empty string", () => {
  const executed = run("edit-emphasis-words-empty-word");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /emphasis_words\[0\]\.word は空でない文字列である必要があります/);
});

test("emphasis_words[].emotion is required", () => {
  const executed = run("edit-emphasis-words-missing-emotion");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /emphasis_words\[0\]\.emotion は空でない文字列である必要があります/,
  );
});

test("emphasis_words[].src is rejected in v0 (no sources[] to reference)", () => {
  const executed = run("edit-emphasis-words-v0-src-present");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /emphasis_words\[0\]\.src は version 0 では使用できません/);
});

test("direction (演出宣言): preset + intensity 70 + empty overrides passes", () => {
  const executed = run("edit-direction-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("direction: preset only (intensity / overrides omitted) passes", () => {
  const executed = run("edit-direction-preset-only");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("direction.preset is required", () => {
  const executed = run("edit-direction-missing-preset");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /direction\.preset は空でない文字列である必要があります/);
});

test("direction.intensity must stay within [0, 100]", () => {
  const tooHigh = run("edit-direction-intensity-out-of-range");
  assert.equal(tooHigh.status, 1, tooHigh.stdout);
  assert.match(
    tooHigh.stderr,
    /direction\.intensity は 0 から 100 の範囲の整数である必要があります/,
  );

  const negative = run("edit-direction-intensity-negative");
  assert.equal(negative.status, 1, negative.stdout);
  assert.match(
    negative.stderr,
    /direction\.intensity は 0 から 100 の範囲の整数である必要があります/,
  );
});

test("direction.intensity must be an integer (not a fractional number)", () => {
  const executed = run("edit-direction-intensity-not-integer");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /direction\.intensity は 0 から 100 の範囲の整数である必要があります/,
  );
});

test("direction.overrides must be an object (array is rejected)", () => {
  const executed = run("edit-direction-overrides-array");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /direction\.overrides は object である必要があります/);
});

test("cuts at/track and layers/sfx track and tracks section all valid together", () => {
  const executed = run("edit-cuts-at-track-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("cuts[].at must be non-negative", () => {
  const executed = run("edit-cuts-at-negative-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /cuts\[0\]\.at は 0 以上の有限数である必要があります/);
});

test("cuts[].track must be a non-negative integer", () => {
  const executed = run("edit-cuts-track-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /cuts\[0\]\.track は 0 以上の整数である必要があります/);
});

test("layers[].track must be a non-negative integer", () => {
  const executed = run("edit-layers-track-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /layers\[0\]\.track は 0 以上の整数である必要があります/);
});

test("audio.sfx[].track must be a non-negative integer", () => {
  const executed = run("edit-sfx-track-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.sfx\[0\]\.track は 0 以上の整数である必要があります/);
});

test("tracks section with muted/hidden state passes", () => {
  const executed = run("edit-tracks-section-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("tracks section rejects non-boolean muted/hidden", () => {
  const executed = run("edit-tracks-section-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /tracks\.cuts\[0\]\.muted は boolean である必要があります/);
});
