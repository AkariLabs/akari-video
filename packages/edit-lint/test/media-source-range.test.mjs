import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// issue #68: source.out / source.in が素材の実尺を超えていても --media で PASS していた。
// 既存の media.audio-shorter-than-out は (1) 視覚レーンのクリップ限定 (2) 音声ストリーム必須
// (3) warning 止まり のため、audio レーンの item と音声なし映像が無検査だった。
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "edit-lint.mjs");

/** 素材ごとに「コンテナ実尺」と「音声ストリーム尺」を別に返す ffprobe スタブ。 */
async function makeStubs(root, durations) {
  const ffprobe = join(root, "ffprobe-stub");
  const ffmpeg = join(root, "ffmpeg-stub");
  const branches = Object.entries(durations).map(([name, value]) => `  *${name}*)
    container='${value.container.toFixed(3)}'
    stream='${value.stream === null ? "" : value.stream.toFixed(3)}'
    ;;`).join("\n");
  await writeFile(ffprobe, `#!/bin/sh
container='0'
stream=''
case "$*" in
${branches}
esac
if [ -z "$stream" ]; then
  printf '{"streams":[],"format":{"duration":"%s"}}\\n' "$container"
else
  printf '{"streams":[{"index":0,"duration":"%s"}],"format":{"duration":"%s"}}\\n' "$stream" "$container"
fi
`, "utf8");
  await writeFile(ffmpeg, `#!/bin/sh
case "$*" in
  *volumedetect*) printf 'mean_volume: -20.0 dB\\nmax_volume: -3.0 dB\\n' >&2 ;;
esac
`, "utf8");
  await chmod(ffprobe, 0o755);
  await chmod(ffmpeg, 0o755);
  return { FFPROBE: ffprobe, FFMPEG: ffmpeg };
}

async function makeProject(edit, assets) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-source-range-"));
  await mkdir(join(root, "assets"), { recursive: true });
  for (const name of assets) await writeFile(join(root, "assets", name), "fixture", "utf8");
  await writeFile(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`, "utf8");
  return root;
}

function run(project, env) {
  return spawnSync(process.execPath, [cliPath, project, "--json", "--media"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function resultOf(executed) {
  assert.equal(executed.signal, null, executed.stderr);
  assert.notEqual(executed.stdout.trim(), "", executed.stderr);
  return JSON.parse(executed.stdout);
}

function editWith({ visualOut, bgmOut, narrationIn = 0 }) {
  return {
    version: 2,
    output: { width: 1080, height: 1920, fps: 30 },
    sources: [
      { id: "mute", path: "assets/mute.mp4", proxy: null },
      { id: "bgm", path: "assets/bgm.mp3", proxy: null },
    ],
    tracks: [
      {
        id: "v0",
        lane: "visual",
        items: [
          { id: "v-cutA", at: 0, duration: 126, source: { kind: "media", src: "mute", in: 0, out: visualOut } },
        ],
      },
      {
        id: "a0",
        lane: "audio",
        items: [
          { id: "bgm-1", at: 0, duration: 2373, role: "bgm", source: { kind: "media", src: "bgm", in: 0, out: bgmOut } },
        ],
      },
      {
        id: "a1",
        lane: "audio",
        items: [
          { id: "nr-1", at: 0, duration: 60, role: "narration", source: { kind: "media", src: "bgm", in: narrationIn, out: narrationIn + 2 } },
        ],
      },
    ],
  };
}

const STUB_DURATIONS = {
  "mute.mp4": { container: 10, stream: null },
  "bgm.mp3": { container: 79.12, stream: 79.12 },
};

test("media.source-range は音声なし映像と audio レーン item の out 超過を error にする", async () => {
  const project = await makeProject(editWith({ visualOut: 500, bgmOut: 999 }), ["mute.mp4", "bgm.mp3"]);
  try {
    const executed = run(project, await makeStubs(project, STUB_DURATIONS));
    const result = resultOf(executed);
    assert.equal(executed.status, 1, executed.stdout);
    assert.equal(result.verdict, "fail");
    const ranges = result.findings.filter((finding) => finding.check === "media.source-range");
    assert.equal(ranges.length, 2, JSON.stringify(result.findings, null, 2));
    assert.ok(ranges.every((finding) => finding.severity === "error"));
    const visual = ranges.find((finding) => finding.message.startsWith("v-cutA:"));
    assert.match(visual.message, /out=500\.000s が素材の実尺 10\.000s を 490\.000s 超えています/u);
    assert.equal(visual.path, "edit.json#tracks[0].items[0].source.out[src=mute]");
    const bgm = ranges.find((finding) => finding.message.startsWith("bgm-1:"));
    assert.match(bgm.message, /out=999\.000s が素材の実尺 79\.120s を 919\.880s 超えています/u);
    assert.equal(bgm.path, "edit.json#tracks[1].items[0].source.out[src=bgm]");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("media.source-range は in が実尺以上の item を error にする", async () => {
  const project = await makeProject(
    editWith({ visualOut: 4.2, bgmOut: 79, narrationIn: 90 }),
    ["mute.mp4", "bgm.mp3"],
  );
  try {
    const result = resultOf(run(project, await makeStubs(project, STUB_DURATIONS)));
    const ranges = result.findings.filter((finding) => finding.check === "media.source-range");
    assert.equal(ranges.length, 1, JSON.stringify(result.findings, null, 2));
    assert.equal(ranges[0].severity, "error");
    assert.match(ranges[0].message, /nr-1: in=90\.000s は素材の実尺 79\.120s 以上です/u);
    assert.equal(ranges[0].path, "edit.json#tracks[2].items[0].source.in[src=bgm]");
    // in が実尺を超えているぶんは error 側が受け持つので、警告の二重報告はしない。
    assert.equal(result.findings.filter((finding) => finding.check === "audio.narration.trim").length, 0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("実尺の内側なら media.source-range は出ない", async () => {
  const project = await makeProject(
    editWith({ visualOut: 4.2, bgmOut: 79.1, narrationIn: 10 }),
    ["mute.mp4", "bgm.mp3"],
  );
  try {
    const executed = run(project, await makeStubs(project, STUB_DURATIONS));
    const result = resultOf(executed);
    assert.equal(executed.status, 0, executed.stdout);
    assert.equal(result.findings.filter((finding) => finding.check === "media.source-range").length, 0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("コンテナ内で音声ストリームだけが短い素材は warning のまま（error にしない）", async () => {
  const project = await makeProject(editWith({ visualOut: 4.2, bgmOut: 60 }), ["mute.mp4", "bgm.mp3"]);
  try {
    const result = resultOf(run(project, await makeStubs(project, {
      "mute.mp4": { container: 10, stream: null },
      // 音声は 30s で終わるが素材自体は 79.12s ある
      "bgm.mp3": { container: 79.12, stream: 30 },
    })));
    assert.equal(result.findings.filter((finding) => finding.check === "media.source-range").length, 0);
    assert.equal(result.verdict, "pass");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("袋（入れ子）の media item も実尺で検査する", async () => {
  const edit = editWith({ visualOut: 4.2, bgmOut: 79 });
  edit.tracks[0].items.push({
    id: "bag",
    at: 200,
    duration: 60,
    source: { kind: "group" },
    items: [
      { id: "bag-inner", at: 0, duration: 60, source: { kind: "media", src: "mute", in: 0, out: 42 } },
    ],
  });
  const project = await makeProject(edit, ["mute.mp4", "bgm.mp3"]);
  try {
    const result = resultOf(run(project, await makeStubs(project, STUB_DURATIONS)));
    const ranges = result.findings.filter((finding) => finding.check === "media.source-range");
    assert.equal(ranges.length, 1, JSON.stringify(result.findings, null, 2));
    assert.equal(ranges[0].path, "edit.json#tracks[0].items[1].items[0].source.out[src=mute]");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("コンテナ実尺が取れない素材は skipped に理由を残す", async () => {
  const project = await makeProject(editWith({ visualOut: 500, bgmOut: 999 }), ["mute.mp4", "bgm.mp3"]);
  try {
    const result = resultOf(run(project, await makeStubs(project, {
      "mute.mp4": { container: 0, stream: null },
      "bgm.mp3": { container: 0, stream: null },
    })));
    assert.equal(result.findings.filter((finding) => finding.check === "media.source-range").length, 0);
    assert.ok(result.skipped.some((item) => item.check === "media.source-range"
      && /container duration is unavailable/u.test(item.reason)), JSON.stringify(result.skipped, null, 2));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
