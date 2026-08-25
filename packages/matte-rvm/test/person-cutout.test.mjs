import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  PERSON_TRACK_ID,
  buildExtractionArgs,
  buildPatchedEdit,
  collectCuts,
  execute,
  parseArguments,
  parseCutIndices,
  resolveCutPlans,
  validateAndWrite,
} from "../../../skills/analyze-footage/bin/person-matte/person-cutout.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = join(repositoryRoot, "dev-fixtures/person-cutout/edit.json");
const cliPath = join(repositoryRoot, "skills/analyze-footage/bin/person-matte/person-cutout.mjs");

function fixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

async function withProject(edit, callback) {
  const project = mkdtempSync(join(tmpdir(), "person-cutout-test-"));
  try {
    writeFileSync(join(project, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`);
    return await callback(project);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

test("person-cutout parses comma-separated cuts and validates quality/model arguments", () => {
  assert.deepEqual(parseCutIndices("0,2,2"), [0, 2]);
  assert.equal(parseArguments(["--project", ".", "--cut", "0"]).quality, "balanced");
  assert.equal(
    parseArguments(["--project", ".", "--cut", "1", "--quality", "best", "--model", "resnet50"]).model,
    "resnet50",
  );
  assert.throws(() => parseCutIndices("0,-1"), /0 以上の整数/);
  assert.throws(
    () => parseArguments(["--project", ".", "--cut", "0", "--model", "resnet50"]),
    /--quality best/,
  );
  assert.throws(() => parseArguments(["--project", "."]), /--cut/);
  assert.throws(() => parseArguments(["--project", ".", "--cut", "0", "--wat", "x"]), /不明な引数/);
});

test("cut resolution keeps source in/out and applies explicit speed to the output window", () => {
  const edit = fixture();
  const plans = resolveCutPlans(edit, [0, 1], "/project");
  assert.deepEqual(
    plans.map(({ cut, source, in: sourceIn, out, speed, atFrames, durationFrames, t, duration }) => ({
      cut, source, in: sourceIn, out, speed, atFrames, durationFrames, t, duration,
    })),
    [
      { cut: 0, source: "assets/main.mp4", in: 1, out: 3, speed: 1, atFrames: 0, durationFrames: 60, t: 0, duration: 2 },
      { cut: 1, source: "assets/main.mp4", in: 4, out: 8, speed: 2, atFrames: 60, durationFrames: 60, t: 2, duration: 2 },
    ],
  );
  assert.equal(plans[1].layer.src, "assets/matte/person-1.webm");
  assert.equal(plans[1].item.source.out, 2);
  const extractionArgs = buildExtractionArgs(plans[1], "/tmp/cut-1.mkv");
  assert.match(extractionArgs[extractionArgs.indexOf("-vf") + 1], /^setpts=\(PTS-STARTPTS\)\/2,/u);
  assert.deepEqual(
    extractionArgs.slice(extractionArgs.indexOf("-frames:v"), extractionArgs.indexOf("-frames:v") + 2),
    ["-frames:v", "60"],
  );
  assert.throws(() => resolveCutPlans(edit, [2], "/project"), /範囲外/);
  const zeroDuration = fixture();
  zeroDuration.tracks[0].items[0].duration = 0;
  assert.throws(() => resolveCutPlans(zeroDuration, [0], "/project"), /1 フレーム以上/);
});

test("patch adds a v2-native person source/item and places its track above existing overlays", () => {
  const edit = fixture();
  const plans = resolveCutPlans(edit, [1], "/project");
  const patched = buildPatchedEdit(edit, plans);
  assert.deepEqual(edit.tracks.map((track) => track.id), ["v-main", "v-overlay"], "input is immutable");
  assert.deepEqual(patched.edit.tracks.map((track) => track.id), ["v-main", "v-overlay", PERSON_TRACK_ID]);
  assert.deepEqual(patched.edit.tracks.at(-1).items, [plans[0].item]);
  assert.deepEqual(patched.edit.sources.at(-1), {
    id: "person-cutout-1",
    path: "assets/matte/person-1.webm",
  });
  assert.equal(patched.actions[0].action, "added");
  assert.equal(patched.actions[0].kind, "video");
  assert.equal(patched.actions[0].src, "assets/matte/person-1.webm");
});

test("patch with no prior visual/overlay tracks still creates one explicit top person track", () => {
  const edit = fixture();
  edit.tracks = [edit.tracks[0]];
  const plan = resolveCutPlans(edit, [0], "/project");
  const patched = buildPatchedEdit(edit, plan);
  assert.deepEqual(patched.edit.tracks.map((track) => track.id), ["v-main", PERSON_TRACK_ID]);
});

test("reapplying the same cut updates instead of duplicating sources, items, or tracks", () => {
  const firstEdit = fixture();
  const firstPlan = resolveCutPlans(firstEdit, [0], "/project");
  const first = buildPatchedEdit(firstEdit, firstPlan).edit;
  assert.equal(collectCuts(first).length, 2, "generated matte items do not become selectable cuts");

  const secondPlan = resolveCutPlans(first, [0], "/project");
  const second = buildPatchedEdit(first, secondPlan);
  assert.equal(second.actions[0].action, "updated");
  assert.equal(second.edit.sources.filter((source) => source.id === "person-cutout-0").length, 1);
  assert.equal(second.edit.tracks.filter((track) => track.id === PERSON_TRACK_ID).length, 1);
  assert.equal(second.edit.tracks.at(-1).items.filter((item) => item.id === "person-0").length, 1);
});

test("existing track order is preserved when the person track is moved back to the top", () => {
  const edit = fixture();
  const plan = resolveCutPlans(edit, [0], "/project");
  const once = buildPatchedEdit(edit, plan).edit;
  once.tracks.splice(1, 0, once.tracks.pop());
  const twice = buildPatchedEdit(once, resolveCutPlans(once, [0], "/project")).edit;
  assert.deepEqual(twice.tracks.map((track) => track.id), ["v-main", "v-overlay", PERSON_TRACK_ID]);
});

test("dry-run validates v2, reports the patch, and changes neither edit.json nor filesystem", async () => {
  await withProject(fixture(), async (project) => {
    const editPath = join(project, "edit.json");
    const before = readFileSync(editPath, "utf8");
    const beforeMtime = statSync(editPath).mtimeMs;
    const result = await execute(parseArguments(["--project", project, "--cut", "0,1", "--dry-run"]));
    assert.equal(result.ok, true);
    assert.equal(result.dry_run, true);
    assert.equal(result.mattes[1].speed, 2);
    assert.deepEqual(result.track_order, ["v-main", "v-overlay", PERSON_TRACK_ID]);
    assert.deepEqual(result.tracks.map((track) => track.id), result.track_order);
    assert.equal(readFileSync(editPath, "utf8"), before);
    assert.equal(statSync(editPath).mtimeMs, beforeMtime);
    assert.throws(() => statSync(join(project, "assets/matte")), /ENOENT/);
  });
});

test("validated patch replaces edit.json atomically and a rejected candidate leaves it unchanged", async () => {
  await withProject(fixture(), async (project) => {
    const editPath = join(project, "edit.json");
    const edit = fixture();
    const plan = resolveCutPlans(edit, [0], project);
    const patched = buildPatchedEdit(edit, plan).edit;
    const accepted = validateAndWrite(editPath, patched);
    assert.equal(accepted.ok, true);
    assert.equal(JSON.parse(readFileSync(editPath, "utf8")).tracks.at(-1).id, PERSON_TRACK_ID);

    const acceptedText = readFileSync(editPath, "utf8");
    const invalid = structuredClone(patched);
    invalid.tracks.push(structuredClone(invalid.tracks[0]));
    const rejected = validateAndWrite(editPath, invalid);
    assert.equal(rejected.ok, false);
    assert.match(rejected.reason, /track id が重複/);
    assert.equal(readFileSync(editPath, "utf8"), acceptedText);
  });
});

for (const version of [0, 1]) {
  test(`edit.json v${version} is rejected with migrate guidance and remains unchanged`, async () => {
    const edit = version === 0
      ? { version: 0, output: {}, source: { path: "a.mp4" }, cuts: [] }
      : { version: 1, output: {}, sources: [], cuts: [] };
    await withProject(edit, async (project) => {
      const editPath = join(project, "edit.json");
      const before = readFileSync(editPath, "utf8");
      await assert.rejects(
        execute(parseArguments(["--project", project, "--cut", "0", "--dry-run"])),
        /v2 へ migrate してから/,
      );
      assert.equal(readFileSync(editPath, "utf8"), before);

      const cli = spawnSync(process.execPath, [cliPath, "--project", project, "--cut", "0", "--dry-run"], {
        encoding: "utf8",
      });
      assert.equal(cli.status, 1);
      assert.equal(cli.stdout.trim().split("\n").length, 1);
      const response = JSON.parse(cli.stdout);
      assert.equal(response.ok, false);
      assert.match(response.reason, /v2 へ migrate してから/);
      assert.equal(readFileSync(editPath, "utf8"), before);
    });
  });
}
