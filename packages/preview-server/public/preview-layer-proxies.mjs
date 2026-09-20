// 不具合メモ 第15項（2026-09-18 実機計測）: 本編 cut は edit-to-timeline が `sources[].proxy` を
// `clips[].src` へ射影するので軽量版で再生されるが、`layers[].src` は宣言のまま原本を指していた。
// 88 分素材の末尾 5280 秒では、二人目の Zoom 映像（1280x720 の原本）を足すと 3fps まで落ち、
// その 1 本を外すと 30〜31fps に戻る（文字・ロゴを外しても 4fps のままだった）。
//
// ここでは **再生用のコピーにだけ** 宣言済み proxy を反映する。編集・書き戻し（editForPut →
// PUT /api/edit.json）へ渡すモデルは触らない（`structuredClone`）ので edit.json は一切変わらない。
// 原本参照と書き出し品質も変えない（書き出しは原本のまま）。
//
// **倍率は一切触らない。代わりに原本の論理寸法を宣言する（第10項の根本修正が入ったあとの規律）**:
// `layers[].transform.scale` は「crop × ソースの**論理寸法** × scale」で出力画素の窓を決める。
// 論理寸法 = 原本の表示回転後の画素寸法であり、復号したフレームの寸法ではない
// （frame-engine の `NativeFrameSource.logicalSize` / `compositionSourceSize`）。
// ここでは proxy へ差し替えるソースについて、**測った原本の寸法**を再生用コピーの
// `sources[].logicalSize` へ載せる。`src/frame-engine-client.ts` がそれを
// `NativeFrameSource.logicalSize` として宣言するので、**proxy の解像度は構図に漏れない**。
// 宣言があるぶん、原本 / proxy の寸法比を倍率へ掛けてはいけない（宣言と二重に効き、半解像度
// proxy なら構図が 2 倍に膨らむ）。逆に宣言を外して補正だけ戻すと 1/2 倍にずれる。
// **宣言と補償は同一の作業単位で動かすこと。**
//
// 宣言を載せるのは「編集時に見えていた寸法（= 保存側が焼いた transform.scale の基準）が原本で、
// プレビューだけが軽量版を復号する」ここ（layers[]）と自動 proxy（frame-engine-client.ts が
// 原本の probe から宣言する）に限る。宣言済み proxy を使う**本編 cut** は、編集 UI も同じ
// 軽量版を見て倍率を焼くため対象外 — そちらへ宣言を広げるのは保存側を原本基準へ直すのと
// 同じ作業単位でなければならない（crop 付き cut へ寸法比を掛ける旧・暫定補償が既定 OFF
// だったのと同じ理由。2026-09-18 時点の保存側はまだ proxy 寸法基準）。
//
// 適用しないもの: proxy 宣言の無いソース、実測寸法が読めない proxy、縦横比の違う proxy
// （いずれも原本のまま = 従来動作）、マスク付き映像、`frameEngine.intake` の変換済み特殊素材、
// `kind: 'baked'`（`.preview.webm` サイドカー再生）と画像レイヤー。

const METADATA_TIMEOUT_MS = 8000;
// 縦横比の一致判定。proxy 規格（contract-2026-08-02-preview-parity.md §5.5）は等比で寸法を落とすので、
// 偶数丸め 1px 程度のずれだけ許す。それを超える proxy は、原本の論理寸法で決まる箱へ別の縦横比の
// フレームを流し込むことになり見た目が歪むため、原本のまま再生する。
const ASPECT_EPSILON = 0.002;

const dimensionsByUrl = new Map();

const normalizedPath = (value) => String(value ?? '').replace(/\\/g, '/');

// frame-engine-client.ts の mediaUrl と同じ規則（プレビューが実際に読む URL を測るため）。
function mediaUrl(value) {
  const source = normalizedPath(value);
  if (/^(https?:|blob:|\/)/u.test(source)) return source;
  return `/${source.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
}

// <video> のメタデータから実測寸法（coded 寸法ではなく表示寸法）を読む。同じ URL は 1 回だけ測り、
// 失敗は覚えない（proxy 生成の完了後に測り直せるようにする）。
function mediaDimensions(path) {
  const url = new URL(mediaUrl(path), document.baseURI).href;
  if (!dimensionsByUrl.has(url)) {
    const pending = new Promise((resolve, reject) => {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.muted = true;
      const timer = setTimeout(() => finish(new Error('メタデータが時間内に読めませんでした')), METADATA_TIMEOUT_MS);
      function finish(error) {
        clearTimeout(timer);
        probe.onloadedmetadata = null;
        probe.onerror = null;
        const size = { width: Number(probe.videoWidth) || 0, height: Number(probe.videoHeight) || 0 };
        probe.removeAttribute('src');
        probe.load();
        if (error || !size.width || !size.height) reject(error || new Error('寸法が読めませんでした'));
        else resolve(size);
      }
      probe.onloadedmetadata = () => finish();
      probe.onerror = () => finish(new Error('メタデータを読めませんでした'));
      probe.src = url;
    });
    dimensionsByUrl.set(url, pending);
    pending.catch(() => dimensionsByUrl.delete(url));
  }
  return dimensionsByUrl.get(url);
}

// frame-engine-client.ts の resolvedEngineLayers と同じ鍵（id が無ければ src、それも無ければ添字）で
// `frameEngine.intake` を引く。鍵が src の layer で src を差し替えると intake の引き当てが外れて
// 変換済み素材が失われるため、鍵の作り方はここでも合わせる。
function intakeKeyOf(layer, index) {
  return String(layer?.id ?? layer?.src ?? index);
}

function isProxyEligibleLayer(edit, layer, index) {
  if (layer?.kind !== 'video') return false;
  if (typeof layer.src !== 'string' || !layer.src) return false;
  if (layer.mask) return false;
  return !edit?.frameEngine?.intake?.[intakeKeyOf(layer, index)];
}

/**
 * 宣言済み proxy を **再生用のコピー** へ反映した edit を返す。差し替える対象が無ければ
 * 受け取った `edit` をそのまま返す（従来動作・余計なコピーを作らない）。
 *
 * 触るのは `layers[].src`（proxy へ差し替え）と、差し替えたソースの
 * `sources[].logicalSize`（測った**原本**の寸法 = 構図の基準）だけ。
 * `transform` / `keyframes` / `crop` / `perspective` は 1 バイトも触らない（上のヘッダ注記参照）。
 *
 * @param {object} edit 編集・書き戻しに使うモデル。**変更しない**。
 * @param {object} [options]
 * @param {(path: string) => Promise<{width: number, height: number}>} [options.getDimensions]
 *   実測寸法の取得（既定は `<video>` のメタデータ = 回転適用後の表示寸法 = 論理寸法。
 *   テストでは差し替える）。原本側は構図の基準としてそのまま宣言し、proxy 側は
 *   **使えるかどうかの判定にだけ** 使う（倍率補正には使わない）。
 */
export async function preparePreviewLayerProxies(edit, options = {}) {
  const { getDimensions = mediaDimensions } = options;
  const declarations = new Map((Array.isArray(edit?.sources) ? edit.sources : [])
    .filter((source) => typeof source?.path === 'string' && typeof source?.proxy === 'string' && source.proxy)
    .map((source) => [normalizedPath(source.path), source]));
  const needed = new Set((Array.isArray(edit?.layers) ? edit.layers : [])
    .filter((layer, index) => isProxyEligibleLayer(edit, layer, index))
    .map((layer) => normalizedPath(layer.src)));

  const replacements = new Map();
  await Promise.all([...needed].map(async (sourcePath) => {
    const source = declarations.get(sourcePath);
    if (!source || normalizedPath(source.path) === normalizedPath(source.proxy)) return;
    try {
      const [original, proxy] = await Promise.all([
        getDimensions(source.path),
        getDimensions(source.proxy),
      ]);
      const ratio = original.width / proxy.width;
      // 縦横比の違う proxy は原本の論理寸法で決まる箱に収まらない。測れない proxy（生成途中・
      // 壊れたファイル）も使わない（どちらも原本のまま = 従来動作）。
      if (!(ratio > 0) || !Number.isFinite(ratio)
        || Math.abs(ratio / (original.height / proxy.height) - 1) > ASPECT_EPSILON) return;
      replacements.set(sourcePath, {
        path: source.proxy,
        // 構図の基準（= 原本の論理寸法）。これを宣言するので倍率は一切補正しない。
        logicalSize: { width: original.width, height: original.height },
      });
    } catch (error) {
      console.warn('[preview] proxy の寸法が読めないため原本のまま再生します', source.path, String(error));
    }
  }));
  if (replacements.size === 0) return edit;

  const playback = structuredClone(edit);
  for (const source of Array.isArray(playback.sources) ? playback.sources : []) {
    const replacement = replacements.get(normalizedPath(source?.path));
    if (replacement) source.logicalSize = replacement.logicalSize;
  }
  const layers = Array.isArray(playback.layers) ? playback.layers : [];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const replacement = replacements.get(normalizedPath(layer?.src));
    if (!replacement || !isProxyEligibleLayer(playback, layer, index)) continue;
    layer.src = replacement.path;
  }
  return playback;
}
