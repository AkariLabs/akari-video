import assert from "node:assert/strict";
import test from "node:test";

import { parseElectronArguments, resolvePreviewEvery } from "../src/electron-main.mjs";

const baseArguments = ["--render", "/project", "--out", "/tmp/export.mp4", "--duration", "1"];

test("resolvePreviewEvery: 1080p30 は 30 コマごと", () => {
  assert.equal(resolvePreviewEvery({ fps: 30, width: 1920, height: 1080 }), 30);
});

test("resolvePreviewEvery: 4K30 は 120 コマごと", () => {
  assert.equal(resolvePreviewEvery({ fps: 30, width: 3840, height: 2160 }), 120);
});

test("resolvePreviewEvery: 720p30 は 30 コマごと", () => {
  assert.equal(resolvePreviewEvery({ fps: 30, width: 1280, height: 720 }), 30);
});

test("parseElectronArguments: preview は既定 auto で off を受け取る", () => {
  assert.equal(parseElectronArguments(baseArguments).preview, "auto");
  assert.equal(parseElectronArguments([...baseArguments, "--preview", "off"]).preview, "off");
});

test("parseElectronArguments: preview の未知値を拒否する", () => {
  assert.throws(
    () => parseElectronArguments([...baseArguments, "--preview", "every"]),
    /--preview must be auto\|off/u,
  );
});

test("parseElectronArguments: preview 出力ディレクトリを受け取る", () => {
  assert.equal(
    parseElectronArguments([...baseArguments, "--preview-dir", "/tmp/x"]).previewOutputDirectory,
    "/tmp/x",
  );
});

test("parseElectronArguments: force eligibility は明示時だけ有効になる", () => {
  assert.equal(parseElectronArguments(baseArguments).forceEligibility, false);
  assert.equal(
    parseElectronArguments([...baseArguments, "--force-eligibility"]).forceEligibility,
    true,
  );
});
