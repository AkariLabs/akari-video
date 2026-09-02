"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GEOMETRY_SOURCE = void 0;
exports.hasCutLayerStyleVisual = hasCutLayerStyleVisual;
exports.round6 = round6;
exports.collectFitBasisCandidates = collectFitBasisCandidates;
exports.normalizeGeometry = normalizeGeometry;
const internal_model_1 = require("../internal-model");
/** `output.geometry` の唯一の語彙。無い = fit 互換（従来どおり）。 */
exports.GEOMETRY_SOURCE = 'source';
function isRecordLike(value) {
    // frame-engine の plan.ts `isRecord` と同型（配列も true になる点まで含めて写す）。
    return Boolean(value) && typeof value === 'object';
}
function usableKeyframeCount(keyframes) {
    return Array.isArray(keyframes)
        ? keyframes.filter(point => Boolean(point) && typeof point === 'object'
            && Number.isFinite(point.t)
            && point.t >= 0).length
        : 0;
}
/**
 * `packages/frame-engine/src/timeline/plan.ts` の `hasCutLayerStyleVisual` と同型の純関数。
 * frame-engine を import せずに済ませるための写しであり、両者の一致は
 * `test/geometry-normalization.test.mjs` が同じ入力表で固定する。
 */
function hasCutLayerStyleVisual(cut) {
    return isRecordLike(cut.crop) || isRecordLike(cut.perspective) || usableKeyframeCount(cut.keyframes) >= 2;
}
function isPlainRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finitePositive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
/** 6 桁で丸める（JSON へ書く値の桁を安定させる）。 */
function round6(value) {
    return Math.round(value * 1e6) / 1e6;
}
/**
 * 内部表現から「今 fit 基準で描かれている media item」を列挙する。
 *
 * `item.legacy.collection === 'cuts'` は `projectLegacyEdit` が `cuts[]` へ振り分ける条件そのもの
 * （media item のうち sfx / narration / bgm / layers 以外）。そこから `crop` / `perspective` /
 * 2 点以上の keyframes を宣言したもの（= 既に実寸基準の layer-style で描かれる cut）を除く。
 */
function collectFitBasisCandidates(internal) {
    const candidates = [];
    const visit = (item) => {
        if (item.source.kind === 'media' && item.legacy.collection === 'cuts'
            && !hasCutLayerStyleVisual(item.declaration)) {
            candidates.push({ itemId: item.id, sourceId: item.source.sourceId });
        }
        for (const child of item.children)
            visit(child);
    };
    for (const track of internal.tracks) {
        if (track.lane !== 'visual')
            continue;
        for (const item of track.items)
            visit(item);
    }
    return candidates;
}
function forEachRawItem(node, visit) {
    if (!Array.isArray(node))
        return;
    for (const entry of node) {
        if (!isPlainRecord(entry))
            continue;
        visit(entry);
        forEachRawItem(entry.items, visit);
    }
}
function scaleOf(transform) {
    const declared = isPlainRecord(transform) ? transform.scale : undefined;
    return typeof declared === 'number' && Number.isFinite(declared) ? declared : 1;
}
/**
 * `scale × fit` を一度だけ焼き込み、`output.geometry: "source"` を立てた edit を返す。
 * 部分適用はしない: 対象 item の素材寸法が 1 つでも取れなければ blockers を返して何も変えない。
 */
function normalizeGeometry(raw, dimensionsOf) {
    if (!isPlainRecord(raw)) {
        return { blockers: ['edit.json のルートが object ではありません。'] };
    }
    if (raw.version !== 2) {
        return { blockers: ['edit.json.version が 2 ではありません。'] };
    }
    const doc = structuredClone(raw);
    const output = doc.output;
    if (!isPlainRecord(output)) {
        return { blockers: ['edit.json.output がありません。'] };
    }
    if (output.geometry === exports.GEOMETRY_SOURCE) {
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
    let internal;
    try {
        internal = (0, internal_model_1.readInternalEdit)(doc);
    }
    catch (error) {
        return { blockers: [`edit.json を読めません: ${error instanceof Error ? error.message : String(error)}`] };
    }
    const candidates = collectFitBasisCandidates(internal);
    const fitOf = new Map();
    const blockers = [];
    for (const candidate of candidates) {
        if (fitOf.has(candidate.sourceId))
            continue;
        const dimensions = dimensionsOf(candidate.sourceId);
        const width = finitePositive(dimensions?.width);
        const height = finitePositive(dimensions?.height);
        if (width === undefined || height === undefined) {
            const message = `素材 ${candidate.sourceId} の寸法を取得できないため移行できません。`;
            if (!blockers.includes(message))
                blockers.push(message);
            continue;
        }
        fitOf.set(candidate.sourceId, Math.min(outputWidth / width, outputHeight / height));
    }
    if (blockers.length > 0)
        return { blockers };
    const targets = new Map(candidates.map(candidate => [candidate.itemId, candidate.sourceId]));
    const changes = [];
    const changed = new Map();
    for (const track of Array.isArray(doc.tracks) ? doc.tracks : []) {
        if (!isPlainRecord(track))
            continue;
        forEachRawItem(track.items, item => {
            const itemId = typeof item.id === 'string' ? item.id : undefined;
            if (itemId === undefined || !targets.has(itemId) || changed.has(itemId))
                return;
            const sourceId = targets.get(itemId);
            const fit = fitOf.get(sourceId);
            // fit === 1 は恒等。値も、宣言の無いキーも足さない。
            if (fit === 1)
                return;
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
                    if (!isPlainRecord(point) || !isPlainRecord(point.transform))
                        continue;
                    const declared = point.transform.scale;
                    if (typeof declared !== 'number' || !Number.isFinite(declared))
                        continue;
                    point.transform = { ...point.transform, scale: round6(declared * fit) };
                }
            }
            const change = { itemId, sourceId, fit, before, after };
            changed.set(itemId, change);
            changes.push(change);
        });
    }
    output.geometry = exports.GEOMETRY_SOURCE;
    return { edit: doc, changes };
}
