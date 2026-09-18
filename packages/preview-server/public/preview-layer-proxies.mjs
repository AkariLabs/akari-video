// 不具合メモ 第15項（2026-09-18 実機計測）: 本編 cut は edit-to-timeline が `sources[].proxy` を
// `clips[].src` へ射影するので軽量版で再生されるが、`layers[].src` は宣言のまま原本を指していた。
// 88 分素材の末尾 5280 秒では、二人目の Zoom 映像（1280x720 の原本）を足すと 3fps まで落ち、
// その 1 本を外すと 30〜31fps に戻る（文字・ロゴを外しても 4fps のままだった）。
//
// ここでは **再生用のコピーにだけ** 宣言済み proxy を反映する。編集・書き戻し（editForPut →
// PUT /api/edit.json）へ渡すモデルは触らない（`structuredClone`）ので edit.json は一切変わらない。
// 原本参照と書き出し品質も変えない（書き出しは原本のまま）。
//
// `layers[].transform.scale` はソース実寸 px 基準（applyLayerLayout の
// `width/height = videoWidth/Height x scale`。contract-2026-08-02-preview-parity.md §2.4.1）
// なので、差し替えるだけでは proxy の寸法比ぶん小さく描かれる。原本と proxy の **実測** 寸法を
// 比べ、静的倍率と倍率キーフレームの両方を補正する（今回の Zoom は 1280 → 960 で 1.5 → 2）。
// crop（正規化）・x/y（出力 px）・rotate・perspective（正規化コーナー）は寸法に依らないため触らない。
//
// 適用しないもの: proxy 宣言の無いソース、実測寸法が読めない proxy、縦横比の違う proxy
// （いずれも原本のまま = 従来動作）、マスク付き映像、`frameEngine.intake` の変換済み特殊素材、
// `kind: 'baked'`（`.preview.webm` サイドカー再生）と画像レイヤー。

const METADATA_TIMEOUT_MS = 8000;
// 縦横比の一致判定。proxy 規格（contract-2026-08-02-preview-parity.md §5.5）は等比で寸法を落とすので、
// 偶数丸め 1px 程度のずれだけ許し、それを超える差は一様倍率で再現できないため原本へ落とす。
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

// 倍率の基準は「描画側が実際に使う値」に合わせる。layer-keyframes-visual.js と frame-engine の
// timeline/layer-visual.ts はどちらも有限かつ正でない scale を 1 として扱う。
function scaledScale(declared, ratio) {
  const base = Number.isFinite(declared) && declared > 0 ? declared : 1;
  return base * ratio;
}

function scaledBy(transform, ratio) {
  return { ...transform, scale: scaledScale(transform?.scale, ratio) };
}

function scaleKeyframesInPlace(item, ratio) {
  for (const point of Array.isArray(item?.keyframes) ? item.keyframes : []) {
    // transform を宣言する点は、書いていない leaf を **既定値**（scale = 1）で埋められる
    // （layer-keyframes-visual.js / frame-engine の layer-visual.ts。静的 transform.scale へは
    // 落ちない）。そのため scale を書いていない宣言点にも明示値を入れないと点ごとに補正が
    // 揃わず、再生中に構図が動いてしまう。
    if (!point || typeof point !== 'object') continue;
    if (!point.transform || typeof point.transform !== 'object') continue;
    point.transform.scale = scaledScale(point.transform.scale, ratio);
  }
}

/**
 * 宣言済み proxy を **再生用のコピー** へ反映した edit を返す。差し替える対象が無ければ
 * 受け取った `edit` をそのまま返す（従来動作・余計なコピーを作らない）。
 *
 * @param {object} edit 編集・書き戻しに使うモデル。**変更しない**。
 * @param {object} [options]
 * @param {(path: string) => Promise<{width: number, height: number}>} [options.getDimensions]
 *   実測寸法の取得（既定は `<video>` のメタデータ。テストでは差し替える）。
 * @param {boolean} [options.compensateCroppedCuts] 第10項の暫定補償（既定 OFF。下記ブロック参照）。
 */
export async function preparePreviewLayerProxies(edit, options = {}) {
  const { getDimensions = mediaDimensions, compensateCroppedCuts = false } = options;
  const declarations = new Map((Array.isArray(edit?.sources) ? edit.sources : [])
    .filter((source) => typeof source?.path === 'string' && typeof source?.proxy === 'string' && source.proxy)
    .map((source) => [normalizedPath(source.path), source]));
  const needed = new Set((Array.isArray(edit?.layers) ? edit.layers : [])
    .filter((layer, index) => isProxyEligibleLayer(edit, layer, index))
    .map((layer) => normalizedPath(layer.src)));
  // 第10項の暫定補償（既定 OFF・後で外す）: crop 付き cut のソースも寸法比を測る。
  if (compensateCroppedCuts) for (const path of croppedCutSourcePaths(edit)) needed.add(path);

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
      // 一様倍率では縦横比の違う proxy を再現できない。測れない proxy も使わない（原本のまま）。
      if (!(ratio > 0) || !Number.isFinite(ratio)
        || Math.abs(ratio / (original.height / proxy.height) - 1) > ASPECT_EPSILON) return;
      replacements.set(sourcePath, { path: source.proxy, ratio });
    } catch (error) {
      console.warn('[preview] proxy の寸法が読めないため原本のまま再生します', source.path, String(error));
    }
  }));
  if (replacements.size === 0) return edit;

  const playback = structuredClone(edit);
  // 第10項の暫定補償（既定 OFF・後で外す）。
  if (compensateCroppedCuts) applyCroppedCutScaleCompensation(playback, replacements);
  const layers = Array.isArray(playback.layers) ? playback.layers : [];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const replacement = replacements.get(normalizedPath(layer?.src));
    if (!replacement || !isProxyEligibleLayer(playback, layer, index)) continue;
    layer.src = replacement.path;
    layer.transform = scaledBy(layer.transform, replacement.ratio);
    scaleKeyframesInPlace(layer, replacement.ratio);
  }
  return playback;
}

// ---------------------------------------------------------------------------
// ここから下は不具合メモ **第10項**（ベース映像のクロップ計算が proxy 寸法基準になっている）の
// 暫定補償で、**既定 OFF**。現場では「保存側 edit.json の scale を原本基準へ戻す」修正とペアで
// 当てられていた。製品リポの保存側はまだ proxy 寸法基準で焼くため、ここで掛けると二重補正になり
// 本編カットが ratio 倍だけ大きく見える。第10項の根本修正が入ったら、必要・不要のどちらに転んでも
// この 2 関数・`options.compensateCroppedCuts`・app.js の `previewLayerProxyOptions` を
// まとめて外せる（`layers[]` の proxy 解決は第10項と独立に必要な修正なので残す）。
//
// 検証したいときだけ Web UI の `?cutCropProxyCompensation=1` で入れる。
// ---------------------------------------------------------------------------

/** crop を持つ cut が参照するソースの宣言 path（proxy 宣言のあるものだけ）。 */
export function croppedCutSourcePaths(edit) {
  const sourcesById = new Map((Array.isArray(edit?.sources) ? edit.sources : [])
    .filter((source) => source?.id != null)
    .map((source) => [source.id, source]));
  const paths = [];
  for (const cut of Array.isArray(edit?.cuts) ? edit.cuts : []) {
    const source = sourcesById.get(cut?.src);
    if (cut?.crop && source?.proxy && source.path) paths.push(normalizedPath(source.path));
  }
  return paths;
}

/** crop 付き cut の静的倍率・倍率キーフレームへ寸法比を掛ける（再生用コピーを in-place で書き換える）。 */
export function applyCroppedCutScaleCompensation(playbackEdit, replacements) {
  const sourcesById = new Map((Array.isArray(playbackEdit?.sources) ? playbackEdit.sources : [])
    .filter((source) => source?.id != null)
    .map((source) => [source.id, source]));
  for (const cut of Array.isArray(playbackEdit?.cuts) ? playbackEdit.cuts : []) {
    const source = sourcesById.get(cut?.src);
    const replacement = source && replacements.get(normalizedPath(source.path));
    if (!cut?.crop || !replacement) continue;
    cut.transform = scaledBy(cut.transform, replacement.ratio);
    scaleKeyframesInPlace(cut, replacement.ratio);
  }
}
