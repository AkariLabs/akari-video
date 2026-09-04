import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("GPU 3D drives threeRuntime directly without the overlay-sheet seek path", async () => {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  // シートの __akariSeek（可視性トグル + アニメ同期 + 3D 描画の一式）には委譲しない。
  // ただし動画テクスチャのシークだけは共有する（__akariSeekVideos）— 呼ばないと 3D の
  // <video> が 0 秒の絵に固定される（issue #53）。順序は「シーク → 提示確定 → 3D 描画」。
  assert.doesNotMatch(source, /contentWindow\.__akariSeek\(/);
  assert.match(source, /await overlayFrame\.contentWindow\.__akariSeekVideos\(seconds\)/);
  const threeBlock = source.slice(source.indexOf("threeSampling.syncActive(seconds);"));
  assert.ok(
    threeBlock.indexOf("__akariSeekVideos") < threeBlock.indexOf("threeRuntime.render(record.container"),
    "video seek must precede the 3D draw",
  );
  assert.match(source, /threeRuntime\.render\(record\.container, seconds - value\.start\)/);
  assert.match(source, /const stages = \{ evaluate: \[\], three: \[\]/);
  assert.match(source, /threeRuntime\.inspect\(container\)/);
  assert.match(source, /status === "error"/);
  assert.match(source, /style\.visibility = "visible"/);
});
