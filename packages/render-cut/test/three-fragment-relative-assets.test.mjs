// 3D の宣言に書かれたパスは断片のフォルダ基準（無ければ従来どおりプロジェクト基準）、
// item の source.vars から来た画面のパスはプロジェクト基準で探す（3D モックアップを素材フォルダのまま置くため）。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderOverlaySheet } from "../src/rasterize.mjs";

const dataUri = (mime, text) => `data:${mime};base64,${Buffer.from(text).toString("base64")}`;

function sceneHtml(descriptor) {
  return '<div><canvas></canvas><script type="application/json" data-akari-3d-scene>'
    + JSON.stringify(descriptor) + "</script></div>";
}

function embeddedDescriptor(sheet) {
  const match = /<script type="application\/json" data-akari-3d-scene>([\s\S]*?)<\/script>/u.exec(sheet);
  assert.ok(match, "embedded scene descriptor should exist");
  return JSON.parse(match[1]);
}

function render(projectRoot, overlay) {
  return renderOverlaySheet({
    overlays: [{ id: "phone", start: 0, duration: 1, vars: {}, ...overlay }],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot,
    duration: 1,
  });
}

test("断片に書かれたパスは断片のフォルダ基準、画面の変数はプロジェクト基準で埋め込む", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-three-fragment-assets-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const assetDir = join(projectRoot, "assets", "scene3d", "demo");
  await mkdir(join(assetDir, "logos"), { recursive: true });
  await mkdir(join(projectRoot, "assets", "clips"), { recursive: true });
  await writeFile(join(assetDir, "model.glb"), "fragment-model");
  await writeFile(join(assetDir, "placeholder.png"), "fragment-placeholder");
  await writeFile(join(assetDir, "logos", "mark.svg"), "<svg/>");
  await writeFile(join(projectRoot, "assets", "clips", "user.png"), "user-screen");
  const descriptor = {
    model: "model.glb",
    materialOverrides: {
      ScreenMaterial: { texture: "placeholder.png", textureVar: "--akari-screen-src" },
      LogoMat: { texture: "logos/mark.svg", target: "mask" },
    },
  };
  const htmlPath = "assets/scene3d/demo/fragment.html";

  const literal = embeddedDescriptor(render(projectRoot, { html: sceneHtml(descriptor), htmlPath }));
  assert.equal(literal.model, dataUri("model/gltf-binary", "fragment-model"));
  assert.equal(literal.materialOverrides.ScreenMaterial.texture, dataUri("image/png", "fragment-placeholder"));
  assert.equal(literal.materialOverrides.LogoMat.texture, dataUri("image/svg+xml", "<svg/>"));

  const swapped = embeddedDescriptor(render(projectRoot, {
    html: sceneHtml(descriptor), htmlPath, vars: { "--akari-screen-src": "assets/clips/user.png" },
  }));
  assert.equal(swapped.materialOverrides.ScreenMaterial.texture, dataUri("image/png", "user-screen"));
});

test("断片のフォルダに無いパスは従来どおりプロジェクト基準（既存の断片の後方互換）", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-three-fragment-assets-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(join(projectRoot, "overlays"), { recursive: true });
  await mkdir(join(projectRoot, "models"), { recursive: true });
  await writeFile(join(projectRoot, "models", "scene.glb"), "project-model");
  const html = sceneHtml({ model: "models/scene.glb" });

  const withPath = embeddedDescriptor(render(projectRoot, { html, htmlPath: "overlays/scene.html" }));
  assert.equal(withPath.model, dataUri("model/gltf-binary", "project-model"));
  const inline = embeddedDescriptor(render(projectRoot, { html }));
  assert.equal(inline.model, dataUri("model/gltf-binary", "project-model"));
});

test("プロジェクトの外へ出るパスは断片基準でもプロジェクト基準でも拒否する", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-three-fragment-assets-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(join(projectRoot, "assets", "scene3d", "demo"), { recursive: true });
  assert.throws(() => render(projectRoot, {
    html: sceneHtml({ model: "../../../../outside.glb" }), htmlPath: "assets/scene3d/demo/fragment.html",
  }));
});

test("書き出し前の入力の収集も、3D の断片基準のパスを先に探し、無ければプロジェクト基準で探す", async (t) => {
  const { enumerateDeclaredRenderInputs } = await import("../src/render-inputs.mjs");
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-three-fragment-inputs-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const assetDir = join(projectRoot, "assets", "scene3d", "demo");
  await mkdir(assetDir, { recursive: true });
  await mkdir(join(projectRoot, "models"), { recursive: true });
  await writeFile(join(assetDir, "model.glb"), "fragment-model");
  await writeFile(join(assetDir, "placeholder.png"), "fragment-placeholder");
  await writeFile(join(projectRoot, "models", "legacy.glb"), "project-model");
  await writeFile(join(assetDir, "fragment.html"), sceneHtml({ model: "model.glb",
    materialOverrides: { ScreenMaterial: { texture: "placeholder.png", textureVar: "--akari-screen-src" } } }));
  await mkdir(join(projectRoot, "overlays"), { recursive: true });
  await writeFile(join(projectRoot, "overlays", "legacy.html"), sceneHtml({ model: "models/legacy.glb" }));
  const edit = { overlays: [
    { id: "phone", html: "assets/scene3d/demo/fragment.html" },
    { id: "legacy", html: "overlays/legacy.html" },
  ] };
  await writeFile(join(projectRoot, "edit.json"), JSON.stringify(edit));
  const inputs = await enumerateDeclaredRenderInputs({ projectRoot, edit });
  const pathOf = (role) => inputs.find((entry) => entry.role === role)?.path?.replaceAll("\\", "/");
  assert.equal(pathOf("overlay:phone:model"), "assets/scene3d/demo/model.glb");
  assert.equal(pathOf("overlay:phone:texture:ScreenMaterial"), "assets/scene3d/demo/placeholder.png");
  assert.equal(pathOf("overlay:legacy:model"), "models/legacy.glb");
});
