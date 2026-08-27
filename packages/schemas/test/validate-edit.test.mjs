import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

function runPatchedExample(mutator) {
  const directory = mkdtempSync(join(tmpdir(), "akari-edit-schema-"));
  const value = JSON.parse(readFileSync(join(exampleRoot, "edit-v0-sample", "edit.json"), "utf8"));
  mutator(value);
  const path = join(directory, "edit.json");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return spawnSync(process.execPath, [cliPath, path], { encoding: "utf8" });
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

test("sfx[].in/out (R6a trim) both present and well-formed pass", () => {
  const executed = run("edit-sfx-in-out-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("sfx[].fade_in/fade_out (audio-clip-fades) pass validation", () => {
  // edit-sfx-in-out-valid also carries fade_in/fade_out (extended for this task), so the above
  // test already exercises the happy path end-to-end; this test documents that coverage
  // explicitly under its own name.
  const executed = run("edit-sfx-in-out-valid");
  assert.equal(executed.status, 0, executed.stderr);
  const value = JSON.parse(readFileSync(join(exampleRoot, "edit-sfx-in-out-valid", "edit.json"), "utf8"));
  assert.ok(Object.hasOwn(value.audio.sfx[0], "fade_in"), "expected the fixture to carry fade_in");
  assert.ok(Object.hasOwn(value.audio.sfx[0], "fade_out"), "expected the fixture to carry fade_out");
});

test("sfx[].fade_in must be a non-negative finite number", () => {
  const executed = run("edit-sfx-fade-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.sfx\[0\]\.fade_in は 0 以上の有限数である必要があります/);
});

test("sfx[].in must be a non-negative finite number", () => {
  const executed = run("edit-sfx-in-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.sfx\[0\]\.in は 0 以上の有限数である必要があります/);
});

test("sfx[].out must be a positive finite number (exclusiveMinimum 0)", () => {
  const executed = run("edit-sfx-out-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.sfx\[0\]\.out は 0 より大きい有限数である必要があります/);
});

test("sfx[].out rejects non-numeric values", () => {
  const executed = run("edit-sfx-out-type-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.sfx\[0\]\.out は 0 より大きい有限数である必要があります/);
});

test("bgm.in (R6a trim offset) well-formed passes", () => {
  const executed = run("edit-bgm-in-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("bgm.in must be a non-negative finite number", () => {
  const executed = run("edit-bgm-in-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.bgm\.in は 0 以上の有限数である必要があります/);
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

test("cuts[].transition_out.type must be one of the canonical transition vocabulary", () => {
  const executed = run("edit-transition-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /cuts\[0\]\.transition_out\.type は .*pixelize のいずれかである必要があります/,
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

test("output.encoding master/x264 and audio.master.true_peak_dbtp pass", () => {
  const executed = runPatchedExample((edit) => {
    edit.output.encoding = { quality: "master", encoder: "x264" };
    edit.audio = { master: { denoise: "std", loudnorm: -14, true_peak_dbtp: -1.7 } };
  });
  assert.equal(executed.status, 0, executed.stderr);
});

test("output.encoding accepts every supported encoder", () => {
  for (const encoder of ["auto", "videotoolbox", "nvenc", "qsv", "amf", "mf", "x264"]) {
    const executed = runPatchedExample((edit) => {
      edit.output.encoding = { quality: "standard", encoder };
    });
    assert.equal(executed.status, 0, `${encoder}: ${executed.stderr}`);
  }
});

test("output.encoding and true_peak_dbtp closed enums/range fail", () => {
  const executed = runPatchedExample((edit) => {
    edit.output.encoding = { quality: "lossless", encoder: "gpu" };
    edit.audio = { master: { true_peak_dbtp: -9.1 } };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /output\.encoding\.quality/u);
  assert.match(executed.stderr, /output\.encoding\.encoder/u);
  assert.match(executed.stderr, /audio\.master\.true_peak_dbtp/u);
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

test("layers[].crop with x+w>1 (out of the source frame) is rejected", () => {
  const executed = run("edit-layers-invalid-crop-out-of-bounds");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /layers\[0\]\.crop\.x \+ layers\[0\]\.crop\.w は 1 以下である必要があります/);
});

test("layers[].crop.w must be > 0 and <= 1", () => {
  const executed = runPatchedExample((value) => {
    value.layers = [
      {
        id: "pinp-guest",
        t: 1,
        duration: 2,
        kind: "video",
        src: "footage/guest.mp4",
        crop: { x: 0, y: 0, w: 0, h: 0.5 },
      },
    ];
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /layers\[0\]\.crop\.w は 0 より大きく 1 以下の有限数である必要があります/);
});

test("layers[].perspective.corners must have exactly 4 [x,y] pairs", () => {
  const executed = run("edit-layers-invalid-perspective-wrong-corner-count");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /layers\[0\]\.perspective\.corners は \[TL,TR,BL,BR\] の 4 要素配列である必要があります/,
  );
});

test("layers[].perspective.corners components must be within 0..1", () => {
  const executed = run("edit-layers-invalid-perspective-out-of-range");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /layers\[0\]\.perspective\.corners\[1\] \(TR\)\.x は 0 から 1 の範囲の有限数である必要があります/,
  );
});

test("layers[].perspective.corners rejects a degenerate (zero-area) quad", () => {
  const executed = run("edit-layers-invalid-perspective-degenerate");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /layers\[0\]\.perspective\.corners は退化した四角形（面積がほぼ 0）であってはなりません/,
  );
});

test("layers with a perspective corner-pin (combined with crop) passes", () => {
  const executed = run("edit-layers-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("layers[].keyframes: mixed transform/crop/perspective points (3 points, some partial) passes", () => {
  const executed = run("edit-layers-keyframes-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("layers[].keyframes must have at least 2 points", () => {
  const executed = runPatchedExample((value) => {
    value.layers = [
      {
        id: "pinp-guest",
        t: 1,
        duration: 2,
        kind: "video",
        src: "footage/guest.mp4",
        keyframes: [{ t: 0, transform: { scale: 1 } }],
      },
    ];
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /layers\[0\]\.keyframes は 2 件以上の配列である必要があります/);
});

test("layers[].keyframes[].t must be ascending with no duplicates", () => {
  const executed = runPatchedExample((value) => {
    value.layers = [
      {
        id: "pinp-guest",
        t: 1,
        duration: 2,
        kind: "video",
        src: "footage/guest.mp4",
        keyframes: [
          { t: 1, transform: { scale: 1 } },
          { t: 1, transform: { scale: 1.5 } },
        ],
      },
    ];
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /layers\[0\]\.keyframes\[\]\.t は昇順かつ重複禁止です/);
});

test("layers[].keyframes[] rejects unknown keys", () => {
  const executed = runPatchedExample((value) => {
    value.layers = [
      {
        id: "pinp-guest",
        t: 1,
        duration: 2,
        kind: "video",
        src: "footage/guest.mp4",
        keyframes: [
          { t: 0, transform: { scale: 1 } },
          { t: 1, transform: { scale: 1.5 }, panSpeed: 3 },
        ],
      },
    ];
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /layers\[0\]\.keyframes\[1\] に未知のキーがあります: panSpeed/);
});

test("layers[].keyframes[].easing must be linear or ease-in-out", () => {
  const executed = runPatchedExample((value) => {
    value.layers = [
      {
        id: "pinp-guest",
        t: 1,
        duration: 2,
        kind: "video",
        src: "footage/guest.mp4",
        keyframes: [
          { t: 0, transform: { scale: 1 } },
          { t: 1, transform: { scale: 1.5 }, easing: "bounce" },
        ],
      },
    ];
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /layers\[0\]\.keyframes\[1\]\.easing は linear\/ease-in-out のいずれかである必要があります/);
});

test("layers[].keyframes[].crop is validated with the same rules as the static layers[].crop", () => {
  const executed = runPatchedExample((value) => {
    value.layers = [
      {
        id: "pinp-guest",
        t: 1,
        duration: 2,
        kind: "video",
        src: "footage/guest.mp4",
        keyframes: [
          { t: 0, crop: { x: 0, y: 0, w: 1, h: 1 } },
          { t: 1, crop: { x: 0.8, y: 0, w: 0.5, h: 1 } },
        ],
      },
    ];
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /layers\[0\]\.keyframes\[1\]\.crop\.x \+ layers\[0\]\.keyframes\[1\]\.crop\.w は 1 以下である必要があります/,
  );
});

test("layers[].keyframes[].perspective rejects a degenerate quad, same as the static layers[].perspective", () => {
  const executed = runPatchedExample((value) => {
    value.layers = [
      {
        id: "pinp-guest",
        t: 1,
        duration: 2,
        kind: "video",
        src: "footage/guest.mp4",
        keyframes: [
          { t: 0, perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
          { t: 1, perspective: { corners: [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]] } },
        ],
      },
    ];
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /layers\[0\]\.keyframes\[1\]\.perspective\.corners は退化した四角形（面積がほぼ 0）であってはなりません/,
  );
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

// docs/contract-2026-08-12-still-image-cut-source-v0.md: mp4 と png ソースが cuts[] に混在する
// v1 edit.json はスキーマ検証を素通りする（判定は拡張子のみで sourceV1 自体の形は変わらない）。
test("v1 cuts mixing an mp4 and a still-image (png) source passes", () => {
  const executed = run("edit-cuts-still-image-source-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

for (const fixture of [
  "edit-cuts-transform-omitted-valid",
  "edit-cuts-transform-full-valid",
  "edit-cuts-transform-partial-valid",
]) {
  test(`${fixture} passes`, () => {
    const executed = run(fixture);
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /^OK: /);
  });
}

for (const [fixture, expectedError] of [
  ["edit-cuts-transform-scale-invalid", /transform\.scale/],
  ["edit-cuts-opacity-out-of-range-invalid", /opacity/],
  ["edit-cuts-transform-rotate-invalid", /transform\.rotate/],
  ["edit-cuts-transform-unknown-key-invalid", /未知のキー/],
]) {
  test(`${fixture} fails with the expected validation error`, () => {
    const executed = run(fixture);
    assert.equal(executed.status, 1, executed.stdout);
    assert.match(executed.stderr, expectedError);
  });
}

test("cuts[].fx (画面 FX の参照表・器): stacked entries across multiple cuts pass", () => {
  const executed = run("edit-cuts-fx-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

// 2026-08-11 撤去: v0 の 5 id（noise/particles/vignette/flare/color-overlay）はオーナー裁定で
// 製品面から撤去され、id の enum は string へ緩和された（presets/fx/ の FX_BUILDERS に未登録の
// id は render 側の警告 + no-op に委ねる — スキーマ層ではハードフェイルさせない）。
test("cuts[].fx[].id accepts any non-empty string (unknown/unregistered ids are schema-valid)", () => {
  const executed = run("edit-cuts-fx-unknown-id-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("cuts[].fx[].intensity must stay within [0, 1]", () => {
  const executed = run("edit-cuts-fx-intensity-out-of-range-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /cuts\[0\]\.fx\[0\]\.intensity は 0 から 1 の範囲の有限数である必要があります/,
  );
});

test("cuts[].fx[] rejects unknown keys", () => {
  const executed = run("edit-cuts-fx-unknown-key-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /cuts\[0\]\.fx\[0\] に未知のキーがあります: seed/);
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

test("timeline omission preserves edit.json compatibility", () => {
  const executed = run("edit-timeline-omitted-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("declared timeline tracks with optional state pass", () => {
  const executed = run("edit-timeline-declared-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("cuts and layers may be interleaved in timeline order", () => {
  const executed = run("edit-timeline-interleaved-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("timeline track ids must be unique", () => {
  const executed = run("edit-timeline-duplicate-id-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /timeline\.tracks\[\]\.id が重複しています: duplicate/);
});

test("timeline track refs must be non-negative integers", () => {
  const executed = run("edit-timeline-ref-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /timeline\.tracks\[0\]\.ref は 0 以上の整数である必要があります/);
  assert.match(executed.stderr, /timeline\.tracks\[1\]\.ref は 0 以上の整数である必要があります/);
});

// docs/contract-2026-07-22-render-basics.md #6 (cuts[].framing: static crop / scale keyframes).
// edit-v0-sample's cuts[0] is { in: 5, out: 10 } (5s at the default speed 1x), reused via
// runPatchedExample so these cases don't need their own fixture directories.

test("cuts[].framing.crop (static, output-relative) passes", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].framing = { crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };
  });
  assert.equal(executed.status, 0, executed.stderr);
});

test("cuts[].framing.keyframes: 2-point zoom passes", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].framing = { keyframes: [{ t: 0, scale: 1 }, { t: 5, scale: 2 }] };
  });
  assert.equal(executed.status, 0, executed.stderr);
});

test("cuts[].framing.keyframes: 3-point staged shrink with explicit cx/cy passes", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].framing = {
      keyframes: [
        { t: 0, scale: 3, cx: 0.4, cy: 0.6 },
        { t: 2, scale: 2, cx: 0.5, cy: 0.5 },
        { t: 5, scale: 1 },
      ],
    };
  });
  assert.equal(executed.status, 0, executed.stderr);
});

test("cuts[].framing.crop must fit inside the canvas (x + w <= 1, y + h <= 1)", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].framing = { crop: { x: 0.6, y: 0.7, w: 0.5, h: 0.5 } };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /framing\.crop は x \+ w <= 1/);
  assert.match(executed.stderr, /framing\.crop は y \+ h <= 1/);
});

test("cuts[].framing.crop rejects an unknown key", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].framing = { crop: { x: 0, y: 0, w: 1, h: 1, zoom: 2 } };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /framing\.crop に未知のキーがあります: zoom/);
});

test("cuts[].framing.keyframes requires at least 2 points", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].framing = { keyframes: [{ t: 0, scale: 1.5 }] };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /framing\.keyframes は 2 件以上の配列である必要があります/);
});

test("cuts[].framing.keyframes[].t must be strictly ascending (no duplicates, no reordering)", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].framing = { keyframes: [{ t: 2, scale: 1 }, { t: 2, scale: 2 }] };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /framing\.keyframes\[\]\.t は昇順かつ重複禁止です/);
});

test("cuts[].framing.keyframes[].scale must be a positive number", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].framing = { keyframes: [{ t: 0, scale: 0 }, { t: 5, scale: 1 }] };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /framing\.keyframes\[0\]\.scale は 0 より大きい有限数である必要があります/);
});

test("cuts[].framing.keyframes[].cx/cy must stay within [0, 1]", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].framing = { keyframes: [{ t: 0, scale: 1, cx: 1.5 }, { t: 5, scale: 2, cy: -0.1 }] };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /framing\.keyframes\[0\]\.cx は 0 から 1 の範囲の有限数である必要があります/);
  assert.match(executed.stderr, /framing\.keyframes\[1\]\.cy は 0 から 1 の範囲の有限数である必要があります/);
});

// docs/contract-2026-07-22-render-basics.md #7 (cuts[].freeze). Same base cut (5s at speed 1x).

test("cuts[].freeze passes when at_sec is within the cut's playable duration", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].freeze = { at_sec: 2, duration_sec: 1 };
  });
  assert.equal(executed.status, 0, executed.stderr);
});

test("cuts[].freeze: null is tolerated as equivalent to omitted", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].freeze = null;
  });
  assert.equal(executed.status, 0, executed.stderr);
});

test("cuts[].freeze.at_sec must be non-negative", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].freeze = { at_sec: -1, duration_sec: 1 };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /cuts\[0\]\.freeze\.at_sec は 0 以上の有限数である必要があります/);
});

test("cuts[].freeze.duration_sec must be greater than zero", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].freeze = { at_sec: 1, duration_sec: 0 };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /cuts\[0\]\.freeze\.duration_sec は 0 より大きい有限数である必要があります/);
});

test("cuts[].freeze.at_sec cannot exceed the cut's own playable duration (speed-adjusted)", () => {
  const executed = runPatchedExample((edit) => {
    // cuts[0] is { in: 5, out: 10, speed: 2 } -> playable duration (10-5)/2 = 2.5s.
    edit.cuts[0].speed = 2;
    edit.cuts[0].freeze = { at_sec: 3, duration_sec: 1 };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /cuts\[0\]\.freeze\.at_sec はカットの再生尺（2\.5秒）を超えられません/);
});

test("cuts[].freeze rejects an unknown key", () => {
  const executed = runPatchedExample((edit) => {
    edit.cuts[0].freeze = { at_sec: 1, duration_sec: 1, hold_audio: true };
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /cuts\[0\]\.freeze に未知のキーがあります: hold_audio/);
});
