import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { buildGpuPage, loadAndBuildGpuPage } from "../src/page-builder.mjs";

// Compile only into memory: tests exercise owned TS sources without rebuilding generated bundles.
const modules = new Map();
function loadSource(path) {
  if (modules.has(path)) return modules.get(path).exports;
  const module = { exports: {} };
  modules.set(path, module);
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", code)(
    specifier => loadSource(resolve(dirname(path), specifier.replace(/\.js$/u, ".ts"))), module, module.exports,
  );
  return module.exports;
}
const timeline = resolve(import.meta.dirname, "../../frame-engine/src/timeline");
const FE = {
  ...loadSource(join(timeline, "caption-animator.ts")),
  ...loadSource(join(timeline, "caption-words.ts")),
  ...loadSource(join(timeline, "caption-motion.ts")),
  ...loadSource(join(timeline, "layer-visual.ts")),
};
const source = readFileSync(new URL("../src/page-runtime.js", import.meta.url), "utf8");
const syntax = ts.createSourceFile("page-runtime.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node)) functions.set(node.name.text, node.getText(syntax));
  ts.forEachChild(node, visit);
}
visit(syntax);
const extract = (names, bindings = {}) => new Function(...Object.keys(bindings),
  `${names.map(name => functions.get(name)).join("\n")}\nreturn { ${names.join(",")} };`)(...Object.values(bindings));
const { prepareCaptionAnimatorUnits, captionAnimatorTilesAt, captionAnimatorItemStateAt } = extract(
  ["prepareCaptionAnimatorUnits", "captionAnimatorTilesAt", "captionAnimatorItemStateAt"], { FE },
);
const config = { width: 1920, height: 1080, fps: 30 };
const rect = (x, y, width = 20, height = 20) => ({ x, y, width, height, right: x + width, bottom: y + height });
const a = (basis = "chars", amount = { y: 24 }, extra = {}) => ({ id: basis, basis, shape: "ramp", start: 0, end: 1, offset: 0, amount, ...extra });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

function measured(chars = true) {
  const line = { getBoundingClientRect: () => ({ left: 100, top: 40, right: 180, bottom: 60, width: 80, height: 20 }) };
  const word = (classes, delay) => ({
    classList: { contains: name => classes.includes(name) },
    style: { getPropertyValue: name => name === "--akari-tok-delay" ? `${delay}s` : "" },
    querySelector: () => null,
    closest(selector) { return selector === ".akari-caption__line" ? line : this; },
    getClientRects: () => [{ left: 100 + delay * 40, top: 40, right: 140 + delay * 40, bottom: 60, width: 40, height: 20 }],
  });
  const words = [word(["akari-caption__tok", "akari-caption__tok--pop"], 0), word(["akari-caption__tok"], 1)];
  const elements = [0, 1, 2, 3].map(index => ({
    classList: { contains: () => false },
    getAttribute: () => String(index + 7),
    closest: selector => selector === ".akari-caption__line" ? line : words[Math.floor(index / 2)],
    getClientRects: () => [{ left: 100 + index * 20, top: 40, right: 120 + index * 20, bottom: 60, width: 20, height: 20 }],
  }));
  const root = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    querySelector: () => null,
    querySelectorAll: selector => selector === ".akari-caption__reveal-group" ? []
      : selector === ".akari-caption__char" ? chars ? elements : []
      : selector === ".akari-caption__line" ? [line] : words,
  };
  const { measureCaptionUnit } = extract(
    ["measureCaptionUnit", "relativeRect", "tokenRole", "tokenStyle", "tokenTiming", "cssSeconds"],
    { getComputedStyle: () => ({ fontSize: "20px" }) },
  );
  return measureCaptionUnit(root, 0);
}

test("char tokens carry cue indices, parent word timing and line membership", () => {
  const measurement = measured();
  assert.deepEqual(measurement.tokens.map(t => [t.tokenIndex, t.charIndex, t.wordIndex, t.lineIndex]),
    [[7, 7, 0, 0], [8, 8, 0, 0], [9, 9, 1, 0], [10, 10, 1, 0]]);
  assert.deepEqual(measurement.tokens.slice(0, 2).map(t => t.timing),
    Array.from({ length: 2 }, () => ({ role: "pop", delaySec: 0, durationSec: 0.2, emPx: 20 })));
  assert.equal(measurement.tokens[2].timing, null);
});

test("word measurement without char spans retains its exact serialized shape", () => {
  const measurement = measured(false);
  assert.deepEqual(measurement.tokens, [
    { tokenIndex: 0, rectIndex: 0, role: "pop", style: "pop", timing: { role: "pop", delaySec: 0, durationSec: 0.2, emPx: 20 }, rect: rect(100, 40, 40), lineIndex: 0 },
    { tokenIndex: 1, rectIndex: 0, role: "plain", style: null, timing: null, rect: rect(140, 40, 40), lineIndex: 0 },
  ]);
});

function prepared(raw, measurement = measured()) {
  const textureRect = FE.captionWordTextureRect(measurement, config);
  const tiles = FE.buildCaptionWordTiles(measurement, { ...config, textureRect, includeTokens: true });
  const unit = { tiles, animatorTokens: measurement.tokens, animatorLines: measurement.lines.length };
  prepareCaptionAnimatorUnits([unit], FE.normalizeAnimators(raw), { start: 2 });
  return unit;
}
function wordTiles(unit, time) {
  return unit.tiles.map(tile => tile.timing ? { ...tile.static, ...FE.captionWordStateAt(tile.timing, time) } : tile.static);
}

test("tiles preserve token identity while background and padding remain static", () => {
  const unit = prepared([a()]);
  assert.equal(unit.tiles.filter(t => t.token).length, 4);
  const input = wordTiles(unit, 0.1);
  const output = captionAnimatorTilesAt(unit, input, 2.1, config);
  for (const [i, tile] of unit.tiles.entries()) {
    if (!tile.token) assert.equal(output[i], input[i]);
    else close(output[i].translateY, (input[i].translateY ?? 0) + (tile.token.charIndex - 7 + 0.5) / 4 * 24);
  }
});

test("mixed bases add translation and opacity deltas, multiply scale, and carry rotation", () => {
  const unit = prepared([
    a("chars", { x: 8, scale: 0.5, opacity: -1, rotate: 80 }),
    a("words", { x: 16, scale: 1, opacity: 1, rotate: 40 }),
    a("lines", { y: 10, opacity: -1 }),
  ]);
  const input = wordTiles(unit, 0.1);
  const output = captionAnimatorTilesAt(unit, input, 2.1, config);
  const i = unit.tiles.findIndex(tile => tile.token);
  close(output[i].translateX, 8 * 0.125 + 16 * 0.25);
  close(output[i].translateY, input[i].translateY + 5);
  close(output[i].scaleX, input[i].scaleX * (1 + 0.5 * 0.125) * (1 + 0.25));
  close(output[i].opacity, input[i].opacity * (1 - 0.125 + 0.25 - 0.5));
  close(output[i].rotateDeg, 80 * 0.125 + 40 * 0.25);
});

test("opacity clamps once after all basis deltas and does not revive invisible word roles", () => {
  for (const [amount, expected] of [[-1, 0], [1, 1]]) {
    const unit = prepared([a("chars", { opacity: amount }, { shape: "square" }), a("words", { opacity: amount }, { shape: "square" })]);
    const input = wordTiles(unit, 1).map(tile => ({ ...tile, visible: false }));
    const output = captionAnimatorTilesAt(unit, input, 3, config);
    for (const [i, tile] of unit.tiles.entries()) if (tile.token) {
      assert.equal(output[i].opacity, expected);
      assert.equal(output[i].visible, false);
    }
  }
});

test("selector keyframes use item-relative time and output-pixel scaling", () => {
  const unit = prepared([a("chars", { y: 24 })]);
  unit.animator.keyframes = [{ t: 0, animator: { chars: { offset: 0 } } }, { t: 30, animator: { chars: { offset: 1 } } }];
  const i = unit.tiles.findIndex(tile => tile.token);
  const input = unit.tiles.map(t => t.static);
  close(captionAnimatorTilesAt(unit, input, 2, { ...config, width: 960 })[i].translateY, 1.5);
  assert.equal(captionAnimatorTilesAt(unit, input, 2.5, config)[i].translateY, 0);
});

test("whole-cue motion, item transform and item keyframes compose outside word tiles", () => {
  const unit = prepared([a()]);
  unit.animator.item = { transform: { x: 12, y: -20, scale: 2, rotate: 10 }, opacity: 0.5 };
  const state = FE.captionMotionAt(null, 0.1, 3, 20);
  const actual = captionAnimatorItemStateAt(unit, state, 2.1, config);
  close(actual.opacity, state.opacity * 0.5);
  close(actual.translateY, state.translateY - 20);
  assert.equal(actual.scaleX, state.scaleX * 2);
  unit.animator.keyframes = [{ t: 0, opacity: 0 }, { t: 30, opacity: 1 }];
  close(captionAnimatorItemStateAt(unit, state, 2.25, config).opacity, state.opacity * 0.25);
});

test("reveal raster groups share cue-wide word and line selector counts", () => {
  const units = [0, 1].map(() => {
    const token = { tokenIndex: 0, lineIndex: 0 };
    return { animatorTokens: [token], animatorLines: 1, tiles: [{ token }] };
  });
  prepareCaptionAnimatorUnits(units, FE.normalizeAnimators([a("words"), a("lines")]), { start: 0 });
  for (const group of units[0].animator.groups) {
    assert.equal(group.units.count, 2);
    assert.deepEqual(units.map(unit => group.units.unitIndexOf(unit.tiles[0].token)), [0, 1]);
  }
});

test("no animator preserves tile objects and serialized output", () => {
  const tiles = [{ ...rect(0, 0), opacity: 1 }];
  assert.equal(captionAnimatorTilesAt({}, tiles, 0, config), tiles);
  const { captionHtmlWithUnitMarkers } = extract(["captionHtmlWithUnitMarkers"]);
  const html = '<p class="akari-caption__line">A &amp; B</p>';
  assert.equal(captionHtmlWithUnitMarkers(html), html);
  assert.equal(captionHtmlWithUnitMarkers(html, []), html);
  const measurement = measured();
  const legacy = FE.buildCaptionWordTiles(measurement, config);
  assert.ok(legacy.every(tile => !Object.hasOwn(tile, "token")));
});

test("caption unit builder activates tiles for plain animators and retains legacy sprite output", async () => {
  const measurement = measured();
  for (const token of measurement.tokens) { token.role = "plain"; token.style = null; token.timing = null; }
  const messages = [];
  const { buildCaptionUnits } = extract(["buildCaptionUnits"], {
    FE, warnCaptionAnimatorOnce: (code) => messages.push(code), prepareCaptionAnimatorUnits,
    captionHtmlWithUnitMarkers: html => html,
    captionRoot: () => ({ querySelectorAll: () => [], remove() {} }),
    document: { fonts: { ready: Promise.resolve() } },
    CAPTION_WORD_FREEZE_CSS: "", CAPTION_MEASURE_ROOT_CLASS: "measure",
    CAPTION_MEASURE_UNSTABLE_REASON: "unstable", captionUnitCss: () => "",
    measureCaptionVariantsStable: async (value, config, html, variants) => variants.map(() => measurement),
    compareCaptionLayouts: () => 0,
  });
  const input = { id: "cue", html: "plain", start: 0, duration: 3 };
  const baseline = (await buildCaptionUnits(input, config, [], [], {})).units[0];
  assert.equal(baseline.mode, "sprite");
  assert.equal(baseline.tiles, null);
  assert.equal(Object.hasOwn(baseline, "animator"), false);
  const animated = (await buildCaptionUnits({ ...input, animator: [a("chars", { blur: 4, letterSpacing: 2 })] }, config, [], [], {})).units[0];
  assert.equal(animated.mode, "geometry");
  assert.equal(animated.secondaryId, "cue::unit-0::b");
  assert.equal(animated.tiles.filter(tile => tile.token).length, 4);
  assert.equal(animated.animator.groups[0].units.count, 4);
  assert.deepEqual(messages, ["animator.letterSpacing-ignored", "animator.blur-ignored"]);
});

test("mixed chars and words keep siblings in one word and fragmented chars in one char unit", () => {
  const tokens = measured().tokens;
  tokens.push({ ...tokens[0], rectIndex: 1 });
  for (const [basis, count, expected] of [["chars", 4, [0, 1, 2, 3, 0]], ["words", 2, [0, 0, 1, 1, 0]]]) {
    const units = FE.animatorUnitsOf(basis, tokens);
    assert.equal(units.count, count);
    assert.deepEqual(tokens.map(units.unitIndexOf), expected);
  }
});

test("unsupported amounts warn once per code and rotation remains a supported tile field", () => {
  const messages = [];
  const { warnCaptionAnimatorOnce } = extract(["warnCaptionAnimatorOnce"], {
    captionAnimatorWarnings: new Set(), warn: message => messages.push(message),
  });
  for (let i = 0; i < 3; i++) for (const name of ["blur", "letterSpacing"]) warnCaptionAnimatorOnce(name, "ignored");
  assert.deepEqual(messages, ["blur: ignored", "letterSpacing: ignored"]);
  assert.match(functions.get("buildCaptionUnits"), /animator\.blur-ignored/u);
  assert.match(functions.get("buildCaptionUnits"), /animator\.letterSpacing-ignored/u);
  assert.doesNotMatch(functions.get("buildCaptionUnits"), /rotate-ignored/u);
  const sprite = loadSource(resolve(timeline, "../exits/sprite-compositor.ts"));
  assert.equal(sprite.normalizeSpriteTile({ x: 20, y: 20, width: 40, height: 20, rotateDeg: 90 }).rotateDeg, 90);
  const matrix = sprite.spriteTileMatrix({ x: 20, y: 20, width: 40, height: 20, rotateDeg: 90 }, 200, 100);
  const center = [-0.6, 0.4];
  close(matrix[0] * center[0] + matrix[3] * center[1] + matrix[6], center[0]);
  close(matrix[1] * center[0] + matrix[4] * center[1] + matrix[7], center[1]);
});

async function project(t, bagAnimator, cueAnimator, sidecar = false) {
  const root = await mkdtemp(join(tmpdir(), "akari-gpu-caption-animator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const points = [{ t: 0, animator: { chars: { offset: -0.3 } } }, { t: 15, animator: { chars: { offset: 1 } } }];
  if (sidecar) {
    await mkdir(join(root, "motion"));
    await writeFile(join(root, "motion", "cue.json"), JSON.stringify({ version: 0, group: "detached", items: { detached: points } }));
  }
  const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [{ id: "s", path: "source.mp4" }], tracks: [
    { id: "video", lane: "visual", items: [{ id: "cut", at: 0, duration: 150, source: { kind: "media", src: "s", in: 0, out: 5 } }] },
    { id: "subtitles", lane: "visual", items: [{ id: "bag", at: 0, duration: 150, source: { kind: "captions", path: "captions.json", exclude: ["c2"] }, ...(bagAnimator ? { animator: [a()] } : {}) }] },
    { id: "detached-track", lane: "visual", items: [{ id: "detached", at: 60, duration: 30, source: { kind: "caption", path: "captions.json", id: "c2" },
      ...(cueAnimator ? { animator: [a()], keyframes: sidecar ? { path: "motion/cue.json", count: 2 } : points, transform: { y: -200 }, opacity: 0.8 } : {}) }] },
  ] };
  const captions = { captions: [0, 1, 2].map(i => ({ id: `c${i + 1}`, start: i, end: i + 1, text: "字幕😀", time_domain: "output", words: [{ text: "字幕😀", start: i, end: i + 1 }] })) };
  await writeFile(join(root, "edit.json"), JSON.stringify(edit));
  await writeFile(join(root, "captions.json"), JSON.stringify(captions));
  return loadAndBuildGpuPage({ projectRoot: root, duration: 5 });
}

test("bag declarations reach all included cues while undeclared detached cues keep their route", async t => {
  const result = await project(t, true, false);
  assert.deepEqual(result.spriteManifest.captions.map(c => c.id), ["bag::c1-01", "bag::c3-01"]);
  assert.ok(result.spriteManifest.captions.every(c => c.animator?.[0].basis === "chars" && c.html.includes("akari-caption__char")));
  assert.ok(result.edit.overlays.some(o => o.id === "detached"));
});

for (const sidecar of [false, true]) test(`detached animator reaches only its cue with frame keyframes (${sidecar ? "bag" : "inline"})`, async t => {
  const result = await project(t, false, true, sidecar);
  const cues = result.spriteManifest.captions;
  assert.equal(cues.length, 3);
  assert.ok(cues.slice(0, 2).every(c => !c.animator && !c.html.includes("akari-caption__char")));
  const cue = cues[2];
  assert.equal(cue.id, "detached::c2-01");
  assert.equal(cue.start, 2);
  assert.equal(cue.duration, 1);
  assert.equal(cue.animatorStart, 2);
  assert.equal(cue.z, 2);
  assert.deepEqual(cue.animatorKeyframes.map(p => p.t), [0, 15]);
  assert.deepEqual(cue.animatorItem, { transform: { y: -200 }, opacity: 0.8 });
  assert.equal(result.edit.overlays.some(o => o.id === "detached"), false);
  assert.equal(result.eligibility.entries.some(e => e.kind === "overlay" && e.id === "detached"), false);
});

test("direct GPU page carries animator declarations only when present", () => {
  const edit = { output: config, cuts: [{ in: 0, out: 3 }], sources: [] };
  const cue = { id: "c", start: 0, end: 3, text: "ABC", time_domain: "output" };
  const build = captions => buildGpuPage({ edit, captions, duration: 3, projectRoot: import.meta.dirname, frameEngineBundle: "", pageRuntime: "" }).spriteManifest.captions[0];
  assert.equal(Object.hasOwn(build([cue]), "animator"), false);
  assert.deepEqual(build([{ ...cue, animator: [a()] }]).animator, [a()]);
});
