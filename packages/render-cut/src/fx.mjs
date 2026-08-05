// cuts[].fx: 画面 FX 小語彙 5 種（noise / particles / vignette / flare / color-overlay）の
// ffmpeg フィルタグラフ実装。docs/contract-2026-08-05-fx-v0.md 参照。
//
// 契約:
// - 全 id 共通ツマミ: intensity（0..1、省略時 1）。0 は恒等（no-op）— このモジュールの
//   appendCutFxChain がビルダーの手前で一律に処理するため、各ビルダー自身は 0 を意識しない。
// - 色ツマミは params.color（vignette は black/white の 2 値、color-overlay は任意の
//   ffmpeg color 表記 - 例 "red" / "#ff0000" / "0xff0000"）。
// - 決定論: 乱数は一切使わない（Math.random / Date.now 禁止）。noise の ffmpeg シードも
//   ラベル文字列（cut 位置 + スタック段 + fx id）からの固定ハッシュで導出する。同一
//   edit.json は常に同一フィルタ文字列・同一シードを生成する。
// - 実装経路: noise / vignette / color-overlay は ffmpeg 標準フィルタ直結。particles / flare は
//   手続き描画（geq による移動する輝点の合成。X/Y/N のみを使う純粋な式で、乱数は使わない）。

export const FX_IDS = ["noise", "particles", "vignette", "flare", "color-overlay"];

export function hasCutFx(cuts) {
  return Array.isArray(cuts) && cuts.some((cut) => Array.isArray(cut?.fx) && cut.fx.length > 0);
}

export function normalizeCutFxList(fx) {
  if (!Array.isArray(fx)) return [];
  return fx
    .filter((item) => item && typeof item === "object" && FX_IDS.includes(item.id))
    .map((item) => ({
      id: item.id,
      intensity: isFiniteNumber(item.intensity) ? clamp01(item.intensity) : 1,
      params: item.params && typeof item.params === "object" && !Array.isArray(item.params) ? item.params : {},
    }));
}

// inputLabel/outputLabel はブラケット付きラベル文字列（例 "[v0]"）。id はこの呼び出しの
// フィルタグラフ全体で一意な文字列（呼び出し元の per-cut ラベル、例 "v0" / "v1_2" / "gap_3"）
// — 複数 fx を重ね掛けするときの中間ラベル生成に使う。
export function appendCutFxChain({ filters, inputLabel, outputLabel, fx, id, width, height, fps, duration }) {
  const list = normalizeCutFxList(fx);
  if (list.length === 0) {
    filters.push(`${inputLabel}null${outputLabel}`);
    return;
  }
  let current = inputLabel;
  list.forEach((item, stage) => {
    const isLast = stage === list.length - 1;
    const next = isLast ? outputLabel : `[fx_${id}_${stage}]`;
    const uid = `${id}_${stage}`;
    if (item.intensity <= 0) {
      // 共通契約: intensity 0 は恒等。ビルダーの実装に関わらず一律で no-op にする。
      filters.push(`${current}null${next}`);
    } else {
      const builder = FX_BUILDERS[item.id];
      builder({
        filters,
        inputLabel: current,
        outputLabel: next,
        intensity: item.intensity,
        params: item.params,
        width,
        height,
        fps,
        duration,
        uid,
        seed: deterministicSeed(uid, item.id),
      });
    }
    current = next;
  });
}

// docs/contract-2026-08-05-fx-v0.md #noise: ffmpeg `noise` フィルタ直結。all_flags=u+t
// (uniform + temporal) はフレームごとに異なるノイズを載せる — 「フレーム間分散が増加」の
// 受け入れ条件の核。all_seed は固定（後述 deterministicSeed）なので同一入力の 2 回レンダは
// 画素等価になる。intensity は ffmpeg の strength レンジ [0,100] へ線形写像する。
function buildNoise({ filters, inputLabel, outputLabel, intensity, seed }) {
  const strength = Math.max(1, Math.min(100, Math.round(intensity * 100)));
  filters.push(`${inputLabel}noise=all_seed=${seed}:all_strength=${strength}:all_flags=u+t${outputLabel}`);
}

// docs/contract-2026-08-05-fx-v0.md #vignette: ffmpeg `vignette` フィルタ（既定 = 四隅を
// 減光する forward モード）。params.color === "white" のときは negate → vignette → negate で
// 反転空間に暗化を適用してから戻す（暗化 = 反転後の明化 = 元空間では白ビネット）。intensity は
// output.look と同じ split+blend パターン（0 = 無変換、1 = フル効果）で連続的に混ぜる。
function buildVignette({ filters, inputLabel, outputLabel, intensity, params, uid }) {
  const white = params?.color === "white";
  const baseLabel = `[vig_${uid}_base]`;
  const topLabel = `[vig_${uid}_top]`;
  const appliedLabel = `[vig_${uid}_applied]`;
  filters.push(`${inputLabel}split=2${baseLabel}${topLabel}`);
  const chain = white ? "negate,vignette,negate" : "vignette";
  filters.push(`${topLabel}${chain}${appliedLabel}`);
  filters.push(`${appliedLabel}${baseLabel}blend=all_mode=normal:all_opacity=${num(intensity)}${outputLabel}`);
}

// docs/contract-2026-08-05-fx-v0.md #color-overlay: 単色ソース（ffmpeg `color=`）を intensity
// で線形混合する。blend の top 入力 (第 1 引数) が all_opacity の重みを受けるため、色レイヤーを
// top・元映像を bottom に置く（intensity=1 で完全な色被り、0 で無変換 — output.look の
// lut3d+blend と同じ規約、docs/contract-2026-07-22-render-basics.md #4 参照）。
function buildColorOverlay({ filters, inputLabel, outputLabel, intensity, params, width, height, fps, duration, uid }) {
  const color = isNonEmptyString(params?.color) ? params.color : "black";
  const colorLabel = `[colovl_${uid}]`;
  filters.push(`color=c=${color}:s=${width}x${height}:r=${num(fps)}:d=${num(duration)}${colorLabel}`);
  filters.push(`${colorLabel}${inputLabel}blend=all_mode=normal:all_opacity=${num(intensity)}${outputLabel}`);
}

// docs/contract-2026-08-05-fx-v0.md #particles: 黒キャンバス上に geq で複数の小さな輝点を
// 手続き的に描画し（漂うちり）、screen ブレンドで元映像に加算的に重ねる。screen は暗い
// (ほぼ黒の) 部分では元映像をほぼ変えず、輝点のところだけ明るくする — 浮遊する粒子の見た目に
// 合う。仕上げに intensity で元映像とのフル効果版を線形混合する（他の FX と同じ二段混合）。
function buildParticles({ filters, inputLabel, outputLabel, intensity, width, height, fps, duration, uid, seed }) {
  buildProceduralGlowLayer({
    filters,
    inputLabel,
    outputLabel,
    intensity,
    width,
    height,
    fps,
    duration,
    uid,
    expr: buildDriftingDotsExpr({ width, height, fps, seed, count: 4, radiusRatio: 0.028, peak: 235 }),
  });
}

// docs/contract-2026-08-05-fx-v0.md #flare: particles と同じ procedural + screen 合成だが、
// 単一の大きな輝点がゆっくり周回する（光のフレア・強調）。
function buildFlare({ filters, inputLabel, outputLabel, intensity, width, height, fps, duration, uid, seed }) {
  buildProceduralGlowLayer({
    filters,
    inputLabel,
    outputLabel,
    intensity,
    width,
    height,
    fps,
    duration,
    uid,
    expr: buildDriftingDotsExpr({ width, height, fps, seed, count: 1, radiusRatio: 0.16, peak: 255 }),
  });
}

function buildProceduralGlowLayer({ filters, inputLabel, outputLabel, intensity, width, height, fps, duration, uid, expr }) {
  const canvasLabel = `[glow_${uid}_canvas]`;
  const layerLabel = `[glow_${uid}_layer]`;
  const fullLabel = `[glow_${uid}_full]`;
  filters.push(`color=c=black:s=${width}x${height}:r=${num(fps)}:d=${num(duration)}${canvasLabel}`);
  // geq は luma のみ書く（cb/cr を明示的に 128 固定しないと既定で色被りが乗る — 実測確認済み）。
  filters.push(`${canvasLabel}format=yuv420p,geq=lum='${expr}':cb=128:cr=128${layerLabel}`);
  filters.push(`${inputLabel}${layerLabel}blend=all_mode=screen${fullLabel}`);
  filters.push(`${fullLabel}${inputLabel}blend=all_mode=normal:all_opacity=${num(intensity)}${outputLabel}`);
}

// count 個の輝点が、それぞれ決定的な位相・速度で画面内を漂う/周回する geq 輝度式を作る。
// N (フレーム通し番号) だけを時間変数に使う純粋な式 — 乱数は使わない。同じ (width, height,
// fps, seed, count) には常に同じ式文字列が生成される。
function buildDriftingDotsExpr({ width, height, fps, seed, count, radiusRatio, peak }) {
  const minSide = Math.min(width, height);
  const radius = Math.max(1.2, minSide * radiusRatio);
  const r2 = radius * radius;
  const terms = [];
  for (let k = 0; k < count; k += 1) {
    const phase = (2 * Math.PI * k) / count + ((seed + k * 31) % 97) * 0.0647;
    const baseX = (width * (k + 0.5)) / count;
    const speedXPerFrame = (width * 0.0026) * (1 + k * 0.3);
    const ampY = height * 0.16 * (1 + k * 0.3);
    const periodFrames = Math.max(8, Math.round(fps * (4 + k)));
    const px = `mod(${num(baseX)}+${num(speedXPerFrame)}*N,${num(width)})`;
    const py = `(${num(height / 2)}+${num(ampY)}*sin(2*PI*N/${num(periodFrames)}+${num(phase)}))`;
    terms.push(`${num(peak)}*exp(-((X-(${px}))^2+(Y-${py})^2)/(2*${num(r2)}))`);
  }
  return terms.join("+");
}

const FX_BUILDERS = {
  noise: buildNoise,
  vignette: buildVignette,
  "color-overlay": buildColorOverlay,
  particles: buildParticles,
  flare: buildFlare,
};

// FNV-1a 32bit。文字列 -> [0, 2^31) の非負整数へ決定的に写像する（Math.random 不使用）。
// ffmpeg noise の all_seed が受け付ける範囲 (-1..INT_MAX) に収まるよう最上位ビットを落とす。
function deterministicSeed(...parts) {
  const str = parts.join(":");
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 1;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function num(value) {
  return Number(Number(value).toFixed(6)).toString();
}
