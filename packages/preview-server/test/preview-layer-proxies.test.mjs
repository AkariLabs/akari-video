// 不具合メモ 第15項（二人画面の追加映像で軽量版が使われず、末尾が約 3fps になる）の移植。
// 現場の単体テスト（.akari/work/keep/preview-proxy-fix/test.mjs、2026-09-18 実機適用）を
// リポの規約へ移し、リポ側の意味論（frameEngine.intake の鍵・キーフレームの既定値・
// 第10項の cuts 補償が既定 OFF・app.js の配線）を足した。
//
// 検査の柱:
//   1. 入力不変 — 編集・書き戻しに使うモデル（= edit.json）は 1 バイトも変わらない
//   2. 配置・倍率キーフレーム・時刻の維持 — 寸法比の補正だけが入る
//   3. マスク／画像／baked／intake は変更しない
//   4. proxy の寸法が読めない・縦横比が違うときは原本へフォールバック
//   5. 第10項の cuts crop/scale 補償は既定 OFF（明示 opt-in のときだけ働く）
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  applyCroppedCutScaleCompensation,
  croppedCutSourcePaths,
  preparePreviewLayerProxies,
} from '../public/preview-layer-proxies.mjs';

const ZOOM_SIZES = {
  'assets/zoom.mp4': { width: 1280, height: 720 },
  'cache/zoom-960.mp4': { width: 960, height: 540 },
  'assets/main.mp4': { width: 1920, height: 1080 },
  'cache/main-960.mp4': { width: 960, height: 540 },
};
const ZOOM_RATIO = 1280 / 960;
const MAIN_RATIO = 1920 / 960;

// 寸法の実測を差し替える。宣言に無い素材は「メタデータが読めない」として拒否する。
function sizeProvider(sizes = ZOOM_SIZES) {
  const asked = [];
  const getDimensions = (mediaPath) => {
    asked.push(mediaPath);
    return sizes[mediaPath]
      ? Promise.resolve(sizes[mediaPath])
      : Promise.reject(new Error(`no metadata: ${mediaPath}`));
  };
  return { getDimensions, asked };
}

function fixture() {
  return {
    sources: [
      { id: 'zoom', path: 'assets/zoom.mp4', proxy: 'cache/zoom-960.mp4' },
      { id: 'main', path: 'assets/main.mp4', proxy: 'cache/main-960.mp4' },
    ],
    cuts: [
      // crop 付き（第10項の暫定補償の対象）。ソースは layers[] からは参照されない。
      { id: 'c1', src: 'main', in: 0, out: 5, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, transform: { x: 12, scale: 1.5 } },
      // crop 無し（補償の対象外）。
      { id: 'c2', src: 'main', in: 5, out: 8, transform: { scale: 1.5 } },
    ],
    layers: [
      {
        id: 'r',
        kind: 'video',
        src: 'assets/zoom.mp4',
        t: 1,
        duration: 4,
        in: 2,
        transform: { x: 480, y: -60, scale: 1.5, rotate: 3 },
        crop: { x: 0.2, y: 0, w: 0.6, h: 1 },
        keyframes: [
          { t: 0, transform: { scale: 1.5 } },
          // transform は宣言するが scale を書いていない点（描画側は scale = 1 で埋める）。
          { t: 3, transform: { x: 200 }, easing: 'ease-in-out' },
          // transform を宣言しない点（crop だけ）は触らない。
          { t: 3.5, crop: { x: 0.25, y: 0, w: 0.6, h: 1 } },
        ],
      },
      { id: 'mask', kind: 'video', src: 'assets/zoom.mp4', mask: 'assets/zoom-mask.mp4', transform: { scale: 1.5 } },
      { id: 'logo', kind: 'image', src: 'logo.png', transform: { scale: 2 } },
      // id 無し（frameEngine.intake の鍵は src になる）。
      { kind: 'video', src: 'assets/zoom.mp4' },
      // baked は .preview.webm サイドカーで再生するため対象外。
      { id: 'baked', kind: 'baked', src: 'assets/zoom.mp4' },
    ],
  };
}

test('入力は変えず、再生用コピーの layers[] だけ proxy へ差し替える（edit.json は不変）', async () => {
  const edit = fixture();
  const before = JSON.stringify(edit);
  const { getDimensions } = sizeProvider();

  const playback = await preparePreviewLayerProxies(edit, { getDimensions });

  assert.equal(JSON.stringify(edit), before, '編集・書き戻しに使うモデルは変わらない');
  assert.notEqual(playback, edit, '差し替えがあるときは別オブジェクト');
  const layer = playback.layers[0];
  assert.equal(layer.src, 'cache/zoom-960.mp4');
  assert.equal(layer.transform.scale, 2, '1280 -> 960 の寸法差で 1.5 -> 2');
  assert.equal(layer.keyframes[0].transform.scale, 2);
  // 配置・時刻・crop・回転は維持する。
  assert.equal(layer.transform.x, 480);
  assert.equal(layer.transform.y, -60);
  assert.equal(layer.transform.rotate, 3);
  assert.deepEqual(layer.crop, { x: 0.2, y: 0, w: 0.6, h: 1 });
  assert.equal(layer.t, 1);
  assert.equal(layer.duration, 4);
  assert.equal(layer.in, 2);
  assert.equal(layer.keyframes[1].easing, 'ease-in-out');
});

test('transform を宣言して scale を書いていないキーフレーム点にも明示値を入れる（描画側の既定 1 に合わせる）', async () => {
  const { getDimensions } = sizeProvider();
  const playback = await preparePreviewLayerProxies(fixture(), { getDimensions });
  const keyframes = playback.layers[0].keyframes;

  // layer-keyframes-visual.js / frame-engine の layer-visual.ts は、transform を宣言する点の
  // 欠けた leaf を既定値（scale = 1）で埋める（静的 transform.scale へは落ちない）。補正を
  // 入れないとこの点だけ等倍のまま残り、再生中に構図が動く。
  assert.equal(keyframes[1].transform.scale, ZOOM_RATIO);
  assert.equal(keyframes[1].transform.x, 200, '書いてある leaf は動かさない');
  assert.equal(keyframes[2].transform, undefined, 'transform を宣言しない点は触らない');
  assert.deepEqual(keyframes[2].crop, { x: 0.25, y: 0, w: 0.6, h: 1 });
});

test('transform の無い layer には寸法比そのものを入れる（proxy の分だけ小さく描かれるのを防ぐ）', async () => {
  const edit = {
    sources: [{ id: 'zoom', path: 'assets/zoom.mp4', proxy: 'cache/zoom-960.mp4' }],
    layers: [{ id: 'plain', kind: 'video', src: 'assets/zoom.mp4' }],
  };
  const { getDimensions } = sizeProvider();

  const playback = await preparePreviewLayerProxies(edit, { getDimensions });

  assert.equal(playback.layers[0].src, 'cache/zoom-960.mp4');
  assert.equal(playback.layers[0].transform.scale, ZOOM_RATIO);
});

test('マスク付き映像・画像・baked は差し替えない', async () => {
  const { getDimensions } = sizeProvider();
  const playback = await preparePreviewLayerProxies(fixture(), { getDimensions });

  assert.equal(playback.layers[1].src, 'assets/zoom.mp4', 'マスク付きは対象外');
  assert.equal(playback.layers[1].transform.scale, 1.5);
  assert.equal(playback.layers[2].src, 'logo.png', '画像は対象外');
  assert.equal(playback.layers[2].transform.scale, 2);
  assert.equal(playback.layers[4].src, 'assets/zoom.mp4', 'baked（.preview.webm）は対象外');
});

test('frameEngine.intake の変換済み素材は差し替えない（id 無し layer の鍵は src）', async () => {
  const edit = fixture();
  edit.frameEngine = { intake: { 'assets/zoom.mp4': { src: 'work/intake/zoom.webm' } } };
  const { getDimensions } = sizeProvider();

  const playback = await preparePreviewLayerProxies(edit, { getDimensions });

  assert.equal(playback.layers[3].src, 'assets/zoom.mp4', 'src が intake の鍵になる layer は対象外');
  assert.equal(playback.layers[0].src, 'cache/zoom-960.mp4', 'id を持つ layer は intake 対象ではない');
});

test('proxy の寸法が読めないときは原本のまま（受け取ったモデルをそのまま返す）', async () => {
  const edit = fixture();
  const failing = () => Promise.reject(new Error('missing'));

  assert.equal(await preparePreviewLayerProxies(edit, { getDimensions: failing }), edit);
});

test('縦横比の違う proxy は使わない', async () => {
  const edit = fixture();
  const { getDimensions } = sizeProvider({
    ...ZOOM_SIZES,
    'cache/zoom-960.mp4': { width: 960, height: 960 },
  });

  assert.equal(await preparePreviewLayerProxies(edit, { getDimensions }), edit);
});

test('proxy 宣言が無い／原本と同じときは寸法を測りにも行かない', async () => {
  const noProxy = {
    sources: [{ id: 'zoom', path: 'assets/zoom.mp4', proxy: null }],
    layers: [{ id: 'r', kind: 'video', src: 'assets/zoom.mp4', transform: { scale: 1.5 } }],
  };
  const samePath = {
    sources: [{ id: 'zoom', path: 'assets/zoom.mp4', proxy: 'assets/zoom.mp4' }],
    layers: [{ id: 'r', kind: 'video', src: 'assets/zoom.mp4', transform: { scale: 1.5 } }],
  };
  const first = sizeProvider();
  const second = sizeProvider();

  assert.equal(await preparePreviewLayerProxies(noProxy, { getDimensions: first.getDimensions }), noProxy);
  assert.equal(await preparePreviewLayerProxies(samePath, { getDimensions: second.getDimensions }), samePath);
  assert.deepEqual(first.asked, []);
  assert.deepEqual(second.asked, []);
});

test('第10項の cuts crop/scale 補償は既定 OFF（cut の倍率も、cut 専用ソースの実測も触らない）', async () => {
  const edit = fixture();
  const { getDimensions, asked } = sizeProvider();

  const playback = await preparePreviewLayerProxies(edit, { getDimensions });

  assert.equal(playback.cuts[0].transform.scale, 1.5, 'crop 付き cut の倍率は素のまま');
  assert.equal(playback.cuts[1].transform.scale, 1.5);
  assert.deepEqual(playback.cuts[0].crop, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  assert.deepEqual(
    asked.filter((mediaPath) => mediaPath.includes('main')),
    [],
    'cuts 専用ソースの寸法は測らない',
  );
  // 補償対象の洗い出し自体は出せる（opt-in したときだけ使う）。
  assert.deepEqual(croppedCutSourcePaths(edit), ['assets/main.mp4']);
});

test('compensateCroppedCuts: true のときだけ crop 付き cut の倍率を補正する', async () => {
  const edit = fixture();
  const before = JSON.stringify(edit);
  const { getDimensions } = sizeProvider();

  const playback = await preparePreviewLayerProxies(edit, { getDimensions, compensateCroppedCuts: true });

  assert.equal(JSON.stringify(edit), before, 'opt-in でも入力は不変');
  assert.equal(playback.cuts[0].transform.scale, 1.5 * MAIN_RATIO, 'crop 付きだけ寸法比を掛ける');
  assert.equal(playback.cuts[0].transform.x, 12, '配置は維持する');
  assert.equal(playback.cuts[1].transform.scale, 1.5, 'crop 無しは対象外');
  assert.equal(playback.cuts[0].src, 'main', 'cut の参照（src）は差し替えない');
  assert.equal(playback.layers[0].src, 'cache/zoom-960.mp4', 'layers[] の解決は同時に働く');
});

test('applyCroppedCutScaleCompensation は crop 付き cut の倍率キーフレームも補正する', () => {
  const playbackEdit = {
    sources: [{ id: 'main', path: 'assets/main.mp4', proxy: 'cache/main-960.mp4' }],
    cuts: [{
      id: 'c1',
      src: 'main',
      crop: { x: 0, y: 0, w: 0.5, h: 0.5 },
      keyframes: [{ t: 0, transform: { scale: 1.5 } }, { t: 2, transform: { x: 40 } }],
    }],
  };

  applyCroppedCutScaleCompensation(playbackEdit, new Map([
    ['assets/main.mp4', { path: 'cache/main-960.mp4', ratio: MAIN_RATIO }],
  ]));

  assert.equal(playbackEdit.cuts[0].keyframes[0].transform.scale, 1.5 * MAIN_RATIO);
  assert.equal(playbackEdit.cuts[0].keyframes[1].transform.scale, MAIN_RATIO);
  assert.equal(playbackEdit.cuts[0].keyframes[1].transform.x, 40);
});

test('app.js の配線: 初期化と再構築の両方が再生用コピーを渡し、書き戻しは素の summary を使う', async () => {
  const app = await readFile(path.resolve(import.meta.dirname, '..', 'public/app.js'), 'utf8');

  assert.match(app, /import \{ preparePreviewLayerProxies \} from '\/preview-layer-proxies\.mjs';/u);
  assert.match(app, /const playbackEdit = await preparePreviewLayerProxies\(summary, previewLayerProxyOptions\);/u);
  assert.match(app, /createFrameEnginePreview\(\{ edit: playbackEdit, timelineData, stage: previewStage, fps \}\)/u);
  assert.match(
    app,
    /frameEnginePreview\.rebuild\(await preparePreviewLayerProxies\(summary, previewLayerProxyOptions\), timelineData, fps\)/u,
  );
  assert.equal((app.match(/preparePreviewLayerProxies\(summary, /gu) ?? []).length, 2, '初期化と再構築の 2 箇所');
  // 第10項の補償は URL で明示 opt-in したときだけ入る（既定 OFF）。
  assert.match(app, /compensateCroppedCuts: new URLSearchParams\(location\.search\)\.get\('cutCropProxyCompensation'\) === '1'/u);
  // 書き戻し・状態公開は素の summary のまま（playbackEdit を渡さない）。
  assert.match(app, /window\.akari\.state = \{ editPath: 'edit\.json', summary \}/u);
  assert.doesNotMatch(app, /editForPut\(playbackEdit/u);
});
