// 不具合メモ 第15項（二人画面の追加映像で軽量版が使われず、末尾が約 3fps になる）の移植。
// 現場の単体テスト（.akari/work/keep/preview-proxy-fix/test.mjs、2026-09-18 実機適用）を
// リポの規約へ移し、リポ側の意味論（frameEngine.intake の鍵・app.js の配線）を足した。
//
// 2026-09-18 第10項の根本修正（frame-engine の compositionSourceSize / NativeFrameSource.
// logicalSize）に合わせて改訂。構図の基準は **原本の論理寸法** で、プレビューはそれを
// frame-engine-client.ts から宣言する。したがってこのモジュールは倍率を触らない（触ると宣言と
// 二重に効く）。旧版が検査していた「寸法比を transform.scale と倍率キーフレームへ掛ける」は
// 意図ごと反転し、「掛けないこと」を検査する。
//
// 検査の柱:
//   1. 入力不変 — 編集・書き戻しに使うモデル（= edit.json）は 1 バイトも変わらない
//   2. 差し替えるのは src と `sources[].logicalSize`（原本の実測 = 構図の基準）だけ —
//      配置・倍率・倍率キーフレーム・crop・時刻は素のまま（二重補正なし）
//   3. proxy の解像度を変えても構図が変わらない（宣言は常に原本の寸法）
//   4. マスク／画像／baked／intake は変更しない
//   5. proxy の寸法が読めない・縦横比が違うときは原本へフォールバック
//   6. 第10項の暫定補償（cuts への寸法比乗算・?cutCropProxyCompensation）が残っていない
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import * as layerProxies from '../public/preview-layer-proxies.mjs';
import { preparePreviewLayerProxies } from '../public/preview-layer-proxies.mjs';

const ZOOM_SIZES = {
  'assets/zoom.mp4': { width: 1280, height: 720 },
  'cache/zoom-960.mp4': { width: 960, height: 540 },
  'assets/main.mp4': { width: 1920, height: 1080 },
  'cache/main-960.mp4': { width: 960, height: 540 },
};

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
      // crop 付き（旧・第10項の暫定補償の対象だった）。ソースは layers[] からは参照されない。
      { id: 'c1', src: 'main', in: 0, out: 5, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, transform: { x: 12, scale: 1.5 } },
      // crop 無し。
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
          // transform を宣言しない点（crop だけ）。
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

test('入力は変えず、再生用コピーの layers[].src だけ proxy へ差し替える（edit.json は不変）', async () => {
  const edit = fixture();
  const before = JSON.stringify(edit);
  const { getDimensions } = sizeProvider();

  const playback = await preparePreviewLayerProxies(edit, { getDimensions });

  assert.equal(JSON.stringify(edit), before, '編集・書き戻しに使うモデルは変わらない');
  assert.notEqual(playback, edit, '差し替えがあるときは別オブジェクト');
  const layer = playback.layers[0];
  assert.equal(layer.src, 'cache/zoom-960.mp4');
  // 構図の基準は原本の実測寸法。これを宣言するので倍率は補正しない。
  assert.deepEqual(playback.sources[0].logicalSize, { width: 1280, height: 720 });
  assert.equal(playback.sources[1].logicalSize, undefined, '差し替えないソースには宣言を足さない');
  // 第10項の根本修正後: 構図の基準は原本の論理寸法（frame-engine-client.ts が宣言）なので、
  // ここで寸法比を掛けてはいけない（掛けると二重補正 = 半解像度 proxy で構図が 2 倍になる）。
  assert.equal(layer.transform.scale, 1.5, '倍率は素のまま（寸法比を掛けない）');
  assert.equal(layer.keyframes[0].transform.scale, 1.5, '倍率キーフレームも素のまま');
  // 配置・時刻・crop・回転も維持する。
  assert.equal(layer.transform.x, 480);
  assert.equal(layer.transform.y, -60);
  assert.equal(layer.transform.rotate, 3);
  assert.deepEqual(layer.crop, { x: 0.2, y: 0, w: 0.6, h: 1 });
  assert.equal(layer.t, 1);
  assert.equal(layer.duration, 4);
  assert.equal(layer.in, 2);
  assert.equal(layer.keyframes[1].easing, 'ease-in-out');
});

test('倍率キーフレームには明示値を入れない（描画側の既定 1 のまま = 補正しない）', async () => {
  const { getDimensions } = sizeProvider();
  const playback = await preparePreviewLayerProxies(fixture(), { getDimensions });
  const keyframes = playback.layers[0].keyframes;

  // 旧版は「transform を宣言して scale を書いていない点」へ寸法比を書き込んでいた（描画側が
  // 欠けた leaf を scale = 1 で埋めるため、補正を揃える必要があった）。宣言基準に移った今は
  // 補正そのものが無いので、書いていない leaf は書いていないままでなければならない。
  assert.equal(keyframes[1].transform.scale, undefined, '書いていない leaf は増やさない');
  assert.equal(keyframes[1].transform.x, 200, '書いてある leaf は動かさない');
  assert.equal(keyframes[2].transform, undefined, 'transform を宣言しない点は触らない');
  assert.deepEqual(keyframes[2].crop, { x: 0.25, y: 0, w: 0.6, h: 1 });
});

test('transform の無い layer に transform を生やさない（src と宣言だけ）', async () => {
  const edit = {
    sources: [{ id: 'zoom', path: 'assets/zoom.mp4', proxy: 'cache/zoom-960.mp4' }],
    layers: [{ id: 'plain', kind: 'video', src: 'assets/zoom.mp4' }],
  };
  const { getDimensions } = sizeProvider();

  const playback = await preparePreviewLayerProxies(edit, { getDimensions });

  assert.equal(playback.layers[0].src, 'cache/zoom-960.mp4');
  assert.equal(playback.layers[0].transform, undefined);
  assert.deepEqual(playback.sources[0].logicalSize, { width: 1280, height: 720 });
});

// 課題A の契約テスト: 宣言基準（NativeFrameSource.logicalSize）のもとでは、proxy の解像度は
// 構図に一切漏れてはいけない。半解像度・1/4 解像度・等倍で再生用コピーを作り、src 以外が
// 完全に一致することを検査する（倍率補償が残っていれば ratio が違うので必ず落ちる）。
test('proxy の解像度を変えても構図が変わらない（src だけが違う）', async () => {
  const geometryOf = (playback) => JSON.parse(JSON.stringify(
    playback.layers.map(({ src: _src, ...rest }) => rest),
  ));
  const editFor = (proxyPath) => ({
    ...fixture(),
    sources: [
      { id: 'zoom', path: 'assets/zoom.mp4', proxy: proxyPath },
      { id: 'main', path: 'assets/main.mp4', proxy: 'cache/main-960.mp4' },
    ],
  });
  const sizes = {
    ...ZOOM_SIZES,
    'cache/zoom-640.mp4': { width: 640, height: 360 },
    'cache/zoom-1280.mp4': { width: 1280, height: 720 },
  };

  const results = [];
  for (const proxyPath of ['cache/zoom-960.mp4', 'cache/zoom-640.mp4', 'cache/zoom-1280.mp4']) {
    const { getDimensions } = sizeProvider(sizes);
    const playback = await preparePreviewLayerProxies(editFor(proxyPath), { getDimensions });
    assert.equal(playback.layers[0].src, proxyPath, '解決先は宣言どおりの proxy');
    // 宣言は proxy の解像度に依らず常に原本の寸法。
    assert.deepEqual(playback.sources[0].logicalSize, { width: 1280, height: 720 },
      `${proxyPath}: 宣言が proxy の寸法に引きずられている`);
    results.push({ proxyPath, geometry: geometryOf(playback), cuts: playback.cuts });
  }

  for (const result of results.slice(1)) {
    assert.deepEqual(result.geometry, results[0].geometry,
      `proxy の解像度（${result.proxyPath}）が構図へ漏れている = 二重補正`);
    assert.deepEqual(result.cuts, results[0].cuts, 'cuts も proxy 解像度に依存しない');
  }
  // 素の宣言値そのままであることも直接押さえる（3 本そろって同じ値に「補正」されていないこと）。
  assert.equal(results[0].geometry[0].transform.scale, 1.5);
  assert.equal(results[0].geometry[0].keyframes[0].transform.scale, 1.5);
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

test('縦横比の違う proxy は使わない（原本の論理寸法で決まる箱に収まらない）', async () => {
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

test('cuts は一切触らず、cuts 専用ソースの寸法も測らない・宣言もしない', async () => {
  const edit = fixture();
  const cutsBefore = JSON.stringify(edit.cuts);
  const { getDimensions, asked } = sizeProvider();

  const playback = await preparePreviewLayerProxies(edit, { getDimensions });

  assert.equal(JSON.stringify(playback.cuts), cutsBefore, '本編カットは素のまま');
  assert.deepEqual(
    asked.filter((mediaPath) => mediaPath.includes('main')),
    [],
    'cuts 専用ソースの寸法は測らない',
  );
  // 本編 cut のソースへ宣言を広げない。編集 UI も宣言済み proxy を見て倍率を焼くため、
  // そちらを原本基準へ移すのは保存側の修正と同じ作業単位でなければならない
  // （従来の暫定補償 compensateCroppedCuts が既定 OFF だったのと同じ理由）。
  assert.equal(playback.sources[1].logicalSize, undefined);
});

test('第10項の暫定補償（cuts への寸法比乗算）は実装ごと削除されている', async () => {
  // 旧版の opt-in（croppedCutSourcePaths / applyCroppedCutScaleCompensation /
  // options.compensateCroppedCuts / app.js の ?cutCropProxyCompensation）は、宣言基準への移行で
  // 二重補正そのものになったため残してはいけない。
  assert.equal(layerProxies.croppedCutSourcePaths, undefined);
  assert.equal(layerProxies.applyCroppedCutScaleCompensation, undefined);

  const source = await readFile(
    path.resolve(import.meta.dirname, '..', 'public/preview-layer-proxies.mjs'), 'utf8');
  assert.doesNotMatch(source, /compensateCroppedCuts/u);
  assert.doesNotMatch(source, /transform\.scale\s*=/u, '倍率へ書き戻す経路が残っていない');
  assert.doesNotMatch(source, /scale:\s*scaled/u);

  // opt-in が効かないこと（未知のオプションを渡しても倍率は動かない）。
  const { getDimensions } = sizeProvider();
  const playback = await preparePreviewLayerProxies(fixture(), {
    getDimensions, compensateCroppedCuts: true,
  });
  assert.equal(playback.cuts[0].transform.scale, 1.5);
  assert.equal(playback.layers[0].transform.scale, 1.5);
});

test('app.js の配線: 初期化と再構築の両方が再生用コピーを渡し、書き戻しは素の summary を使う', async () => {
  const app = await readFile(path.resolve(import.meta.dirname, '..', 'public/app.js'), 'utf8');

  assert.match(app, /import \{ preparePreviewLayerProxies \} from '\/preview-layer-proxies\.mjs';/u);
  assert.match(app, /const playbackEdit = await preparePreviewLayerProxies\(summary\);/u);
  assert.match(app, /createFrameEnginePreview\(\{ edit: playbackEdit, timelineData, stage: previewStage, fps \}\)/u);
  assert.match(
    app,
    /frameEnginePreview\.rebuild\(await preparePreviewLayerProxies\(summary\), timelineData, fps\)/u,
  );
  assert.equal((app.match(/preparePreviewLayerProxies\(summary\)/gu) ?? []).length, 2, '初期化と再構築の 2 箇所');
  // 第10項の暫定補償の配線は残っていない（宣言基準へ移行したので二重補正になる）。
  assert.doesNotMatch(app, /cutCropProxyCompensation/u);
  assert.doesNotMatch(app, /previewLayerProxyOptions/u);
  // 書き戻し・状態公開は素の summary のまま（playbackEdit を渡さない）。
  assert.match(app, /window\.akari\.state = \{ editPath: 'edit\.json', summary \}/u);
  assert.doesNotMatch(app, /editForPut\(playbackEdit/u);
});
