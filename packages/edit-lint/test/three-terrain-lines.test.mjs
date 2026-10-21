import assert from "node:assert/strict";
import { cp, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lintProject } from "../src/edit-lint.mjs";
import { migrateFixtureTree } from "./helpers/v2-fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const base = join(here, "fixtures", "overlay-motion-rules");
const terrainPng = join(here, "fixtures", "terrain-4x4.png");
const gsiDemPng = join(here, "fixtures", "terrain-gsi-dem-4x4.png");

const scene = descriptor =>
  `<script type="application/json" data-akari-3d-scene>${JSON.stringify(descriptor)}</script>`;

async function lintCase(t, body, { inline = false, files = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "edit-lint-three-terrain-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, "project");
  await cp(base, project, { recursive: true });
  const editPath = join(project, "edit.json");
  const edit = JSON.parse(await readFile(editPath, "utf8"));
  edit.source.path = join(project, "sample.mp4");
  edit.overlays = [{ id: "three", html: inline ? body : join(project, "overlays/three.html"), start: 0, duration: 1 }];
  if (!inline) await writeFile(join(project, "overlays/three.html"), body);
  for (const [path, contents] of Object.entries(files)) {
    if (contents === "fixture") await copyFile(terrainPng, join(project, path));
    else if (contents === "gsi-dem-fixture") await copyFile(gsiDemPng, join(project, path));
    else await writeFile(join(project, path), contents);
  }
  await writeFile(editPath, JSON.stringify(edit));
  await migrateFixtureTree(project);
  const result = await lintProject(project, { writeReports: false });
  return {
    terrain: result.findings.filter(finding => finding.check === "overlays.three-terrain"),
    lines: result.findings.filter(finding => finding.check === "overlays.three-lines"),
  };
}

const TERRAIN_FILES = {
  "overlays/terrain-4x4.png": "fixture",
  "overlays/photo.png": "fixture",
};

test("terrain / lines lint accepts a valid declaration and resolves the fragment-relative PNG", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: {
      heightmap: "terrain-4x4.png",
      texture: "photo.png",
      encoding: "gsi-dem",
      exaggeration: 2,
      size: [4, 6],
      meters: [400, 600],
      baseline: "sea",
      segments: 2,
    },
    lines: [{
      points: [[0, 0, 0], [1, 1, 1], [2, 0.5, 0]],
      color: "#12abef",
      width: 3,
      progress: 0.5,
      drape: true,
      lift: 0.02,
      keys: [
        { t: 0, progress: 0 },
        { t: 2, progress: 1, ease: "easeInOut" },
      ],
    }],
  })}</div>`, { files: TERRAIN_FILES });
  assert.deepEqual(findings.terrain, []);
  assert.deepEqual(findings.lines, []);
});

test("terrain lint rejects a missing heightmap and a missing texture", async t => {
  const missingHeightmap = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: { heightmap: "missing.png" },
  })}</div>`, { files: TERRAIN_FILES });
  assert.equal(missingHeightmap.terrain.length, 1);
  assert.match(missingHeightmap.terrain[0].message, /does not exist.*missing\.png/u);

  const missingTexture = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: { heightmap: "terrain-4x4.png", texture: "missing.jpg" },
  })}</div>`, { files: TERRAIN_FILES });
  assert.equal(missingTexture.terrain.length, 1);
  assert.match(missingTexture.terrain[0].message, /texture does not exist/u);
});

test("terrain lint rejects non-PNG heightmaps, fake PNG bytes, and absolute paths", async t => {
  const jpg = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: { heightmap: "photo.png" },
  })}</div>`, { files: { ...TERRAIN_FILES, "overlays/photo.png": "not a png" } });
  assert.equal(jpg.terrain.length, 1);
  assert.match(jpg.terrain[0].message, /not a PNG file|not a readable PNG/u);

  const extension = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: { heightmap: "terrain-4x4.jpg" },
  })}</div>`, { files: TERRAIN_FILES });
  assert.equal(extension.terrain.length, 1);
  assert.match(extension.terrain[0].message, /must be a \.png file/u);

  const absolute = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: { heightmap: "/tmp/terrain.png" },
  })}</div>`, { files: TERRAIN_FILES });
  assert.equal(absolute.terrain.length, 1);
  assert.match(absolute.terrain[0].message, /relative path/u);
});

test("terrain lint rejects out-of-range values and unknown fields", async t => {
  const cases = [
    { terrain: { heightmap: "terrain-4x4.png", encoding: "dem" }, message: /encoding must be "grayscale" or "gsi-dem"/u },
    { terrain: { heightmap: "terrain-4x4.png", exaggeration: 0 }, message: /exaggeration must be a number from/u },
    { terrain: { heightmap: "terrain-4x4.png", exaggeration: 101 }, message: /exaggeration must be a number from/u },
    { terrain: { heightmap: "terrain-4x4.png", size: [0, 10] }, message: /size must be an array of 2 positive/u },
    { terrain: { heightmap: "terrain-4x4.png", meters: [0, 10] }, message: /meters must be an array of 2 positive/u },
    { terrain: { heightmap: "terrain-4x4.png", meters: [100] }, message: /meters must be an array of 2 positive/u },
    { terrain: { heightmap: "terrain-4x4.png", baseline: "ground" }, message: /baseline must be "min" or "sea"/u },
    { terrain: { heightmap: "terrain-4x4.png", segments: 0 }, message: /segments must be an integer from 1 to 512/u },
    { terrain: { heightmap: "terrain-4x4.png", segments: 513 }, message: /segments must be an integer from 1 to 512/u },
    { terrain: { heightmap: "terrain-4x4.png", segments: 1.5 }, message: /segments must be an integer/u },
    { terrain: { heightmap: "terrain-4x4.png", color: "#fff" }, message: /unknown field: color/u },
  ];
  for (const item of cases) {
    const findings = await lintCase(t, `<div><canvas></canvas>${scene(item)}</div>`, { files: TERRAIN_FILES });
    assert.equal(findings.terrain.length, 1, JSON.stringify(item));
    assert.match(findings.terrain[0].message, item.message);
  }
});

test("lines lint rejects bad points, color, width, progress, and key order", async t => {
  const cases = [
    { lines: [{ points: [[0, 0, 0]] }], message: /at least 2 points/u },
    { lines: [{ points: [[0, 0], [1, 1, 1]] }], message: /array of 3 finite numbers/u },
    { lines: [{ points: [[0, 0, 0], [1, 1, 1]], color: "red" }], message: /6-digit hex color/u },
    { lines: [{ points: [[0, 0, 0], [1, 1, 1]], width: 0 }], message: /width must be a number greater than 0/u },
    { lines: [{ points: [[0, 0, 0], [1, 1, 1]], width: 65 }], message: /width must be a number greater than 0/u },
    { lines: [{ points: [[0, 0, 0], [1, 1, 1]], progress: 1.5 }], message: /progress must be a number from 0 to 1/u },
    { lines: [{ points: [[0, 0, 0], [1, 1, 1]], label: "a" }], message: /unknown field: label/u },
    { lines: [{ points: [[0, 0, 0], [1, 1, 1]], drape: 1 }], message: /drape must be a boolean/u },
    { lines: [{ points: [[0, 0, 0], [1, 1, 1]], drape: false, lift: -0.1 }], message: /lift must be a non-negative/u },
    { lines: [{ points: [[0, 0, 0], [1, 1, 1]], lift: "1" }], message: /lift must be a non-negative/u },
    {
      lines: [{ points: [[0, 0, 0], [1, 1, 1]], keys: [{ t: 2, progress: 0 }, { t: 1, progress: 1 }] }],
      message: /ascending t.*keys\[1\]\.t=1/u,
    },
    {
      lines: [{ points: [[0, 0, 0], [1, 1, 1]], keys: [{ t: 0, progress: 0, ease: "out" }] }],
      message: /ease must be "linear" or "easeInOut"/u,
    },
    {
      lines: [{ points: [[0, 0, 0], [1, 1, 1]], keys: [{ t: 0, progress: 2 }] }],
      message: /keys\[0\]\.progress must be a number from 0 to 1/u,
    },
  ];
  for (const item of cases) {
    const findings = await lintCase(t, `<div><canvas></canvas>${scene(item)}</div>`, { files: TERRAIN_FILES });
    assert.equal(findings.lines.length, 1, JSON.stringify(item));
    assert.match(findings.lines[0].message, item.message);
  }
});

test("terrain lint warns when gsi-dem heights dwarf size without meters", async t => {
  const files = {
    "overlays/terrain-gsi-dem-4x4.png": "gsi-dem-fixture",
  };
  const warning = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: { heightmap: "terrain-gsi-dem-4x4.png", encoding: "gsi-dem", size: [10, 10] },
  })}</div>`, { files });
  assert.equal(warning.terrain.length, 1);
  assert.equal(warning.terrain[0].severity, "warning");
  assert.match(warning.terrain[0].message, /height range is 589\.47 m.*more than 10x terrain\.size/u);
  assert.match(warning.terrain[0].message, /Add meters/u);

  // meters を宣言すれば、同じ高さの範囲でも縮尺が決まるので警告しない。
  const scaled = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: {
      heightmap: "terrain-gsi-dem-4x4.png", encoding: "gsi-dem",
      size: [5.8947, 5.8947], meters: [589.47, 589.47],
    },
  })}</div>`, { files });
  assert.deepEqual(scaled.terrain, []);

  // grayscale は標高ではないので警告しない。
  const grayscale = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: { heightmap: "terrain-gsi-dem-4x4.png", size: [10, 10] },
  })}</div>`, { files });
  assert.deepEqual(grayscale.terrain, []);
});

test("terrain lint checks inline HTML items against the project root", async t => {
  const valid = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: { heightmap: "terrain-4x4.png" },
  })}</div>`, { inline: true, files: { "terrain-4x4.png": "fixture" } });
  assert.deepEqual(valid.terrain, []);

  const invalid = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: { heightmap: "missing.png" },
  })}</div>`, { inline: true });
  assert.equal(invalid.terrain.length, 1);
  assert.match(invalid.terrain[0].message, /does not exist/u);
});

test("terrain lint leaves fragments without a terrain / lines declaration alone", async t => {
  const findings = await lintCase(t, "<div><canvas></canvas><p>no scene</p></div>");
  assert.deepEqual(findings.terrain, []);
  assert.deepEqual(findings.lines, []);
});

test("lines lint warns when drape is true without terrain and accepts drape with terrain", async t => {
  const lines = [{
    points: [[0, 0, 0], [1, 1, 1]],
    drape: true,
    keys: [{ t: 0, progress: 0 }, { t: 2, progress: 1 }],
  }];
  const warning = await lintCase(t, `<div><canvas></canvas>${scene({ lines })}</div>`, { files: TERRAIN_FILES });
  assert.equal(warning.lines.length, 1);
  assert.equal(warning.lines[0].severity, "warning");
  assert.match(warning.lines[0].message, /lines\[0\]\.drape is true but the scene has no terrain/u);

  const withTerrain = await lintCase(t, `<div><canvas></canvas>${scene({
    terrain: { heightmap: "terrain-4x4.png", size: [4, 6] },
    lines,
  })}</div>`, { files: TERRAIN_FILES });
  assert.deepEqual(withTerrain.lines, []);

  // drape: false は terrain が無くても警告しない（従来の線）。
  const plain = await lintCase(t, `<div><canvas></canvas>${scene({
    lines: [{ points: [[0, 0, 0], [1, 1, 1]], drape: false }],
  })}</div>`, { files: TERRAIN_FILES });
  assert.deepEqual(plain.lines, []);
});
