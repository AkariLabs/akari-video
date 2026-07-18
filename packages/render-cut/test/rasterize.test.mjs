import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { renderOverlaySheet } from "../src/rasterize.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("non-3D overlay sheets remain byte-identical", () => {
  const sheet = renderOverlaySheet({
    overlays: [
      {
        id: "plain",
        start: 0.25,
        duration: 1.5,
        html: "<div>plain</div>\n",
        transform: { x: 2, y: -3, scale: 1.2, rotate: 4 },
        vars: { "--tone": "red" },
      },
    ],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/unused",
    duration: 2,
  });

  assert.equal(sheet.length, 2241);
  assert.equal(
    createHash("sha256").update(sheet).digest("hex"),
    "1e26ad907d81bab7533525ba391bedba07f5d87ae116c8c92757957c58904b8f",
  );
  assert.doesNotMatch(sheet, /threeRuntime|AkariThree|data:model\/gltf-binary/);
});

test("3D overlay sheets inline the shared runtime and embed GLB data", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-3d-日本語 path-"));
  try {
    const modelBytes = Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x01, 0x02, 0x03]);
    await writeFile(join(projectRoot, "model.glb"), modelBytes);
    const sheet = renderOverlaySheet({
      overlays: [
        {
          id: "model",
          start: 1.25,
          duration: 2,
          html: `<div class="model"><canvas></canvas><div data-akari-3d-fallback>fallback</div><script data-akari-3d-scene type="application/json">{
            "model": "model.glb",
            "camera": { "position": [0, 0, 3] }
          }</script></div>`,
          transform: {},
          vars: {},
        },
      ],
      edit: { output: { width: 320, height: 180, fps: 30 } },
      projectRoot,
      duration: 4,
    });

    const bundleSource = await readFile(
      join(packageRoot, "..", "overlay-runtime", "src", "vendor", "three-bundle.js"),
      "utf8",
    );
    const runtimeSource = await readFile(
      join(packageRoot, "..", "overlay-runtime", "src", "three-runtime.js"),
      "utf8",
    );
    assert.ok(sheet.includes(bundleSource));
    assert.ok(sheet.includes(runtimeSource));
    assert.doesNotMatch(sheet, /"model"\s*:\s*"model\.glb"/);

    const declaration = sheet.match(
      /<script data-akari-3d-scene type="application\/json">([\s\S]*?)<\/script>/u,
    );
    assert.ok(declaration);
    assert.equal(
      JSON.parse(declaration[1]).model,
      `data:model/gltf-binary;base64,${modelBytes.toString("base64")}`,
    );
    assert.match(sheet, /querySelector\(':scope > \.scene-content'\)/);
    assert.match(
      sheet,
      /threeRuntime\.render\(threeContainer, seconds - start\)/,
    );
    assert.match(sheet, /threeRuntime\.render\(container, 0\)/);
    assert.match(sheet, /threeRuntime\.inspect\(container\)\.status/);
    assert.match(sheet, /Promise\.all\(threeContainers\.map\(waitForThreeContainer\)\)/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
