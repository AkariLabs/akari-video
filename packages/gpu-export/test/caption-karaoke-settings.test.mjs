import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { evaluateGpuEligibility } from '../src/eligibility.mjs';
import { buildGpuPage } from '../src/page-builder.mjs';
import { generateCaptionOverlays } from '../../render-cut/src/captions.mjs';

const cue = { id: 'c-0001', style: 'karaoke', start: 0, end: 2, text: 'ABCD',
  words: [{ text: 'ABCD', start: 0, end: 2 }] };
const classify = (style, inherited) => evaluateGpuEligibility({ edit: { output: { width: 1920, height: 1080 } },
  captions: [{ ...cue, ...(style ? { text_style: { karaoke: style } } : {}) }],
  ...(inherited ? { defaultTextStyle: { karaoke: inherited } } : {}) }).entries.find(entry => entry.kind === 'caption');
const overlay = karaoke => generateCaptionOverlays([{ ...cue, text_style: { karaoke } }], [],
  { output: { width: 1920, height: 1080 } })[0];

const source = readFileSync(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
const compositorSource = readFileSync(resolve(import.meta.dirname, '../../frame-engine/src/exits/sprite-compositor.ts'), 'utf8');
const syntax = ts.createSourceFile('page-runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const compositorSyntax = ts.createSourceFile('sprite-compositor.ts', compositorSource,
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const sourceRectDeclaration = compositorSyntax.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'spriteTileSourceRect');
const sourceRectJs = ts.transpileModule(sourceRectDeclaration.getText(compositorSyntax).replace(/^export /u, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const spriteTileSourceRect = new Function('normalizeSpriteTile', 'normalizeSpriteTextureRect',
  `${sourceRectJs}\nreturn spriteTileSourceRect;`)(value => value, value => value);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node)) functions.set(node.name.text, node.getText(syntax));
  ts.forEachChild(node, visit);
}
visit(syntax);
const karaokeEpsilonDeclaration = source.match(/const CAPTION_KARAOKE_TIME_EPSILON_SEC = [^;]+;/u)?.[0];
const extract = names => new Function(`${karaokeEpsilonDeclaration}\n${names.map(name => functions.get(name)).join('\n')}\nreturn { ${names.join(',')} };`)();
const { karaokeSmoothTilesAt, karaokeWordMixAt, tokenRole, tokenTiming } = extract(
  ['karaokeSmoothTilesAt', 'karaokeWordMixAt', 'karaokeDelayReached', 'tokenRole', 'tokenTiming', 'cssSeconds']);

test('all three fills, start_index, and done_color stay GPU eligible', () => {
  assert.equal(classify().classification, 'same');
  for (const fill of ['char', 'word', 'smooth']) {
    assert.equal(classify({ fill, start_index: 2, done_color: '#fb923c' }).classification, 'same');
    assert.equal(classify({ start_index: 2, done_color: '#fb923c' }, { fill }).classification, 'same');
  }
  assert.equal(classify({ fill: 'unknown' }).reason, 'caption-karaoke-fill-unsupported');
  assert.equal(overlay({ done_color: '#fb923c' }).vars['--caption-highlight-color'], '#fb923c');
});

test('page builder retains the OSR karaoke spans and done color in the GPU caption manifest', () => {
  const captions = fills => fills.map((fill, index) => ({ ...cue, id: `c-${index}`,
    start: index * 2, end: (index + 1) * 2,
    words: [{ text: 'ABCD', start: index * 2, end: (index + 1) * 2 }],
    text_style: { karaoke: { fill, start_index: 1, done_color: '#fb923c' } } }));
  const page = buildGpuPage({
    edit: { version: 2, output: { width: 640, height: 360, fps: 30 },
      sources: [{ id: 'base', path: 'assets/base.mp4' }],
      cuts: [{ id: 'cut', src: 'base', in: 0, out: 6 }], overlays: [] },
    captions: captions(['char', 'word', 'smooth']), overlays: [], projectRoot: '/unused', duration: 6,
    frameEngineBundle: 'window.AkariFrameEngine={};', pageRuntime: 'void 0;',
  });
  assert.equal(page.eligibility?.eligible, true);
  assert.equal(page.spriteManifest.captions.length, 3);
  for (const [index, fill] of ['char', 'word', 'smooth'].entries()) {
    const item = page.spriteManifest.captions[index];
    assert.equal(item.vars['--caption-highlight-color'], '#fb923c');
    assert.match(item.html, /akari-caption__tok--karaoke-done/u);
    assert.match(item.html, new RegExp(fill === 'smooth' ? 'karaoke-smooth' : 'tok--karaoke'));
  }
});

test('OSR markup defines character, word, and smooth fill boundaries', () => {
  const char = overlay({ fill: 'char', start_index: 1 }).html;
  assert.match(char, /akari-caption__tok--karaoke-done[^>]*>A<\/span>/u);
  assert.equal((char.match(/akari-caption__tok--karaoke"/gu) ?? []).length, 3);
  assert.match(char, /--akari-tok-delay:0\.5s;--akari-tok-dur:0s/u);
  const word = overlay({ fill: 'word', start_index: 1 }).html;
  assert.equal((word.match(/akari-caption__tok--karaoke"/gu) ?? []).length, 1);
  assert.match(word, /--akari-tok-delay:0s;--akari-tok-dur:0s/u);
  const smooth = overlay({ fill: 'smooth', start_index: 1 }).html;
  assert.match(smooth, /akari-caption__tok--karaoke-smooth" data-karaoke-text="BCD"/u);
  assert.match(smooth, /--akari-tok-delay:0\.5s;--akari-tok-dur:1\.5s/u);
});

test('smooth timing is measured separately and its paused pseudo-element is frozen in both rasters', () => {
  const element = { classList: { contains: name => name === 'akari-caption__tok--karaoke-smooth' },
    style: { getPropertyValue: name => ({ '--akari-tok-delay': '0.5s', '--akari-tok-dur': '1.5s' })[name] ?? '' } };
  assert.equal(tokenRole(element), 'karaoke-smooth');
  assert.deepEqual(tokenTiming(element, 'karaoke-smooth', 40),
    { role: 'karaoke-smooth', delaySec: 0.5, durationSec: 1.5, emPx: 40 });
  assert.match(source, /akari-caption__tok--karaoke-smooth::after\{display:none!important\}/u);
  assert.match(source, /roles\.has\("karaoke-smooth"\)/u);
  assert.match(source, /mode === "color" \|\| animators\.length/u);
});

test('smooth wipe partitions the token into base, highlighted, and fractional-edge tiles', () => {
  const tile = { static: { x: 8, y: 20, width: 14, height: 24 },
    token: { rect: { x: 10.25, width: 9.5 } },
    timing: { role: 'karaoke-smooth', delaySec: 0.5, durationSec: 1.5 } };
  const at = time => karaokeSmoothTilesAt(tile, time);
  assert.ok(at(0.5).every(part => part.mix === 0));
  assert.deepEqual(at(1.25).map(({ x, width, mix }) => [x, width, mix]),
    [[8, 2, 0], [10, 1, 0.75], [11, 4, 1], [15, 7, 0]]);
  assert.equal(at(2).reduce((sum, part) => sum + part.width, 0), tile.static.width);
  assert.ok(at(2).some(part => part.mix === 1));
});

test('split tiles retain one-to-one source pixels and the original animator transform', () => {
  assert.match(compositorSource, /vec2 pixel = aDst\.xy \+ ratio \* aDst\.zw/u);
  assert.ok(source.indexOf('if (unit.animator) tiles = captionAnimatorTilesAt(unit, tiles, seconds, config);')
    < source.indexOf('tiles = tiles.flatMap((tile, index) => unit.tiles[index].timing?.role === "karaoke-smooth"'));
  const tile = { static: { x: 8, y: 20, width: 14, height: 24 },
    token: { rect: { x: 10.25, width: 9.5 } },
    timing: { delaySec: 0.5, durationSec: 1.5 } };
  const state = { ...tile.static, translateX: 2, translateY: -3, scaleX: 1.2,
    scaleY: 0.8, rotateDeg: 15, opacity: 0.6 };
  const parts = karaokeSmoothTilesAt(tile, 1.25, state, { width: 640, height: 360 });
  assert.equal(parts.reduce((sum, part) => sum + part.width, 0), tile.static.width);
  const radians = state.rotateDeg * Math.PI / 180;
  for (const part of parts) {
    const offset = part.x + part.width / 2 - (tile.static.x + tile.static.width / 2);
    const expectedX = state.x + state.width / 2 + state.translateX + Math.cos(radians) * state.scaleX * offset;
    const expectedY = state.y + state.height / 2 + state.translateY
      - Math.sin(radians) * state.scaleX * 360 / 640 * offset;
    assert.ok(Math.abs(part.x + part.width / 2 + part.translateX - expectedX) < 1e-10);
    assert.ok(Math.abs(part.y + part.height / 2 + part.translateY - expectedY) < 1e-10);
    assert.equal(part.opacity, state.opacity);
    const texture = { x: 0, y: 10, width: 640, height: 80 };
    const uv = spriteTileSourceRect(part, texture, 640, 360);
    assert.ok(Math.abs(uv[0] * texture.width + texture.x - part.x) < 1e-5);
    assert.ok(Math.abs(uv[2] * texture.width - part.width) < 1e-5);
  }
});

test('zero-duration character and word fills switch on the exact delay frame', () => {
  const timing = { delaySec: 15 / 30, durationSec: 0 };
  assert.equal(karaokeWordMixAt(timing, 14 / 30, 0), 0);
  assert.equal(karaokeWordMixAt(timing, 15 / 30, 0), 1);
  assert.equal(karaokeWordMixAt({ ...timing, durationSec: 1 }, 15 / 30, 0.4), 0.4);
  for (const [start, frame, delay] of [[4, 153, 1.1], [4, 183, 2.1], [20, 651, 1.7], [20, 657, 1.9]]) {
    const step = { delaySec: delay, durationSec: 0 };
    assert.equal(karaokeWordMixAt(step, (frame - 1) / 30 - start, 0), 0);
    assert.equal(karaokeWordMixAt(step, frame / 30 - start, 0), 1);
  }
  assert.equal(karaokeWordMixAt({ delaySec: 1.1, durationSec: 0 }, 1.1 - 0.5e-6, 0), 1);
  assert.equal(karaokeWordMixAt({ delaySec: 1.1, durationSec: 0 }, 1.1 - 1.5e-6, 0), 0);
  const smooth = { static: { x: 8, y: 20, width: 14, height: 24 },
    token: { rect: { x: 10, width: 10 } }, timing: { delaySec: 1.1, durationSec: 0 } };
  assert.ok(karaokeSmoothTilesAt(smooth, 152 / 30 - 4).every(tile => tile.mix === 0));
  assert.ok(karaokeSmoothTilesAt(smooth, 153 / 30 - 4).some(tile => tile.mix === 1));
});
