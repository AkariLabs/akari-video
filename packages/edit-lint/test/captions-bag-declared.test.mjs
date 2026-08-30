import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";

const cue = [{
  id: "caption-01",
  start: 0,
  end: 1,
  time_domain: "output",
  text: "字幕",
  speaker: null,
  sourceRef: null,
  edited: true,
}];

function editWith(track) {
  return {
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [],
    tracks: [track],
  };
}

async function lint(edit) {
  const root = await mkdtemp(join(tmpdir(), "captions-bag-declared-"));
  try {
    await writeFile(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`);
    await writeFile(join(root, "captions.json"), `${JSON.stringify(cue, null, 2)}\n`);
    return await lintProject(root, { writeReports: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a captions bag is declared, content is deprecated, and missing declarations show bag JSON", async () => {
  const bag = await lint(editWith({
    id: "captions",
    lane: "visual",
    items: [{
      id: "captions",
      name: "字幕",
      at: 0,
      duration: 30,
      source: { kind: "captions", path: "captions.json" },
      items: [],
    }],
  }));
  assert.equal(bag.findings.filter(finding => finding.check === "v2.captions-track-undeclared").length, 0);
  assert.equal(bag.findings.filter(finding => finding.check === "v2.captions-content-deprecated").length, 0);

  const content = await lint(editWith({
    id: "captions",
    lane: "visual",
    content: { from: "captions.json" },
  }));
  assert.deepEqual(
    content.findings.filter(finding => finding.check.startsWith("v2.captions-"))
      .map(finding => finding.check),
    ["v2.captions-content-deprecated"],
  );

  const undeclared = await lint(editWith({
    id: "visual",
    lane: "visual",
    items: [{ id: "group", at: 0, duration: 30, source: { kind: "group" }, items: [] }],
  }));
  const warning = undeclared.findings.find(finding => finding.check === "v2.captions-track-undeclared");
  assert.equal(warning?.severity, "warning");
  assert.match(warning.message, /"kind": "captions"/u);
  assert.match(warning.message, /\{ "id": "captions", "name": "字幕", "at": 0, "duration": <出力尺>, "source": \{ "kind": "captions", "path": "captions\.json" \}, "items": \[\] \}/u);
});
