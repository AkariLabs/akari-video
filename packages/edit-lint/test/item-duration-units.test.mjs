import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { lintProject } from "../src/edit-lint.mjs";

async function findingsFor(item, lane = "visual", path = "clip.mp4") {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-duration-units-"));
  try {
    const edit = {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: "clip", path }],
      tracks: [{ id: "track", lane, items: [item] }],
    };
    await writeFile(join(root, path), "fixture");
    await writeFile(join(root, "card.html"), "<p>fixture</p>");
    await writeFile(join(root, "captions.json"), "[]");
    await writeFile(join(root, "edit.json"), JSON.stringify(edit));
    const result = await lintProject(root, { writeReports: false });
    assert.equal(result.verdict, "pass", JSON.stringify(result.findings));
    return result.findings;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const media = (duration, source = {}) => ({
  id: "clip-item", at: 0, duration,
  source: { kind: "media", src: "clip", in: 0, out: 4, ...source },
});
const check = (findings, id) => findings.filter(finding => finding.check === id);

test("four frames warn about both units and source duration", async () => {
  const findings = await findingsFor(media(4));
  assert.equal(check(findings, "v2.item-duration-short").length, 1);
  assert.match(check(findings, "v2.item-duration-short")[0].message, /4 フレーム（0\.13 秒）/u);
  assert.match(check(findings, "v2.item-duration-short")[0].message, /120 フレーム/u);
  assert.equal(check(findings, "v2.item-duration-source-mismatch").length, 1);
  assert.match(check(findings, "v2.item-duration-source-mismatch")[0].message, /30\.0 倍/u);
});

test("half-second boundary and non-media items", async () => {
  assert.equal(check(await findingsFor(media(14)), "v2.item-duration-short").length, 1);
  assert.equal(check(await findingsFor(media(15)), "v2.item-duration-short").length, 0);
  assert.equal(check(await findingsFor({ id: "html", at: 0, duration: 10, source: { kind: "html", path: "card.html" } }), "v2.item-duration-short").length, 1);
  assert.equal(check(await findingsFor({ ...media(3), role: "sfx" }, "audio"), "v2.item-duration-short").length, 0);
  assert.equal(check(await findingsFor({ ...media(4), role: "sfx" }, "audio"), "v2.item-duration-source-mismatch").length, 1);
  const group = { id: "group", at: 0, duration: 30, source: { kind: "group" }, items: [
    { id: "child", at: 0, duration: 5, source: { kind: "html", path: "card.html" } },
  ] };
  assert.equal(check(await findingsFor(group), "v2.item-duration-short").length, 1);
  group.items[0] = { id: "caption", at: 0, duration: 5, source: { kind: "caption", path: "captions.json", id: "c1" } };
  assert.equal(check(await findingsFor(group), "v2.item-duration-short").length, 0);
});

test("matching speed, still images, and freeze are exempt from mismatch", async () => {
  for (const [item, path] of [
    [media(120), "clip.mp4"],
    [media(60, { speed: 2 }), "clip.mp4"],
    [media(4), "still.png"],
    [media(4, { freeze: { at: 0 } }), "clip.mp4"],
  ]) {
    assert.equal(check(await findingsFor(item, "visual", path), "v2.item-duration-source-mismatch").length, 0);
  }
  assert.equal(check(await findingsFor(media(120)), "v2.item-duration-short").length, 0);
  assert.equal(check(await findingsFor(media(600)), "v2.item-duration-source-mismatch").length, 1);
});
