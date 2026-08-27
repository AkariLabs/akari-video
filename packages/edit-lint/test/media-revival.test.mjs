import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collectFixtureDefaultSnapshot } from "./helpers/fixture-default-snapshot.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "edit-lint.mjs");

function baseEdit() {
  return {
    version: 2,
    output: { width: 540, height: 960, fps: 30 },
    sources: [
      { id: "clip", path: "assets/clip.mp4", proxy: null },
      { id: "vo", path: "assets/vo.m4a", proxy: null },
    ],
    tracks: [
      {
        id: "v1",
        lane: "visual",
        items: [
          { id: "cut-1", at: 0, duration: 148, source: { kind: "media", src: "clip", in: 0, out: 4.933 } },
          { id: "cut-2", at: 148, duration: 148, source: { kind: "media", src: "clip", in: 0, out: 4.933 } },
          { id: "cut-3", at: 296, duration: 148, source: { kind: "media", src: "clip", in: 0, out: 4.933 } },
        ],
      },
      {
        id: "a-nar",
        lane: "audio",
        items: [
          {
            id: "vo-1",
            at: 0,
            duration: 117,
            role: "narration",
            source: { kind: "media", src: "vo", in: 5.8, out: 9.7 },
          },
        ],
      },
    ],
  };
}

async function makeProject(edit = baseEdit()) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-media-revival-"));
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "assets", "clip.mp4"), "fixture", "utf8");
  await writeFile(join(root, "assets", "vo.m4a"), "fixture", "utf8");
  await writeFile(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`, "utf8");
  return root;
}

function run(project, args = [], env = {}) {
  return spawnSync(process.execPath, [cliPath, project, "--json", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function resultOf(executed) {
  assert.equal(executed.signal, null, executed.stderr);
  assert.notEqual(executed.stdout.trim(), "", executed.stderr);
  return JSON.parse(executed.stdout);
}

async function makeMediaStubs(root, { voiceDuration = 20 } = {}) {
  const probeLog = join(root, "ffprobe.log");
  const ffprobe = join(root, "ffprobe-stub");
  const ffmpeg = join(root, "ffmpeg-stub");
  await writeFile(ffprobe, `#!/bin/sh
printf '%s\\n' "$*" >> '${probeLog}'
case "$*" in
  *vo.m4a*) duration='${voiceDuration.toFixed(3)}' ;;
  *) duration='4.700' ;;
esac
printf '{"streams":[{"index":0,"duration":"%s"}]}\\n' "$duration"
`, "utf8");
  await writeFile(ffmpeg, `#!/bin/sh
case "$*" in
  *silencedetect*)
    printf 'silence_start: 0.000\\nsilence_end: 1.000 | silence_duration: 1.000\\n' >&2
    ;;
  *volumedetect*)
    printf 'mean_volume: -20.0 dB\\nmax_volume: -3.0 dB\\n' >&2
    ;;
esac
`, "utf8");
  await chmod(ffprobe, 0o755);
  await chmod(ffmpeg, 0o755);
  return { FFPROBE: ffprobe, FFMPEG: ffmpeg, probeLog };
}

async function makeInvocationLoggingMediaStubs(root) {
  const invocationLog = join(root, "media-invocations.log");
  const ffprobe = join(root, "ffprobe-logging-stub");
  const ffmpeg = join(root, "ffmpeg-logging-stub");
  await writeFile(ffprobe, `#!/bin/sh
printf 'ffprobe %s\\n' "$*" >> '${invocationLog}'
printf '{"streams":[{"index":0,"duration":"20.000"}]}\\n'
`, "utf8");
  await writeFile(ffmpeg, `#!/bin/sh
printf 'ffmpeg %s\\n' "$*" >> '${invocationLog}'
case "$*" in
  *volumedetect*)
    printf 'mean_volume: -20.0 dB\\nmax_volume: -3.0 dB\\n' >&2
    ;;
esac
`, "utf8");
  await chmod(ffprobe, 0o755);
  await chmod(ffmpeg, 0o755);
  return { FFPROBE: ffprobe, FFMPEG: ffmpeg, invocationLog };
}

test("--media runs per referenced source, caches ffprobe, and reports three short cut audio streams", async () => {
  const project = await makeProject();
  try {
    await writeFile(join(project, "captions.json"), `${JSON.stringify([{
      id: "c-0001",
      start: 0,
      end: 1,
      text: "caption",
      speaker: null,
      sourceRef: null,
      edited: false,
    }], null, 2)}\n`, "utf8");
    const media = await makeMediaStubs(project);
    const executed = run(project, ["--media"], media);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const result = resultOf(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(
      result.findings.filter((finding) => finding.check === "media.audio-shorter-than-out").length,
      3,
      JSON.stringify(result.findings, null, 2),
    );
    assert.equal(result.findings.filter((finding) => finding.check === "media.volume").length, 2);
    assert.equal(result.findings.filter((finding) => finding.check === "media.silence").length, 2);
    assert.ok(result.findings.some(
      (finding) => finding.check === "media.caption-silence-coverage" && finding.path.includes("clip"),
    ));
    assert.ok(result.findings
      .filter((finding) => finding.check.startsWith("media."))
      .every((finding) => /clip|vo/u.test(finding.path ?? "")));
    assert.ok(!result.skipped.some((item) => /compatibility view/u.test(item.reason)));
    const probeCalls = (await readFile(media.probeLog, "utf8")).trim().split("\n");
    assert.equal(probeCalls.length, 2, probeCalls.join("\n"));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("default execution never invokes ffprobe", async () => {
  const project = await makeProject();
  try {
    const media = await makeInvocationLoggingMediaStubs(project);
    const executed = run(project, [], media);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.ok(resultOf(executed).skipped.some(
      (item) => item.check === "media" && item.reason === "media checks require --media",
    ));
    await assert.rejects(access(media.invocationLog), { code: "ENOENT" });

    const mediaExecuted = run(project, ["--media"], media);
    assert.equal(mediaExecuted.status, 0, mediaExecuted.stderr || mediaExecuted.stdout);
    const invocations = (await readFile(media.invocationLog, "utf8")).trim().split("\n");
    assert.equal(
      invocations.filter((line) => line.startsWith("ffprobe ")).length,
      2,
      invocations.join("\n"),
    );
    assert.ok(invocations.some((line) => line.startsWith("ffmpeg ")), invocations.join("\n"));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("caption/silence coverage skips ambiguous multi-visual-source captions with a reason", async () => {
  const edit = baseEdit();
  edit.sources.push({ id: "clip-2", path: "assets/clip-2.mp4", proxy: null });
  edit.tracks.push({
    id: "v2",
    lane: "visual",
    items: [
      { id: "cut-4", at: 0, duration: 30, source: { kind: "media", src: "clip-2", in: 0, out: 1 } },
    ],
  });
  const project = await makeProject(edit);
  try {
    await writeFile(join(project, "assets", "clip-2.mp4"), "fixture", "utf8");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([{
      id: "c-0001",
      start: 0,
      end: 1,
      text: "ambiguous",
      speaker: null,
      sourceRef: null,
      edited: false,
    }])}\n`, "utf8");
    const media = await makeMediaStubs(project);
    const executed = run(project, ["--media"], media);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const result = resultOf(executed);
    assert.ok(result.skipped.some(
      (item) => item.check === "media.caption-silence-coverage"
        && /exactly one referenced visual source/u.test(item.reason),
    ));
    assert.ok(!result.findings.some(
      (finding) => finding.check === "media.caption-silence-coverage",
    ));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("v2 and legacy narration trim values fail with audio.narration.trim", async () => {
  const cases = [
    ["v2 reversed", (() => {
      const edit = baseEdit();
      edit.tracks[1].items[0].source = { kind: "media", src: "vo", in: 9.7, out: 5.8 };
      return edit;
    })()],
    ["v2 negative", (() => {
      const edit = baseEdit();
      edit.tracks[1].items[0].source.in = -1;
      return edit;
    })()],
    ["v2 non-number", (() => {
      const edit = baseEdit();
      edit.tracks[1].items[0].source.in = "invalid";
      return edit;
    })()],
    ["legacy narration declaration reversed", (() => {
      const edit = baseEdit();
      edit.tracks[1].items = [];
      edit.audio = {
        narration: [{ id: "n-0001", path: "assets/vo.m4a", t: 0, in: 9.7, out: 5.8 }],
      };
      return edit;
    })()],
  ];
  for (const [label, edit] of cases) {
    const project = await makeProject(edit);
    try {
      const executed = run(project);
      assert.equal(executed.status, 1, `${label}: ${executed.stderr || executed.stdout}`);
      assert.ok(resultOf(executed).findings.some(
        (finding) => finding.check === "audio.narration.trim" && finding.severity === "error",
      ), label);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

test("legacy narration declarations tolerate valid in/out fields", async () => {
  const edit = baseEdit();
  edit.tracks[1].items = [];
  edit.audio = {
    narration: [{ id: "n-0001", path: "assets/vo.m4a", t: 0, in: 5.8, out: 9.7 }],
  };
  const project = await makeProject(edit);
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.ok(!resultOf(executed).findings.some(
      (finding) => finding.check === "audio.narration.trim"
        || finding.check === "edit.structure",
    ));
    const media = await makeMediaStubs(project, { voiceDuration: 5 });
    const mediaExecuted = run(project, ["--media"], media);
    assert.equal(mediaExecuted.status, 0, mediaExecuted.stderr || mediaExecuted.stdout);
    assert.ok(resultOf(mediaExecuted).findings.some(
      (finding) => finding.check === "audio.narration.trim"
        && finding.severity === "warning"
        && finding.path === "edit.json#audio.narration[0].in",
    ));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("--media warns when narration in is at or beyond the audio stream duration", async () => {
  const project = await makeProject();
  try {
    const media = await makeMediaStubs(project, { voiceDuration: 5 });
    const executed = run(project, ["--media"], media);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.ok(resultOf(executed).findings.some(
      (finding) => finding.check === "audio.narration.trim"
        && finding.severity === "warning"
        && finding.path.includes("vo"),
    ));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("out-of-order track items warn without failing", async () => {
  const edit = baseEdit();
  edit.tracks[0].items = [edit.tracks[0].items[1], edit.tracks[0].items[0]];
  const project = await makeProject(edit);
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const finding = resultOf(executed).findings.find(
      (item) => item.check === "timeline.items.order",
    );
    assert.equal(finding?.severity, "warning");
    assert.match(finding.message, /cut-1.*position 1.*at=0.*cut-2.*position 0.*at=148/u);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("all existing fixtures keep their normalized default results", async () => {
  const expected = JSON.parse(await readFile(
    join(packageRoot, "test", "fixture-default-results.snapshot.json"),
    "utf8",
  ));
  const actual = await collectFixtureDefaultSnapshot(join(packageRoot, "fixtures"));
  assert.equal(actual.fixture_count, 112);
  assert.deepEqual(
    Object.keys(actual.fixtures),
    Object.keys(expected.fixtures),
    "fixture directory set differs from the golden snapshot",
  );
  for (const fixtureName of Object.keys(expected.fixtures)) {
    assert.deepEqual(
      actual.fixtures[fixtureName],
      expected.fixtures[fixtureName],
      `default lint result changed for fixture ${fixtureName}\nexpected=${JSON.stringify(expected.fixtures[fixtureName], null, 2)}\nactual=${JSON.stringify(actual.fixtures[fixtureName], null, 2)}`,
    );
  }
  assert.equal(expected.fixture_count, 112);
});
