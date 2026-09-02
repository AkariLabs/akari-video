/**
 * 幾何の統一 G1 — 「実寸基準」マーカーと、既存プロジェクトの一度きりの焼き込み。
 *
 * 映像 item の幾何には 2 基準がある。
 *   - fit 基準: 出力キャンバスへ contain fit してから transform を掛ける（`crop` /
 *     `perspective` / 2 点以上の keyframes を持たない cut）。
 *   - 実寸基準: ソース実寸 × scale の box をそのまま置く（layer と layer-style の cut）。
 * 同じ `transform.scale` でも素材と出力の画素数が違えば大きさが変わるため、統一先は実寸基準とし、
 * 既存プロジェクトは「見た目を変えない」ように `scale × fit` を一度だけ焼き込んでから
 * `output.geometry: "source"` を立てる。マーカーが無い文書は今までどおり fit 互換で描く。
 *
 * このファイルは純関数だけを持つ（I/O 無し）。素材の寸法は呼び出し側が `dimensionsOf` で渡す。
 * G1 ではエンジンはマーカーを読まない（描画は 1 バイトも変えない）。
 */
import { type InternalEdit } from '../internal-model';
/** `output.geometry` の唯一の語彙。無い = fit 互換（従来どおり）。 */
export declare const GEOMETRY_SOURCE = "source";
/** 表示回転を適用した後のソース画素数。 */
export interface MediaDimensions {
    width: number;
    height: number;
}
/** 素材 id → 表示回転後の画素数。取得できない素材は null / undefined を返す。 */
export type DimensionsOf = (sourceId: string) => MediaDimensions | null | undefined;
/** 1 item ぶんの焼き込み記録（report / UI 表示用）。 */
export interface GeometryChange {
    itemId: string;
    sourceId: string;
    /** `min(outputW / srcW, outputH / srcH)`。 */
    fit: number;
    /** 焼き込み前の `transform.scale`（宣言が無ければ 1）。 */
    before: number;
    /** 焼き込み後の `transform.scale`。 */
    after: number;
}
export type GeometryNormalizationResult = {
    edit: Record<string, unknown>;
    changes: GeometryChange[];
} | {
    blockers: string[];
};
/** 今 fit 基準で描かれている（= 焼き込み対象になり得る）media item。 */
export interface FitBasisCandidate {
    itemId: string;
    sourceId: string;
}
/**
 * `packages/frame-engine/src/timeline/plan.ts` の `hasCutLayerStyleVisual` と同型の純関数。
 * frame-engine を import せずに済ませるための写しであり、両者の一致は
 * `test/geometry-normalization.test.mjs` が同じ入力表で固定する。
 */
export declare function hasCutLayerStyleVisual(cut: {
    crop?: unknown;
    perspective?: unknown;
    keyframes?: unknown;
}): boolean;
/** 6 桁で丸める（JSON へ書く値の桁を安定させる）。 */
export declare function round6(value: number): number;
/**
 * 内部表現から「今 fit 基準で描かれている media item」を列挙する。
 *
 * `item.legacy.collection === 'cuts'` は `projectLegacyEdit` が `cuts[]` へ振り分ける条件そのもの
 * （media item のうち sfx / narration / bgm / layers 以外）。そこから `crop` / `perspective` /
 * 2 点以上の keyframes を宣言したもの（= 既に実寸基準の layer-style で描かれる cut）を除く。
 */
export declare function collectFitBasisCandidates(internal: InternalEdit): FitBasisCandidate[];
/**
 * `scale × fit` を一度だけ焼き込み、`output.geometry: "source"` を立てた edit を返す。
 * 部分適用はしない: 対象 item の素材寸法が 1 つでも取れなければ blockers を返して何も変えない。
 */
export declare function normalizeGeometry(raw: unknown, dimensionsOf: DimensionsOf): GeometryNormalizationResult;
