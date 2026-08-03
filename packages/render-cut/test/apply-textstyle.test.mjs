import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "akari-apply-textstyle.mjs");

function run(projectDir, presetId, args = []) {
  return spawnSync(process.execPath, [cliPath, projectDir, presetId, ...args], {
    encoding: "utf8",
  });
}

async function withFixture(captions, callback) {
  const projectDir = await mkdtemp(join(tmpdir(), "apply-textstyle-"));
  const captionsPath = join(projectDir, "captions.json");
  await writeFile(captionsPath, `${JSON.stringify(captions, null, 2)}\n`);
  try {
    await callback({ projectDir, captionsPath });
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

test("applies a preset to an object root default_text_style", async () => {
  const captions = { project_note: "keep", captions: [] };
  await withFixture(captions, async ({ projectDir, captionsPath }) => {
    const result = run(projectDir, "subtitle-news");
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.preset_id, "subtitle-news");
    assert.equal(output.dry_run, false);
    assert.equal(output.changes[0].target, "default_text_style");

    const updated = JSON.parse(await readFile(captionsPath, "utf8"));
    assert.equal(updated.project_note, "keep");
    assert.equal(updated.default_text_style.size_px, 56);
    assert.equal(updated.default_text_style.weight, 700);
    assert.equal(updated.default_text_style.background.color, "#c62828");
  });
});

test("upgrades an array root and applies top-level preset position", async () => {
  const captions = [{ id: "c-1", start: 0, end: 1, text: "本文" }];
  await withFixture(captions, async ({ projectDir, captionsPath }) => {
    const result = run(projectDir, "narration-caption");
    assert.equal(result.status, 0, result.stderr);

    const updated = JSON.parse(await readFile(captionsPath, "utf8"));
    assert.deepEqual(updated.captions, captions);
    assert.equal(updated.default_text_style.font_family, "'Noto Serif JP', serif");
    assert.deepEqual(updated.default_text_style.position, { y: 0.38 });
  });
});

test("applies a preset only to the selected zero-based caption index", async () => {
  const captions = {
    default_text_style: { color: "#123456", zone: "bottom" },
    captions: [
      { id: "c-1", start: 0, end: 1, text: "1 行目" },
      { id: "c-2", start: 1, end: 2, text: "2 行目", text_style: { align: "left" } },
      { id: "c-3", start: 2, end: 3, text: "3 行目" },
    ],
  };
  await withFixture(captions, async ({ projectDir, captionsPath }) => {
    const result = run(projectDir, "subtitle-news", ["--caption", "2"]);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.changes[0].target, "captions[2].text_style");

    const updated = JSON.parse(await readFile(captionsPath, "utf8"));
    assert.deepEqual(updated.default_text_style, captions.default_text_style);
    assert.equal(updated.captions[0].text_style, undefined);
    assert.deepEqual(updated.captions[1].text_style, { align: "left" });
    assert.equal(updated.captions[2].text_style.color, "#ffffff");
  });
});

test("preserves undeclared top-level and nested fields while preset fields win", async () => {
  const captions = {
    default_text_style: {
      zone: "top",
      align: "right",
      color: "#00ff00",
      background: { mode: "block", opacity: 0.25 },
      extension_field: { keep: true },
    },
    captions: [],
  };
  await withFixture(captions, async ({ projectDir, captionsPath }) => {
    const result = run(projectDir, "subtitle-news");
    assert.equal(result.status, 0, result.stderr);

    const updated = JSON.parse(await readFile(captionsPath, "utf8"));
    const style = updated.default_text_style;
    assert.equal(style.zone, "top");
    assert.equal(style.align, "right");
    assert.deepEqual(style.extension_field, { keep: true });
    assert.equal(style.color, "#ffffff");
    assert.equal(style.background.mode, "block");
    assert.equal(style.background.opacity, 1);
    assert.equal(style.background.padding_px, 16);
  });
});

test("reports preset candidates and exits 1 for an unknown id", async () => {
  await withFixture([], async ({ projectDir }) => {
    const result = run(projectDir, "not-a-real-preset");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /候補:/u);
    assert.match(result.stderr, /subtitle-news/u);
    assert.match(result.stderr, /ニュース風/u);
  });
});

test("dry-run emits JSON and leaves captions.json byte-for-byte unchanged", async () => {
  const captions = { default_text_style: { color: "#abcdef" }, captions: [] };
  await withFixture(captions, async ({ projectDir, captionsPath }) => {
    const before = await readFile(captionsPath, "utf8");
    const result = run(projectDir, "subtitle-news", ["--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.dry_run, true);
    assert.equal(output.changes[0].before.color, "#abcdef");
    assert.equal(output.changes[0].after.color, "#ffffff");
    assert.equal(await readFile(captionsPath, "utf8"), before);
  });
});

test("includes top-level preset animation and preserves one-level animation fields", async () => {
  const module = await import("../bin/akari-apply-textstyle.mjs");
  const incoming = module.resolvePresetStyleFields({
    style: { color: "#ffffff" },
    animation: { in: { id: "fade-up" } },
  });
  assert.deepEqual(incoming.animation, { in: { id: "fade-up" } });
  assert.deepEqual(
    module.mergeTextStyle(
      { animation: { loop: { id: "float" } }, custom: true },
      incoming,
    ),
    {
      animation: { loop: { id: "float" }, in: { id: "fade-up" } },
      custom: true,
      color: "#ffffff",
    },
  );
});
