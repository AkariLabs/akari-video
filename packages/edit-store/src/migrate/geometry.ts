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

import { readInternalEdit, type InternalEdit, type InternalItem } from '../internal-model';

/** `output.geometry` の唯一の語彙。無い = fit 互換（従来どおり）。 */
export const GEOMETRY_SOURCE = 'source';

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

export type GeometryNormalizationResult =
    | { edit: Record<string, unknown>; changes: GeometryChange[] }
    | { blockers: string[] };

/** 今 fit 基準で描かれている（= 焼き込み対象になり得る）media item。 */
export interface FitBasisCandidate {
    itemId: string;
    sourceId: string;
}

function isRecordLike(value: unknown): boolean {
    // frame-engine の plan.ts `isRecord` と同型（配列も true になる点まで含めて写す）。
    return Boolean(value) && typeof value === 'object';
}

function usableKeyframeCount(keyframes: unknown): number {
    return Array.isArray(keyframes)
        ? keyframes.filter(point => Boolean(point) && typeof point === 'object'
            && Number.isFinite((point as { t?: unknown }).t)
            && (point as { t: number }).t >= 0).length
        : 0;
}

/**
 * `packages/frame-engine/src/timeline/plan.ts` の `hasCutLayerStyleVisual` と同型の純関数。
 * frame-engine を import せずに済ませるための写しであり、両者の一致は
 * `test/geometry-normalization.test.mjs` が同じ入力表で固定する。
 */
export function hasCutLayerStyleVisual(
    cut: { crop?: unknown; perspective?: unknown; keyframes?: unknown }
): boolean {
    return isRecordLike(cut.crop) || isRecordLike(cut.perspective) || usableKeyframeCount(cut.keyframes) >= 2;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finitePositive(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 6 桁で丸める（JSON へ書く値の桁を安定させる）。 */
export function round6(value: number): number {
    return Math.round(value * 1e6) / 1e6;
}

/**
 * 内部表現から「今 fit 基準で描かれている media item」を列挙する。
 *
 * `item.legacy.collection === 'cuts'` は `projectLegacyEdit` が `cuts[]` へ振り分ける条件そのもの
 * （media item のうち sfx / narration / bgm / layers 以外）。そこから `crop` / `perspective` /
 * 2 点以上の keyframes を宣言したもの（= 既に実寸基準の layer-style で描かれる cut）を除く。
 */
export function collectFitBasisCandidates(internal: InternalEdit): FitBasisCandidate[] {
    const candidates: FitBasisCandidate[] = [];
    const visit = (item: InternalItem): void => {
        if (item.source.kind === 'media' && item.legacy.collection === 'cuts'
            && !hasCutLayerStyleVisual(item.declaration)) {
            candidates.push({ itemId: item.id, sourceId: item.source.sourceId });
        }
        for (const child of item.children) visit(child);
    };
    for (const track of internal.tracks) {
        if (track.lane !== 'visual') continue;
        for (const item of track.items) visit(item);
    }
    return candidates;
}

function forEachRawItem(node: unknown, visit: (item: Record<string, unknown>) => void): void {
    if (!Array.isArray(node)) return;
    for (const entry of node) {
        if (!isPlainRecord(entry)) continue;
        visit(entry);
        forEachRawItem(entry.items, visit);
    }
}

function scaleOf(transform: unknown): number {
    const declared = isPlainRecord(transform) ? transform.scale : undefined;
    return typeof declared === 'number' && Number.isFinite(declared) ? declared : 1;
}

/**
 * `scale × fit` を一度だけ焼き込み、`output.geometry: "source"` を立てた edit を返す。
 * 部分適用はしない: 対象 item の素材寸法が 1 つでも取れなければ blockers を返して何も変えない。
 */
export function normalizeGeometry(raw: unknown, dimensionsOf: DimensionsOf): GeometryNormalizationResult {
    if (!isPlainRecord(raw)) {
        return { blockers: ['edit.json のルートが object ではありません。'] };
    }
    if (raw.version !== 2) {
        return { blockers: ['edit.json.version が 2 ではありません。'] };
    }
    const doc = structuredClone(raw) as Record<string, unknown>;
    const output = doc.output;
    if (!isPlainRecord(output)) {
        return { blockers: ['edit.json.output がありません。'] };
    }
    if (output.geometry === GEOMETRY_SOURCE) {
        return { edit: doc, changes: [] };
    }
    if (output.geometry !== undefined) {
        return { blockers: [`未知の output.geometry です: ${JSON.stringify(output.geometry)}`] };
    }
    const outputWidth = finitePositive(output.width);
    const outputHeight = finitePositive(output.height);
    if (outputWidth === undefined || outputHeight === undefined) {
        return { blockers: ['edit.json.output.width / height が正の数ではありません。'] };
    }

    let internal: InternalEdit;
    try {
        internal = readInternalEdit(doc);
    } catch (error) {
        return { blockers: [`edit.json を読めません: ${error instanceof Error ? error.message : String(error)}`] };
    }

    const candidates = collectFitBasisCandidates(internal);
    const fitOf = new Map<string, number>();
    const blockers: string[] = [];
    for (const candidate of candidates) {
        if (fitOf.has(candidate.sourceId)) continue;
        const dimensions = dimensionsOf(candidate.sourceId);
        const width = finitePositive(dimensions?.width);
        const height = finitePositive(dimensions?.height);
        if (width === undefined || height === undefined) {
            const message = `素材 ${candidate.sourceId} の寸法を取得できないため移行できません。`;
            if (!blockers.includes(message)) blockers.push(message);
            continue;
        }
        fitOf.set(candidate.sourceId, Math.min(outputWidth / width, outputHeight / height));
    }
    if (blockers.length > 0) return { blockers };

    const targets = new Map(candidates.map(candidate => [candidate.itemId, candidate.sourceId]));
    const changes: GeometryChange[] = [];
    const changed = new Map<string, GeometryChange>();
    for (const track of Array.isArray(doc.tracks) ? doc.tracks : []) {
        if (!isPlainRecord(track)) continue;
        forEachRawItem(track.items, item => {
            const itemId = typeof item.id === 'string' ? item.id : undefined;
            if (itemId === undefined || !targets.has(itemId) || changed.has(itemId)) return;
            const sourceId = targets.get(itemId) as string;
            const fit = fitOf.get(sourceId) as number;
            // fit === 1 は恒等。値も、宣言の無いキーも足さない。
            if (fit === 1) return;
            const before = scaleOf(item.transform);
            const after = round6(before * fit);
            item.transform = {
                ...(isPlainRecord(item.transform) ? item.transform : {}),
                scale: after,
            };
            // 1 点だけの keyframe は静的宣言の言い換えなので同じ倍率を掛ける
            // （2 点以上は layer-style = 既に実寸基準なので、そもそも対象に入らない）。
            if (Array.isArray(item.keyframes) && usableKeyframeCount(item.keyframes) === 1) {
                for (const point of item.keyframes) {
                    if (!isPlainRecord(point) || !isPlainRecord(point.transform)) continue;
                    const declared = point.transform.scale;
                    if (typeof declared !== 'number' || !Number.isFinite(declared)) continue;
                    point.transform = { ...point.transform, scale: round6(declared * fit) };
                }
            }
            const change: GeometryChange = { itemId, sourceId, fit, before, after };
            changed.set(itemId, change);
            changes.push(change);
        });
    }

    output.geometry = GEOMETRY_SOURCE;
    return { edit: doc, changes };
}
