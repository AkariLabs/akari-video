import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import { parseElectronArguments } from "../src/electron-main.mjs";
import { buildOsrPage, loadAndBuildOsrPage } from "../src/page-builder.mjs";

const require = createRequire(import.meta.url);
const { TEXTSTYLE_CATALOG } = require("../../edit-store/lib/index.js");

const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: 30, look: { lut: "warm", intensity: 0.7 } },
  sources: [{ id: "main", path: "assets/main.mp4" }],
  cuts: [{ id: "cut-0", src: "main", in: 0, out: 2 }],
  overlays: [],
};
const captions = [{ id: "c1", start: 0, end: 1, text: "字幕", time_domain: "output" }];
const overlays = [{ id: "o1", start: 0, duration: 1, html: "<div>HTML</div>", transform: {}, vars: {} }];

function zAxisEdit(order) {
  const tracks = {
    low: { id: "low-track", lane: "visual", items: [{ id: "low", at: 0, duration: 30, source: { kind: "html", path: "low.html" } }] },
    captions: { id: "caption-track", lane: "visual", items: [{ id: "captions", at: 0, duration: 30, source: { kind: "captions", path: "captions.json", exclude: [] }, items: [] }] },
    high: { id: "high-track", lane: "visual", items: [{ id: "high", at: 0, duration: 30, source: { kind: "html", path: "high.html" } }] },
  };
  return {
    version: 2,
    output: { width: 64, height: 36, fps: 30 },
    sources: [],
    tracks: order.map((id) => tracks[id]),
  };
}

async function writeZAxisProject(projectRoot, order) {
  await Promise.all([
    writeFile(join(projectRoot, "edit.json"), JSON.stringify(zAxisEdit(order))),
    writeFile(join(projectRoot, "captions.json"), JSON.stringify([{ id: "c1", start: 0, end: 1, text: "caption" }])),
    writeFile(join(projectRoot, "low.html"), "<div>low</div>"),
    writeFile(join(projectRoot, "high.html"), "<div>high</div>"),
  ]);
}

function regionFilterEdit(lutId) {
  return {
    version:2, output:{width:64,height:36,fps:30},
    sources:[{id:'main',path:'assets/main.mp4'}],
    tracks:[
      { id:'v-main', lane:'visual', items:[{id:'cut',at:0,duration:30,source:{kind:'media',src:'main',in:0,out:1}}] },
      { id:'v-filter', lane:'visual', items:[{id:'region',at:0,duration:30,source:{kind:'filter',filter:{type:'lut',id:lutId,intensity:.5}}}] },
    ],
  };
}

function itemAdjustEdit(lutId = 'mono') {
  return {
    version: 2, output: { width: 64, height: 36, fps: 30 },
    sources: [{ id: 'main', path: 'assets/main.mp4' }],
    tracks: [{ id: 'v-main', lane: 'visual', items: [{
      id: 'adjusted-cut', at: 0, duration: 30,
      source: { kind: 'media', src: 'main', in: 0, out: 1 },
      adjust: { basic: { exposure: 1 }, lut: { lut: lutId, intensity: 0.5 } },
    }] }],
  };
}

test('OSR page resolves item adjust LUT text by item id and declares source-quad application', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'osr-item-adjust-'));
  try {
    await writeFile(join(projectRoot, 'edit.json'), JSON.stringify(itemAdjustEdit()));
    const built = await loadAndBuildOsrPage({ projectRoot, duration: 1 });
    assert.equal(built.edit.cuts[0].adjust.basic.exposure, 1);
    assert.equal(built.manifest.adjustApplication, 'engine-item-source');
    assert.match(built.html, /adjustLutCubeTexts/u);
    assert.match(built.html, /"adjusted-cut":"[^"]*LUT_3D_SIZE/u);
  } finally { await rm(projectRoot, { recursive: true, force: true }); }
});

test('OSR page fails closed with the item id and missing adjust LUT id', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'osr-item-adjust-missing-'));
  try {
    await writeFile(join(projectRoot, 'edit.json'), JSON.stringify(itemAdjustEdit('missing-adjust-lut')));
    await assert.rejects(
      () => loadAndBuildOsrPage({ projectRoot, duration: 1 }),
      /item adjust LUT missing-adjust-lut for adjusted-cut/u,
    );
  } finally { await rm(projectRoot, { recursive: true, force: true }); }
});

test('OSR page builder resolves region-filter LUT cube text into page config', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'osr-filter-lut-'));
  try {
    await writeFile(join(projectRoot, 'edit.json'), JSON.stringify(regionFilterEdit('mono')));
    const built = await loadAndBuildOsrPage({ projectRoot, duration:1 });
    assert.equal(built.edit.layers[0].filter.type, 'lut');
    assert.match(built.edit.layers[0].filter.cubeText, /LUT_3D_SIZE/u);
  } finally { await rm(projectRoot, {recursive:true,force:true}); }
});

test('OSR page builder fails closed with the missing region-filter LUT id', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'osr-filter-missing-'));
  try {
    await writeFile(join(projectRoot, 'edit.json'), JSON.stringify(regionFilterEdit('missing-region-lut')));
    await assert.rejects(() => loadAndBuildOsrPage({ projectRoot, duration:1 }), /missing-region-lut/u);
  } finally { await rm(projectRoot, {recursive:true,force:true}); }
});

test('OSR page builder は captions.json で stale anchor cache を再解決し、不在時は保持する', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'osr-anchor-wiring-'));
  const anchored = {
    version: 2,
    output: { width: 64, height: 36, fps: 30 },
    sources: [{ id: 'main', path: 'assets/main.mp4' }],
    tracks: [
      { id: 'main', lane: 'visual', items: [{ id: 'cut', at: 0, duration: 300, source: { kind: 'media', src: 'main', in: 0, out: 10 } }] },
      { id: 'overlay', lane: 'visual', items: [{ id: 'box', at: 15, duration: 15, source: { kind: 'html', path: 'box.html' }, anchor: { caption: 'c-0003' } }] },
    ],
  };
  try {
    await writeFile(join(projectRoot, 'edit.json'), JSON.stringify(anchored));
    await writeFile(join(projectRoot, 'box.html'), '<div>box</div>');
    let result = await loadAndBuildOsrPage({ projectRoot, duration: 4 });
    assert.equal(result.edit.overlays[0].start, 0.5);
    await writeFile(join(projectRoot, 'captions.json'), JSON.stringify([
      { id: 'c-0003', start: 2, end: 3, text: 'caption' },
    ]));
    result = await loadAndBuildOsrPage({ projectRoot, duration: 4 });
    assert.equal(result.edit.overlays[0].start, 2);
    assert.equal(result.edit.overlays[0].duration, 1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('OSR page builder の v1 拒否は captions.json の有無で同一', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'osr-anchor-v1-'));
  try {
    await writeFile(join(projectRoot, 'edit.json'), JSON.stringify({
      version: 1, output: { fps: 30 }, sources: [], cuts: [], overlays: [],
    }));
    await assert.rejects(() => loadAndBuildOsrPage({ projectRoot, duration: 1 }), /古い形式/u);
    await writeFile(join(projectRoot, 'captions.json'), '[]\n');
    await assert.rejects(() => loadAndBuildOsrPage({ projectRoot, duration: 1 }), /古い形式/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("page builder は同じ入力から同一バイトを生成する", () => {
  const input = { edit, captions, overlays, projectRoot: "/unused", duration: 2, frameEngineBundle: "window.AkariFrameEngine={};", pageRuntime: "void 0;", lutCubeText: "TITLE warm\nLUT_3D_SIZE 2\n" };
  assert.equal(buildOsrPage(input).html, buildOsrPage(input).html);
});

test("page builder は4層、字幕生成器、H+1、canvas 内 LUT を宣言する", () => {
  const result = buildOsrPage({ edit, captions, overlays, projectRoot: "/unused", duration: 2, frameEngineBundle: "window.AkariFrameEngine={};", pageRuntime: "void 0;", lutCubeText: "TITLE warm\nLUT_3D_SIZE 2\n" });
  assert.equal(result.manifest.dimensions.pageHeight, 181);
  assert.equal(result.edit.output.width, 320);
  assert.equal(result.edit.output.look.lut, "warm");
  assert.equal(result.manifest.captionOverlayCount, 1);
  assert.equal(result.manifest.lutApplication, "engine-canvas");
  assert.match(result.html, /height: 181px/);
  assert.match(result.html, /id="akari-engine"/);
  assert.match(result.html, /id="akari-overlays"/);
  assert.match(result.html, /TITLE warm/);
  assert.doesNotMatch(result.html, /filter:\s*url|filter:\s*lut/i);
  assert.match(result.overlaySheetHtml, /data-overlay-id="c1-01"/);
});

test("OSR 実読込点の caption overlays は style_preset 参照と値焼き込みで一致する", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "osr-style-preset-parity-"));
  try {
    const entries = Object.entries(TEXTSTYLE_CATALOG);
    const records = entries.map(([id], index) => ({
      id: `c-${String(index + 1).padStart(4, "0")}`,
      start: 0,
      end: 1,
      text: id,
      time_domain: "output",
    }));
    const editRoot = {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [],
      tracks: [{
        id: "captions",
        lane: "visual",
        items: [{
          id: "captions-bag",
          at: 0,
          duration: 30,
          source: { kind: "captions", path: "captions.json", exclude: [] },
          items: [],
        }],
      }],
    };
    const writeProject = async (name, captionsRoot) => {
      const project = join(temporary, name);
      await mkdir(project);
      await Promise.all([
        writeFile(join(project, "edit.json"), JSON.stringify(editRoot)),
        writeFile(join(project, "captions.json"), JSON.stringify(captionsRoot)),
      ]);
      return project;
    };
    const referencedProject = await writeProject("referenced", {
      captions: records.map((record, index) => ({ ...record, style_preset: entries[index][0] })),
    });
    const burnedProject = await writeProject("burned", {
      captions: records.map((record, index) => ({ ...record, text_style: entries[index][1].style })),
    });
    const options = { duration: 1, fps: 30, width: 320, height: 180 };
    const referenced = await loadAndBuildOsrPage({ ...options, projectRoot: referencedProject });
    const burned = await loadAndBuildOsrPage({ ...options, projectRoot: burnedProject });
    assert.equal(referenced.overlaySheetHtml, burned.overlaySheetHtml);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("OSR page builder は字幕段の最下・中間・最上を overlays 2 段と同じ z 軸へ載せる", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "osr-track-z-"));
  try {
    for (const [order, expected] of [
      [["captions", "low", "high"], ["c1-01", "low", "high"]],
      [["low", "captions", "high"], ["low", "c1-01", "high"]],
      [["low", "high", "captions"], ["low", "high", "c1-01"]],
    ]) {
      await writeZAxisProject(projectRoot, order);
      const result = await loadAndBuildOsrPage({ projectRoot, duration: 1 });
      assert.deepEqual([...result.overlaySheetHtml.matchAll(/data-overlay-id="([^"]+)"/gu)].map((match) => match[1]), expected);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("--edit 未指定の Electron 引数は null のままでも projectRoot/edit.json を読む", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "osr-default-edit-"));
  try {
    await writeFile(join(projectRoot, "edit.json"), JSON.stringify({
      version: 2,
      output: { width: 222, height: 124, fps: 30 },
      sources: [{ id: "main", path: "assets/main.mp4", proxy: null }],
      tracks: [{
        id: "main-video",
        lane: "visual",
        items: [{
          id: "cut-0", at: 0, duration: 60,
          source: { kind: "media", src: "main", in: 0, out: 2 },
        }],
      }],
    }));
    const parsed = parseElectronArguments([
      "--render", projectRoot, "--out", join(projectRoot, "out.mp4"), "--duration", "2",
    ]);
    assert.equal(parsed.editPath, null);
    const built = await loadAndBuildOsrPage({
      projectRoot,
      editPath: parsed.editPath,
      fps: 30,
      width: 222,
      height: 124,
      duration: 2,
    });
    assert.equal(built.edit.output.width, 222);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
