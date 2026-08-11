// cuts[].fx: 画面 FX の id 参照表 + ディスパッチ機構。docs/contract-2026-08-05-fx-v0.md 参照
// （新規実装した小語彙 5 種 = noise / particles / vignette / flare / color-overlay の技術仕様）。
//
// 2026-08-11 撤去: 上記 5 種はオーナー裁定「めちゃくちゃダサいのでやめたい」により製品面から
// 全撤去した（presets/fx/INDEX.md 参照）。撤去したのは**中身**（FX_BUILDERS の 5 ビルダー）だけで、
// この参照表・ディスパッチの**器**は残す — 将来の Vision 分析パス系レシピの受け皿として存続する。
//
// 契約:
// - 全 id 共通ツマミ: intensity（0..1、省略時 1）。0 は恒等（no-op）— appendCutFxChain が
//   ビルダーの手前で一律に処理するため、各ビルダー自身は 0 を意識しない。
// - id は packages/schemas/edit.schema.json 上は enum ではなく string（2026-08-11 緩和）。
//   FX_BUILDERS に登録の無い id（現在は登録 0 件なので事実上すべての id）はハードフェイルせず
//   警告ログ + no-op で通す（データ契約の三原則 — 受け口を広げる方向の互換。
//   docs/contract-2026-07-17-data-contract-versioning.md）。旧 v0 の 5 id を含む edit.json も
//   この経路でそのまま完走する
// - 決定論: 乱数は一切使わない（Math.random / Date.now 禁止）。ビルダーが必要とする seed は
//   ラベル文字列（cut 位置 + スタック段 + fx id）からの固定ハッシュで導出する

// FX_IDS: FX_BUILDERS に登録済みの id 一覧（= presets/fx/index.jsonl のエントリと 1:1 対応）。
// 2026-08-11 現在 0 件。新しい fx を実装したら、ここと FX_BUILDERS と index.jsonl の 3 箇所に
// 同じ id を足す（旧 5 種のときと同じ配線方法）。
export const FX_IDS = [];

export function hasCutFx(cuts) {
  return Array.isArray(cuts) && cuts.some((cut) => Array.isArray(cut?.fx) && cut.fx.length > 0);
}

export function normalizeCutFxList(fx) {
  if (!Array.isArray(fx)) return [];
  return fx
    .filter((item) => item && typeof item === "object" && isNonEmptyString(item.id))
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
    const builder = FX_BUILDERS[item.id];
    if (item.intensity <= 0) {
      // 共通契約: intensity 0 は恒等。ビルダーの実装に関わらず一律で no-op にする。
      filters.push(`${current}null${next}`);
    } else if (!builder) {
      // 2026-08-11 撤去以降、FX_BUILDERS は登録 0 件。未知 id はハードフェイルさせず
      // 警告 + no-op（そのカットは fx なしでレンダー続行）。
      console.warn(`[render-cut] cuts[].fx: unknown fx id "${item.id}" — ignoring (no-op)`);
      filters.push(`${current}null${next}`);
    } else {
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

// FX_BUILDERS: id -> フィルタグラフビルダー関数のディスパッチ表。2026-08-11 現在 0 件
// （v0 5 種の撤去により空になった器）。新しい fx を実装するときはここへ `{filters, inputLabel,
// outputLabel, intensity, params, width, height, fps, duration, uid, seed}` を受け取る関数を
// 追加する（旧実装 buildNoise/buildVignette/buildColorOverlay/buildParticles/buildFlare が
// 参考実装。docs/contract-2026-08-05-fx-v0.md に技術仕様が残っている）。
const FX_BUILDERS = {};

// FNV-1a 32bit。文字列 -> [0, 2^31) の非負整数へ決定的に写像する（Math.random 不使用）。
// 多くの ffmpeg フィルタのシード引数は符号あり 32bit 相当の狭い範囲しか受け付けないため、
// 安全側で最上位ビットを落として正の範囲に丸めておく。
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
