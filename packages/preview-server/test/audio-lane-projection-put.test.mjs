import assert from "node:assert/strict";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openProject } from "../../edit-store/lib/project.js";
import { applyPreviewProjection, projectPreviewEdit } from "../src/preview-edit.mjs";

// v2 の音声レーンに BGM / narration を置いたプロジェクトで、ブラウザプレビューからの
// 書き戻し（射影 PUT）が入口で throw していた。legacy 射影は BGM に t / duration を載せ
// （01f762d4）、narration の provenance は v2 で任意だが、凍結変換器の v1 受け入れ条件は
// その逆を要求するため。差分計算専用の補正で往復できることを固定する。
const packageRoot = path.resolve(import.meta.dirname, "..");
const sourceMedia = path.resolve(packageRoot, "..", "..", "test-project", "source.mp4");
const sourceBgm = path.resolve(packageRoot, "..", "..", "test-project", "bgm.mp3");

function audioLaneEdit() {
  return {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [
      { id: "main", path: "assets/source.mp4" },
      { id: "bgm", path: "assets/bgm.mp3" },
    ],
    tracks: [
      { id: "v1", lane: "visual", items: [
        { id: "cut-a", at: 0, duration: 90, source: { kind: "media", src: "main", in: 0, out: 3 } },
        { id: "cut-b", at: 90, duration: 60, source: { kind: "media", src: "main", in: 3, out: 5 } },
      ] },
      { id: "a1", lane: "audio", items: [
        { id: "bgm-1", at: 0, duration: 150, role: "bgm", source: { kind: "media", src: "bgm", in: 0, out: 5 } },
      ] },
      { id: "a2", lane: "audio", items: [
        { id: "nr-1", at: 0, duration: 60, role: "narration", source: { kind: "media", src: "main", in: 0, out: 2 } },
      ] },
    ],
  };
}

async function makeProject(edit) {
  const root = await mkdtemp(path.join(tmpdir(), "akari-preview-audio-lane-"));
  await mkdir(path.join(root, "assets"), { recursive: true });
  await copyFile(sourceMedia, path.join(root, "assets", "source.mp4"));
  await copyFile(sourceBgm, path.join(root, "assets", "bgm.mp3"));
  await writeFile(path.join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`, "utf8");
  return root;
}

function itemIds(edit) {
  return (edit.tracks ?? []).flatMap(track => (track.items ?? []).map(item => `${track.id}:${item.id}`));
}

function baselineOf(project, projectRoot) {
  return projectPreviewEdit(
    JSON.stringify(project.edit),
    path.join(projectRoot, ".akari", "preview-projection"),
    projectRoot,
  );
}

test("音声レーンの BGM / narration があっても射影 PUT は往復でき、item を落とさない", async () => {
  const projectRoot = await makeProject(audioLaneEdit());
  try {
    const before = JSON.parse(await readFile(path.join(projectRoot, "edit.json"), "utf8"));
    const project = await openProject(projectRoot);
    const baseline = baselineOf(project, projectRoot);
    assert.equal(baseline.audio.bgm.t, 0, "射影は BGM の終端情報を載せ続ける（プレビュー・書き出し用）");
    assert.equal(baseline.audio.bgm.duration, 5);
    applyPreviewProjection(project, structuredClone(baseline), baseline);
    await project.save({ lint: false });
    const after = JSON.parse(await readFile(path.join(projectRoot, "edit.json"), "utf8"));
    assert.deepEqual(itemIds(after), itemIds(before));
    assert.deepEqual(after.tracks, before.tracks);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("音声レーンのプロジェクトでも射影の変更だけが正本へ入る", async () => {
  const projectRoot = await makeProject(audioLaneEdit());
  try {
    const project = await openProject(projectRoot);
    const baseline = baselineOf(project, projectRoot);
    const incoming = structuredClone(baseline);
    incoming.cuts.find(cut => cut.id === "cut-b").out = 4;
    applyPreviewProjection(project, incoming, baseline);
    await project.save({ lint: false });
    const after = JSON.parse(await readFile(path.join(projectRoot, "edit.json"), "utf8"));
    const find = id => after.tracks.flatMap(track => track.items).find(item => item.id === id);
    assert.equal(find("cut-b").source.out, 4);
    assert.equal(find("cut-b").duration, 30);
    // 音声レーンの item は触られない。差分計算用の provenance 詰め物も残らない。
    assert.deepEqual(find("bgm-1"), {
      id: "bgm-1", at: 0, duration: 150, source: { kind: "media", src: "bgm", in: 0, out: 5 }, role: "bgm",
    });
    assert.deepEqual(find("nr-1"), {
      id: "nr-1", at: 0, duration: 60, source: { kind: "media", src: "main", in: 0, out: 2 }, role: "narration",
    });
    assert.equal(Object.hasOwn(find("nr-1"), "provenance"), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("narration の provenance は正本にあるものが保たれる", async () => {
  const edit = audioLaneEdit();
  edit.tracks[2].items[0].provenance = { provider: "voicevox", credit: "VOICEVOX:ずんだもん" };
  const projectRoot = await makeProject(edit);
  try {
    const project = await openProject(projectRoot);
    const baseline = baselineOf(project, projectRoot);
    applyPreviewProjection(project, structuredClone(baseline), baseline);
    await project.save({ lint: false });
    const after = JSON.parse(await readFile(path.join(projectRoot, "edit.json"), "utf8"));
    const narration = after.tracks.flatMap(track => track.items).find(item => item.id === "nr-1");
    assert.deepEqual(narration.provenance, { provider: "voicevox", credit: "VOICEVOX:ずんだもん" });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
