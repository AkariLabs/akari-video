import assert from "node:assert/strict";
import test from "node:test";

import { extractThreeSceneAssetReferences } from "../src/render-inputs.mjs";

// 2026-08-14 回帰: texts[] だけの 3D シーン（glb を持たない立体テキスト）が render-cut を
// 通らなかった。「texts があれば model は任意」という緩和（contract-2026-08-12-3d-text-rail.md
// §3.1）が rasterize.mjs と three-runtime.js には入っていたのに、入力収集側の
// extractThreeSceneAssetReferences だけ model を無条件必須のままだったため。
// 同じ判定が複数箇所に複製されていて片方だけ追随していない、という同型の穴が
// enable 式（4 箇所）でも起きているので、両方ここで固定する。

function sceneHtml(scene) {
  return `<div><canvas></canvas><script type="application/json" data-akari-3d-scene>${JSON.stringify(scene)}</script></div>`;
}

test("texts[] だけのシーンは model 無しでも通り、font が入力として数えられる", () => {
  const references = extractThreeSceneAssetReferences(
    sceneHtml({
      texts: [{ id: "hook", text: "動画編集", font: "assets/font/biz/BIZ.ttf", mode: "extrude", size: 1.5 }],
    }),
    "overlay:hook",
  );
  assert.deepEqual(references, [{ role: "text-font:hook", path: "assets/font/biz/BIZ.ttf" }]);
});

test("model と texts の併存シーンは両方を入力として数える", () => {
  const references = extractThreeSceneAssetReferences(
    sceneHtml({
      model: "assets/scene3d/x/model.glb",
      texts: [{ id: "t", text: "あ", font: "assets/font/a/A.ttf" }],
    }),
    "overlay:mixed",
  );
  assert.deepEqual(references, [
    { role: "model", path: "assets/scene3d/x/model.glb" },
    { role: "text-font:t", path: "assets/font/a/A.ttf" },
  ]);
});

test("texts も model も無いシーンは従来どおり拒否する", () => {
  assert.throws(
    () => extractThreeSceneAssetReferences(sceneHtml({ camera: { fov: 30 } }), "overlay:empty"),
    /3D model must be a relative path/,
  );
});

test("texts[].font に絶対パスや URL を書いたら拒否する", () => {
  for (const font of ["/etc/passwd.ttf", "https://example.com/a.ttf"]) {
    assert.throws(
      () => extractThreeSceneAssetReferences(
        sceneHtml({ texts: [{ id: "hook", text: "あ", font }] }),
        "overlay:hook",
      ),
      /texts\.hook\.font must be a relative path/,
    );
  }
});

test("font を持たない texts[]（既定フォント任せ）は入力ゼロで通る", () => {
  const references = extractThreeSceneAssetReferences(
    sceneHtml({ texts: [{ id: "hook", text: "あ" }] }),
    "overlay:hook",
  );
  assert.deepEqual(references, []);
});
