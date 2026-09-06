import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { lintProject } from "../src/edit-lint.mjs";
import { migrateFixtureTree } from "./helpers/v2-fixture.mjs";

async function lintCase(t, html, prepare) {
  const project = await mkdtemp(join(tmpdir(), "lint-fragment-assets-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await cp(new URL("./fixtures/overlay-fragment-assets/", import.meta.url), project, { recursive: true });
  if (html) await writeFile(join(project, "overlays/lower-third/fragment.html"), html);
  const options = await prepare?.(project);
  await migrateFixtureTree(project);
  const result = await lintProject(project, { writeReports: false, ...options });
  return result.findings.filter(finding => finding.check.startsWith("overlay-fragment-asset-"));
}

test("missing fragment asset is an error with a correction hint", async t => {
  const findings = await lintCase(t, '<div><img src="../assets/logo.svg"></div>');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, "overlay-fragment-asset-missing");
  assert.equal(findings[0].severity, "error");
  assert.ok(findings[0].message.includes('の参照 "../assets/logo.svg" が見つからない。断片ファイル基準では'));
  for (const value of ["overlay:logo", "overlays/lower-third/fragment.html", '"../assets/logo.svg"', "`overlays/assets/logo.svg`", "`../../assets/logo.svg` に直してください"]) assert.ok(findings[0].message.includes(value), findings[0].message);
});

test("references escaping the project are errors", async t => {
  const findings = await lintCase(t, '<div style="background:url(../../../outside.png)"></div>');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, "overlay-fragment-asset-escapes-project");
  assert.equal(findings[0].severity, "error");
  assert.match(findings[0].message, /の参照 "\.\.\/\.\.\/\.\.\/outside.png": escapes the project root$/u);
});

test("absolute local paths are distinct errors across HTML and CSS", async t => {
  const findings = await lintCase(t, '<div><img src="C:/example/logo.png"><img srcset="/opt/example/logo.png 1x"><style>.x{background:url(file:///opt/example/logo.png)}</style></div>');
  assert.equal(findings.length, 3);
  for (const finding of findings) {
    assert.equal(finding.check, "overlay-fragment-asset-absolute-path");
    assert.equal(finding.severity, "error");
    assert.match(finding.message, /断片からの相対パスで書く/u);
  }
});

test("correct assets, remote URLs, media URLs, comments, and JSON do not produce asset errors", async t => {
  assert.deepEqual(await lintCase(t), []);
  assert.deepEqual(await lintCase(t, `<div><img src="../../assets/logo.svg"><img srcset="data:image/png;base64,eA== 1x, https://example.test/logo.png 2x"><video src="/media/clip.mp4"></video><!-- <img src="missing.png"> --><script type="application/json">{"html":"<img src='missing.png'>"}</script></div>`), []);
});

test("directories are missing assets and inline HTML is excluded", async t => {
  const findings = await lintCase(t, '<div><img src="../../assets"></div>');
  assert.equal(findings[0].check, "overlay-fragment-asset-missing");
  assert.equal(findings[0].message, 'overlay:logo fragment overlays/lower-third/fragment.html の参照 "../../assets" が見つからない。');
  assert.deepEqual(await lintCase(t, undefined, async project => {
    const file = join(project, "edit.json");
    const edit = JSON.parse(await readFile(file, "utf8"));
    edit.tracks[0].items[0].source = { kind: "html", path: '<div><img src="missing.png"></div>' };
    await writeFile(file, JSON.stringify(edit));
  }), []);
});

test("declared asset-library fallback is accepted", async t => {
  assert.deepEqual(await lintCase(t, '<div><img src="../../assets/still/logo/logo.svg"></div>', async project => {
    const libraryHome = await mkdtemp(join(tmpdir(), "lint-fragment-library-"));
    t.after(() => rm(libraryHome, { recursive: true, force: true }));
    await mkdir(join(project, ".akari"), { recursive: true });
    await writeFile(join(project, ".akari/asset-references.json"), JSON.stringify({ version: 0, references: [{ category: "still", id: "logo" }] }));
    await mkdir(join(libraryHome, "assets/still/logo"), { recursive: true });
    await cp(join(project, "assets/logo.svg"), join(libraryHome, "assets/still/logo/logo.svg"));
    return { env: { ...process.env, AKARI_HOME: libraryHome } };
  }), []);
});
