// 不具合メモ第23項（2026-09-18）: 同一素材を参照するレイヤーごとにハッシュを再計算していた問題。
// 88 分 4K の保存記録では入力 115 項目に対して一意の実体は 7 件だった。
// 守るべき区別: 「用途別の結果行は全件残す」× 「同じ実体の読み込みは 1 スナップショットに 1 回」
//              × 「スナップショットを跨いだら必ず再計測（素材差し替えを見逃さない）」。
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hashDeclaredRenderInputs,
  measureDeclaredInputFile,
} from "../src/render-inputs.mjs";

async function withProject(run) {
  const directory = await mkdtemp(join(tmpdir(), "render-inputs-shared-read-"));
  try {
    return await run(realpathSync(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function projectInput(root, role, name) {
  const lexical = join(root, name);
  return {
    role,
    path: name,
    lexical_path: lexical,
    absolute_path: realpathSync(lexical),
    project_root: root,
    scope: "project",
    text: null,
  };
}

function countingMeasure() {
  const reads = [];
  return {
    reads,
    impl: async (path) => {
      reads.push(path);
      return measureDeclaredInputFile(path);
    },
  };
}

test("同じ絶対パスの実体読み込みは 1 スナップショット内で 1 回に収まり、用途別の結果行は全件残る", async () => {
  await withProject(async (root) => {
    await writeFile(join(root, "master.mp4"), "master-bytes", "utf8");
    await writeFile(join(root, "bgm.wav"), "bgm-bytes", "utf8");

    // 同じ 2 つの実体を 8 つの参照用途から宣言する（レイヤーが同じ原本を指す実際の形）。
    const inputs = [
      projectInput(root, "source:main", "master.mp4"),
      projectInput(root, "layer:0", "master.mp4"),
      projectInput(root, "layer:1", "master.mp4"),
      projectInput(root, "layer:2", "master.mp4"),
      projectInput(root, "thumbnail", "master.mp4"),
      projectInput(root, "audio:bgm", "bgm.wav"),
      projectInput(root, "audio:sfx:0", "bgm.wav"),
      projectInput(root, "audio:sfx:1", "bgm.wav"),
    ];
    const counter = countingMeasure();
    const snapshot = await hashDeclaredRenderInputs(inputs, { measureFileImpl: counter.impl });

    // 一意の実体は 2 件。読み込みも 2 回だけ（8 回ではない）。
    assert.equal(counter.reads.length, 2);
    assert.deepEqual([...new Set(counter.reads)].sort(), counter.reads.sort());

    // 用途別の結果行は従来どおり 8 件すべて残る。
    assert.equal(snapshot.length, inputs.length);
    assert.deepEqual(snapshot.map((entry) => entry.role), inputs.map((entry) => entry.role));
    assert.deepEqual(snapshot.map((entry) => entry.path), inputs.map((entry) => entry.path));

    // 同じ実体を指す行は、共有した測定値をそのまま持つ（値が欠けたり変わったりしない）。
    const master = snapshot.filter((entry) => entry.path === "master.mp4");
    const bgm = snapshot.filter((entry) => entry.path === "bgm.wav");
    assert.equal(master.length, 5);
    assert.equal(bgm.length, 3);
    assert.equal(new Set(master.map((entry) => entry.sha256)).size, 1);
    assert.equal(new Set(bgm.map((entry) => entry.sha256)).size, 1);
    assert.notEqual(master[0].sha256, bgm[0].sha256);
    for (const entry of master) assert.equal(entry.bytes, "master-bytes".length);
    for (const entry of bgm) assert.equal(entry.bytes, "bgm-bytes".length);
  });
});

test("読み込み共有は宣言前の結果と同じスナップショットを作る（既定の実装と一致）", async () => {
  await withProject(async (root) => {
    await writeFile(join(root, "master.mp4"), "master-bytes", "utf8");
    const inputs = [
      projectInput(root, "source:main", "master.mp4"),
      projectInput(root, "layer:0", "master.mp4"),
    ];
    // 既定実装（差し替え口を使わない通常経路）でも同じ値が出る。
    const shared = await hashDeclaredRenderInputs(inputs);
    const perRole = await Promise.all(inputs.map(
      async (input) => (await hashDeclaredRenderInputs([input]))[0],
    ));
    assert.deepEqual(shared, perRole);
  });
});

test("キャッシュの寿命はスナップショット内だけ: 呼び出しを跨ぐと必ず再計測され、素材差し替えを検出する", async () => {
  await withProject(async (root) => {
    await writeFile(join(root, "master.mp4"), "before", "utf8");
    const inputs = [
      projectInput(root, "source:main", "master.mp4"),
      projectInput(root, "layer:0", "master.mp4"),
    ];
    const first = countingMeasure();
    const firstSnapshot = await hashDeclaredRenderInputs(inputs, { measureFileImpl: first.impl });
    assert.equal(first.reads.length, 1);

    // スナップショットの外で素材が差し替わった。
    await writeFile(join(root, "master.mp4"), "after-replacement", "utf8");

    const second = countingMeasure();
    const secondSnapshot = await hashDeclaredRenderInputs(inputs, { measureFileImpl: second.impl });
    // 2 回目のスナップショットは新しい Map を使うので、必ず読み直す。
    assert.equal(second.reads.length, 1);
    // その結果、差し替えは全ての用途別の行に現れる（見逃さない）。
    for (const [index, entry] of secondSnapshot.entries()) {
      assert.notEqual(entry.sha256, firstSnapshot[index].sha256);
      assert.notEqual(entry.bytes, firstSnapshot[index].bytes);
    }
  });
});

test("消費済みテキストを持つ行は実体を読まない（テキストが証拠なので共有対象外）", async () => {
  await withProject(async (root) => {
    await writeFile(join(root, "edit.json"), "{\"on-disk\":true}", "utf8");
    await writeFile(join(root, "master.mp4"), "master-bytes", "utf8");
    const editInput = { ...projectInput(root, "edit", "edit.json"), text: "{\"consumed\":true}" };
    const inputs = [
      editInput,
      projectInput(root, "source:main", "master.mp4"),
      projectInput(root, "layer:0", "master.mp4"),
    ];
    const counter = countingMeasure();
    const snapshot = await hashDeclaredRenderInputs(inputs, {
      useConsumedText: true,
      measureFileImpl: counter.impl,
    });
    // 読んだのは master.mp4 の 1 件だけ。edit.json は消費済みテキストから測る。
    assert.equal(counter.reads.length, 1);
    assert.equal(snapshot[0].bytes, Buffer.byteLength("{\"consumed\":true}"));
    assert.equal(snapshot.length, 3);
  });
});
