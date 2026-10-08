import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { renderOverlaySheet } from '../src/rasterize.mjs';
import { extractGlassSceneAssetReferences, enumerateDeclaredRenderInputs } from '../src/render-inputs.mjs';

const scene = (value) => `<script type="application/json" data-akari-glass-scene>${JSON.stringify(value)}</script>`;
const input = (html, projectRoot = '/tmp/project') => ({ overlays: [{ id: 'o1', html, htmlPath: 'pack/variants/press.html', start: 2, duration: 3 }], edit: { output: { width: 320, height: 180, fps: 30 } }, projectRoot, duration: 5 });
const sha = (text) => createHash('sha256').update(text).digest('hex');

test('glass-free 2D and 3D sheets match pre-glass baseline bytes', () => {
  for (const [html, expected] of [
    // 885fc54d の入力。2843f6227 で疑似要素アニメを WAAPI クローンへ引き継ぐ共通スクリプトが変わった。
    ['<div>Hello</div>', '4621809f07fcb9206030c8485239bb089d7791936d0bc050a55a4dbe3ce08461'],
    // #111 の c75acd725 で採った値。00e32ae9c（ab3ee4330 で合流）のプレビュー再読込と
    // 0d8bf36f1 の描画先 canvas 選択が埋め込み three-runtime.js を変えた。
    ['<div><canvas></canvas><script type="application/json" data-akari-3d-scene>{"texts":[{"id":"t","text":"A"}]}</script></div>', '682e968cb3e52b0f7174c31619e5c3ee225eb433a95f95ea4965f70d66022f4a'],
  ]) assert.equal(sha(renderOverlaySheet(input(html))), expected);
});

test('comments and ordinary text cannot inject glass runtime', () => {
  const sheet = renderOverlaySheet(input(`<div>data-akari-glass-scene</div><!--${scene({ backdrop: 'missing.png' })}-->`));
  assert.doesNotMatch(sheet, /window.akari.glassRuntime/);
});

test('backdrops bind relative to variants, are hashed inputs and safely embedded', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'akari-glass-input-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'pack/variants'), { recursive: true });
  mkdirSync(join(root, 'pack/backgrounds'));
  writeFileSync(join(root, 'pack/backgrounds/bg.png'), 'image');
  const comment = `<!--${scene({ backdrop: 'not-present.png' })}-->`;
  const html = `<div data-akari-glass>${comment}${scene({ backdrop: '../backgrounds/bg.png', label: '<safe>' })}</div>`;
  writeFileSync(join(root, 'pack/variants/press.html'), html);
  const edit = { overlays: [{ id: 'o1', html: 'pack/variants/press.html' }] };
  writeFileSync(join(root, 'edit.json'), JSON.stringify(edit));
  const inputs = await enumerateDeclaredRenderInputs({ projectRoot: root, edit });
  assert.ok(inputs.some((entry) => entry.role === 'overlay:o1:glass-backdrop'));
  const sheet = renderOverlaySheet(input(html, root));
  assert.ok(sheet.includes(comment));
  assert.match(sheet, /data:image\/png;base64,aW1hZ2U=/);
  assert.match(sheet, /\\u003csafe>/);
  for (const match of sheet.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  assert.ok(sheet.indexOf('await window.__akariSeekVideos(seconds)') < sheet.indexOf('for (const [glassContainer'));
});

test('invalid glass descriptors and remote paths fail input enumeration', () => {
  for (const value of [[], null, { backdrop: 'https://example.com/a.png' }, { backdrop: 'data:image/png;base64,AA==' }, { backdrop: 4 }]) {
    assert.throws(() => extractGlassSceneAssetReferences(scene(value)));
  }
  assert.deepEqual(extractGlassSceneAssetReferences(scene({ backdrop: '../backgrounds/a.png' }), 'pack/variants/a.html'), [{ role: 'glass-backdrop', path: 'pack/backgrounds/a.png' }]);
});

test('glass ready pump polls loading at 10ms and exits on ready/error', async () => {
  const sheet = renderOverlaySheet(input(`<div data-akari-glass>${scene({})}</div>`));
  const source = sheet.slice(sheet.indexOf('    async function waitForGlassContainer'), sheet.indexOf('    window.__akariReady'));
  for (const end of ['ready', 'error']) {
    const states = ['loading', 'loading', end];
    const delays = [], errors = [];
    const context = vm.createContext({
      window: { akari: { glassRuntime: { inspect: () => ({ status: states.shift() }) } } },
      console: { error: (...args) => errors.push(args) },
      setTimeout: (fn, ms) => { delays.push(ms); fn(); },
    });
    vm.runInContext(source, context);
    await vm.runInContext('waitForGlassContainer({})', context);
    assert.deepEqual(delays, [10,10]);
    assert.equal(errors.length, end === 'error' ? 1 : 0);
  }
});
