import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderOverlaySheet } from "../src/rasterize.mjs";

function sceneHtml(override) {
  return '<div><canvas></canvas><script type="application/json" data-akari-3d-scene>'
    + JSON.stringify({ model: "models/scene.glb", materialOverrides: { ScreenMaterial: override } })
    + "</script></div>";
}

function embeddedDescriptor(sheet) {
  const match = /<script type="application\/json" data-akari-3d-scene>([\s\S]*?)<\/script>/u.exec(sheet);
  assert.ok(match, "embedded scene descriptor should exist");
  return JSON.parse(match[1]);
}

function render(projectRoot, override, vars = {}) {
  return renderOverlaySheet({
    overlays: [{ id: "screen", start: 0, duration: 1, vars, html: sceneHtml(override) }],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot,
    duration: 1,
  });
}

test("renderOverlaySheet embeds textureVar and texture var() paths before three-runtime runs", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-three-material-vars-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(join(projectRoot, "models"));
  await mkdir(join(projectRoot, "textures"));
  await writeFile(join(projectRoot, "models", "scene.glb"), "glb");
  await writeFile(join(projectRoot, "textures", "default.png"), "default-texture");
  await writeFile(join(projectRoot, "textures", "selected.png"), "selected-texture");

  const selectedDataUri = `data:image/png;base64,${Buffer.from("selected-texture").toString("base64")}`;
  const defaultDataUri = `data:image/png;base64,${Buffer.from("default-texture").toString("base64")}`;

  const selected = embeddedDescriptor(render(projectRoot, {
    texture: "textures/default.png",
    textureVar: "--screen-src",
    brightness: 2,
  }, { "--screen-src": "textures/selected.png" }));
  assert.deepEqual(selected.materialOverrides.ScreenMaterial, {
    texture: selectedDataUri,
    brightness: 2,
  });

  const fallback = embeddedDescriptor(render(projectRoot, {
    texture: "textures/default.png",
    textureVar: "--screen-src",
    brightness: "var(--screen-brightness)",
  }));
  assert.deepEqual(fallback.materialOverrides.ScreenMaterial, {
    texture: defaultDataUri,
    brightness: "var(--screen-brightness)",
  });

  const directVariable = embeddedDescriptor(render(projectRoot, {
    texture: "var(--screen-src)",
  }, { "--screen-src": "textures/selected.png" }));
  assert.deepEqual(directVariable.materialOverrides.ScreenMaterial, { texture: selectedDataUri });

  assert.throws(
    () => render(projectRoot, { texture: "var(--screen-src)" }),
    { name: "TypeError", message: /texture must be a relative path/u },
  );

  const literal = embeddedDescriptor(render(projectRoot, {
    texture: "textures/default.png",
  }));
  assert.deepEqual(literal.materialOverrides.ScreenMaterial, { texture: defaultDataUri });
});
