import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "../..");
const repoRoot = path.resolve(skillDir, "../..");
const expandBin = path.join(skillDir, "bin", "expand-template.mjs");
const akariBin = process.env.AKARI_BIN || path.join(repoRoot, "packages", "akari-launcher", "bin", "akari.mjs");
const schemasBin = process.env.AKARI_SCHEMAS_BIN || path.join(repoRoot, "packages", "schemas", "bin", "validate-world-map.mjs");
const templates = ["paper-to-browser", "browser-to-chat", "street-to-room"];
const WORLD_RUNTIME_KEYS = {
  worlds: new Set(["id", "label", "palette", "flat"]),
  zones: new Set(["id", "label", "world", "c"]),
  cameraStops: new Set(["id", "world", "at", "leave", "c"]),
  edges: new Set(["id", "from", "to", "type", "t0", "t1", "switchTime", "transition", "via", "carry", "easing"]),
  transition: new Set(["kind", "cover"])
};

for (const name of templates) {
  test(`${name}: sampleScript を決定論的に展開して検査できる`, async (t) => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "design-world-test-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const templatePath = path.join(skillDir, "templates", `${name}.json`);
    const template = JSON.parse(await readFile(templatePath, "utf8"));
    const scriptPath = path.join(temporary, "script.json");
    await writeFile(scriptPath, `${JSON.stringify(template.sampleScript, null, 2)}\n`);

    const firstProject = path.join(temporary, "first");
    const secondProject = path.join(temporary, "second");
    const firstOut = path.join(firstProject, "planning", "world-map.json");
    const secondOut = path.join(secondProject, "planning", "world-map.json");
    await mkdir(path.dirname(firstOut), { recursive: true });
    await mkdir(path.dirname(secondOut), { recursive: true });
    run(process.execPath, [expandBin, templatePath, scriptPath, "--out", firstOut]);
    run(process.execPath, [expandBin, templatePath, scriptPath, "--out", secondOut]);

    const [first, second] = await Promise.all([readFile(firstOut), readFile(secondOut)]);
    assert.deepEqual(first, second, "同じ入力の world-map.json はバイト一致する");
    const map = JSON.parse(first.toString("utf8"));
    assert.equal(map.schemaVersion, 3);
    assert.equal(map.kind, "flat");
    assert.equal(map.edges.length, map.cameraStops.length - 1);
    assert.deepEqual(new Set(map.zones.map((zone) => zone.id)), new Set(map.cameraStops.map((stop) => stop.id)));
    for (const world of map.worlds) assert.ok(map.zones.filter((zone) => zone.world === world.id).length >= 2);
    for (const world of map.worlds) assertAllowedKeys(world, WORLD_RUNTIME_KEYS.worlds, "world");
    for (const zone of map.zones) assertAllowedKeys(zone, WORLD_RUNTIME_KEYS.zones, "zone");
    for (const stop of map.cameraStops) assertAllowedKeys(stop, WORLD_RUNTIME_KEYS.cameraStops, "cameraStop");
    const outputWidth = 1920;
    const outputHeight = 1080;
    for (const stop of map.cameraStops) {
      const world = map.worlds.find((candidate) => candidate.id === stop.world);
      assert.ok(world, `${stop.id}: world ${stop.world} が存在する`);
      const [boundsLeft, boundsTop, boundsWidth, boundsHeight] = world.flat.bounds;
      const boundsRight = boundsLeft + boundsWidth;
      const boundsBottom = boundsTop + boundsHeight;
      const [x, y, scale] = stop.c;
      const frameLeft = x - (outputWidth / 2) / scale;
      const frameRight = x + (outputWidth / 2) / scale;
      const frameTop = y - (outputHeight / 2) / scale;
      const frameBottom = y + (outputHeight / 2) / scale;
      assert.ok(frameLeft >= boundsLeft, `${stop.id}: 撮影枠の左が bounds から ${(boundsLeft - frameLeft).toFixed(1)} world px はみ出す`);
      assert.ok(frameRight <= boundsRight, `${stop.id}: 撮影枠の右が bounds から ${(frameRight - boundsRight).toFixed(1)} world px はみ出す`);
      assert.ok(frameTop >= boundsTop, `${stop.id}: 撮影枠の上が bounds から ${(boundsTop - frameTop).toFixed(1)} world px はみ出す`);
      assert.ok(frameBottom <= boundsBottom, `${stop.id}: 撮影枠の下が bounds から ${(frameBottom - boundsBottom).toFixed(1)} world px はみ出す`);
    }
    for (const edge of map.edges) {
      assertAllowedKeys(edge, WORLD_RUNTIME_KEYS.edges, "edge");
      assertAllowedKeys(edge.transition, WORLD_RUNTIME_KEYS.transition, "transition");
      assert.ok(Number.isFinite(edge.transition.cover), "transition.cover は有限数");
      assert.ok(edge.transition.cover >= 0 && edge.transition.cover <= 0.4, "transition.cover は 0〜0.4");
      assert.equal(edge.transition.cover, edge.type === "move" ? 0 : edge.type === "portal" ? 0.18 : 0.24, `${edge.type} の暫定 cover`);
    }

    await t.test("validate-world-map", { skip: !existsSync(schemasBin) && "schema validator が見つからない配布形" }, () => {
      run(schemasBin, [firstProject]);
    });
    await t.test("akari world check", { skip: !existsSync(akariBin) && "akari CLI が見つからない配布形" }, () => {
      run(akariBin, ["world", "check", firstProject]);
    });
  });
}

test("template の cover 上書きを優先し、範囲外を拒否する", async (t) => {
  const { temporary, original, templatePath, scriptPath, outPath } = await fixture(t);
  assert.ok(temporary);
  original.edges[1].cover = 0.31;
  await writeFile(templatePath, `${JSON.stringify(original, null, 2)}\n`);
  run(process.execPath, [expandBin, templatePath, scriptPath, "--out", outPath]);
  const map = JSON.parse(await readFile(outPath, "utf8"));
  assert.equal(map.edges[1].transition.cover, 0.31);

  original.edges[1].cover = 0.41;
  await writeFile(templatePath, `${JSON.stringify(original, null, 2)}\n`);
  const failed = spawnSync(process.execPath, [expandBin, templatePath, scriptPath, "--out", outPath], { encoding: "utf8" });
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /0 以上 0\.4 以下の有限数/);
});

test("script.stops の件数不一致を exit 2 で拒否する", async (t) => {
  const { original, templatePath, scriptPath, outPath } = await fixture(t);
  original.sampleScript.stops.pop();
  await writeFile(scriptPath, `${JSON.stringify(original.sampleScript, null, 2)}\n`);
  const failed = spawnSync(process.execPath, [expandBin, templatePath, scriptPath, "--out", outPath], { encoding: "utf8" });
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /同じ件数・順序/);
});

test("move の 0 以外の cover を exit 2 で拒否する", async (t) => {
  const { original, templatePath, scriptPath, outPath } = await fixture(t);
  original.edges[0].cover = 0.1;
  await writeFile(templatePath, `${JSON.stringify(original, null, 2)}\n`);
  const failed = spawnSync(process.execPath, [expandBin, templatePath, scriptPath, "--out", outPath], { encoding: "utf8" });
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /move では 0/);
});

test("中立な via と asset id を出力へ保つ", async (t) => {
  const { templatePath, scriptPath, outPath } = await fixture(t);
  run(process.execPath, [expandBin, templatePath, scriptPath, "--out", outPath]);
  const map = JSON.parse(await readFile(outPath, "utf8"));
  assert.equal(map.edges.find((edge) => edge.type === "portal").via, "paper-portal");
  assert.ok(map.inventory.every((item) => /^overlay\/(signpost|portal-frame)$/.test(item.asset)));
});

async function fixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "design-world-fixture-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const templatePath = path.join(temporary, "template.json");
  const scriptPath = path.join(temporary, "script.json");
  const outPath = path.join(temporary, "planning", "world-map.json");
  const original = JSON.parse(await readFile(path.join(skillDir, "templates", "paper-to-browser.json"), "utf8"));
  await writeFile(templatePath, `${JSON.stringify(original, null, 2)}\n`);
  await writeFile(scriptPath, `${JSON.stringify(original.sampleScript, null, 2)}\n`);
  return { temporary, original, templatePath, scriptPath, outPath };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function assertAllowedKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  assert.deepEqual(unknown, [], `${label} に world-runtime の未知キーを出さない`);
}
