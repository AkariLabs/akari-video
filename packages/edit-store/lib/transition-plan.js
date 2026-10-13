"use strict";
/**
 * トラック 1 本ぶんのトランジションの計画（窓の位置と長さ）を決める単一定義。
 *
 * 投影する前の、動かないクリップの並びを受け取り、描かれる境目をすべて挙げてからまとめて計画する。
 * 映像の投影・音・タイムラインの帯・lint は、ここで決めた窓を読む。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSITION_FILL_IDS = exports.TRANSITION_ALIGN_IDS = void 0;
exports.isTransitionAlign = isTransitionAlign;
exports.readTransitionAlign = readTransitionAlign;
exports.readTransitionFill = readTransitionFill;
exports.planTrackTransitions = planTrackTransitions;
exports.chooseTransitionAlign = chooseTransitionAlign;
exports.transitionPlanClipsFromCuts = transitionPlanClipsFromCuts;
const cut_adjacency_1 = require("./cut-adjacency");
const edit_store_1 = require("./edit-store");
exports.TRANSITION_ALIGN_IDS = ['center', 'before-cut', 'after-cut'];
exports.TRANSITION_FILL_IDS = ['freeze'];
function isTransitionAlign(value) {
    return typeof value === 'string' && exports.TRANSITION_ALIGN_IDS.includes(value);
}
/** 省略・知らない値は center として読む。 */
function readTransitionAlign(value) {
    return isTransitionAlign(value) ? value : 'center';
}
/** 知らない値は「埋めない」として読む。 */
function readTransitionFill(value) {
    return value === 'freeze' ? 'freeze' : undefined;
}
const EPSILON = 0.000001;
const room = (value) => value === undefined || value === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(value) && value > 0 ? value : 0;
/** 長さ x の窓が、前のクリップの範囲に入る分。 */
const earlierShare = (align, x) => align === 'before-cut' ? x : align === 'after-cut' ? 0 : x / 2;
/** 長さ x の窓が、後のクリップの範囲に入る分。 */
const laterShare = (align, x) => align === 'after-cut' ? x : align === 'before-cut' ? 0 : x / 2;
/** 前のクリップの範囲に入る分の上限 a と、後のクリップの範囲に入る分の上限 b から、窓の長さの上限を出す。 */
const lengthWithin = (align, a, b) => align === 'before-cut' ? a : align === 'after-cut' ? b : 2 * Math.min(a, b);
/**
 * 1 本のトラックのクリップの並び（始まりの順）から、描かれる境目の窓を決める。
 * 結果は順番によらず、新しい形の窓どうしは正の長さで重ならない。
 */
function planTrackTransitions(clips, options) {
    const fps = (0, cut_adjacency_1.effectiveCutFps)(options.fps);
    const boundaries = [];
    for (let index = 0; index + 1 < clips.length; index++) {
        const earlier = clips[index];
        const later = clips[index + 1];
        const declared = earlier.transitionOut?.declaredSeconds;
        if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) {
            boundaries.push(undefined);
            continue;
        }
        const earlierEnd = earlier.startSeconds + earlier.lengthSeconds;
        const laterEnd = later.startSeconds + later.lengthSeconds;
        const overlapFrames = (0, cut_adjacency_1.cutOverlapFrames)({ tlEnd: earlierEnd }, { tlStart: later.startSeconds }, fps);
        if (overlapFrames === 0) {
            boundaries.push({
                kind: 'new', earlier: index, later: index + 1, cutSeconds: later.startSeconds,
                align: earlier.transitionOut.align, declaredSeconds: declared, requested: 0,
                reasons: new Set(), blockedByLegacy: false
            });
            continue;
        }
        const overlap = earlierEnd - later.startSeconds;
        if (overlapFrames < 0 || !(overlap > EPSILON) || overlap - declared > EPSILON) {
            boundaries.push(undefined);
            continue;
        }
        const windowEnd = Math.min(earlierEnd, laterEnd, later.startSeconds + declared);
        const windowSeconds = windowEnd - later.startSeconds;
        if (!(windowSeconds > EPSILON)) {
            boundaries.push(undefined);
            continue;
        }
        boundaries.push({
            kind: 'legacy', earlier: index, later: index + 1, cutSeconds: later.startSeconds,
            declaredSeconds: declared, overlapSeconds: overlap, windowSeconds,
            coversLater: windowEnd >= laterEnd - EPSILON
        });
    }
    // 取り合いに使うクリップの長さ。末尾側が新しい形の境目なら、カット点（次のクリップの始まり）までを数える。
    const ownLength = clips.map((clip, index) => {
        const tail = boundaries[index];
        return Math.max(0, tail?.kind === 'new' ? tail.cutSeconds - clip.startSeconds : clip.lengthSeconds);
    });
    // 1〜3: 宣言・クリップの長さ・余り、で「使いたい長さ」を決める。
    for (const boundary of boundaries) {
        if (boundary?.kind !== 'new')
            continue;
        const earlier = clips[boundary.earlier];
        const later = clips[boundary.later];
        const cutDrift = earlier.startSeconds + earlier.lengthSeconds - boundary.cutSeconds;
        const tailRoom = earlier.tailRoomSeconds === undefined
            ? Number.POSITIVE_INFINITY : Math.max(0, room(earlier.tailRoomSeconds) + cutDrift);
        const headRoom = room(later.headRoomSeconds);
        const earlierCap = Math.min(ownLength[boundary.earlier], headRoom);
        const laterCap = Math.min(ownLength[boundary.later], tailRoom);
        const requested = Math.max(0, Math.min(boundary.declaredSeconds, lengthWithin(boundary.align, earlierCap, laterCap)));
        if (requested < boundary.declaredSeconds - EPSILON) {
            const a = earlierShare(boundary.align, requested);
            const b = laterShare(boundary.align, requested);
            const uses = (share, cap) => share >= cap - EPSILON;
            if (boundary.align !== 'after-cut') {
                if (uses(a, ownLength[boundary.earlier]))
                    boundary.reasons.add('outgoing-length');
                if (uses(a, headRoom))
                    boundary.reasons.add('incoming-room');
            }
            if (boundary.align !== 'before-cut') {
                if (uses(b, ownLength[boundary.later]))
                    boundary.reasons.add('incoming-length');
                if (uses(b, tailRoom))
                    boundary.reasons.add('outgoing-room');
            }
        }
        boundary.requested = requested;
    }
    // 4: 1 つのクリップの両端の窓がぶつかるときだけ、取り合う。
    const tailLimit = new Array(clips.length).fill(Number.POSITIVE_INFINITY);
    const headLimit = new Array(clips.length).fill(Number.POSITIVE_INFINITY);
    for (let index = 0; index < clips.length; index++) {
        const head = index > 0 ? boundaries[index - 1] : undefined;
        const tail = boundaries[index];
        if (!head || !tail)
            continue;
        if (head.kind === 'legacy' && head.coversLater && tail.kind === 'new') {
            tail.blockedByLegacy = true;
            continue;
        }
        const length = ownLength[index];
        const headUse = head.kind === 'legacy' ? head.windowSeconds : laterShare(head.align, head.requested);
        const tailUse = tail.kind === 'legacy' ? tail.overlapSeconds : earlierShare(tail.align, tail.requested);
        if (!(headUse + tailUse > length + EPSILON))
            continue;
        if (head.kind === 'legacy' && tail.kind === 'legacy')
            continue;
        if (head.kind === 'legacy')
            tailLimit[index] = Math.max(0, length - headUse);
        else if (tail.kind === 'legacy')
            headLimit[index] = Math.max(0, length - tailUse);
        else {
            headLimit[index] = Math.max(length / 2, length - tailUse);
            tailLimit[index] = Math.max(length / 2, length - headUse);
        }
    }
    const minimumSeconds = 1 / fps;
    const plans = [];
    for (const boundary of boundaries) {
        if (!boundary)
            continue;
        const earlier = clips[boundary.earlier];
        const later = clips[boundary.later];
        if (boundary.kind === 'legacy') {
            plans.push({
                earlierId: earlier.id, laterId: later.id, cutSeconds: boundary.cutSeconds, legacyOverlap: true,
                align: 'center', declaredSeconds: boundary.declaredSeconds,
                effectiveSeconds: boundary.windowSeconds, startOffsetSeconds: 0,
                endOffsetSeconds: boundary.windowSeconds, state: 'ok', reasons: [],
                freezeIncomingSeconds: 0, freezeOutgoingSeconds: 0
            });
            continue;
        }
        const reasons = new Set(boundary.reasons);
        let effective = boundary.requested;
        if (boundary.blockedByLegacy) {
            effective = 0;
            reasons.add('neighbor');
        }
        else {
            const limited = lengthWithin(boundary.align, tailLimit[boundary.earlier], headLimit[boundary.later]);
            if (limited < effective - EPSILON) {
                effective = Math.max(0, limited);
                reasons.add('neighbor');
            }
        }
        if (effective > 0 && effective < minimumSeconds - EPSILON) {
            effective = 0;
            reasons.add('too-short');
        }
        const state = effective <= 0 ? 'none'
            : effective < boundary.declaredSeconds - EPSILON ? 'shortened' : 'ok';
        plans.push({
            earlierId: earlier.id, laterId: later.id, cutSeconds: boundary.cutSeconds, legacyOverlap: false,
            align: boundary.align, declaredSeconds: boundary.declaredSeconds, effectiveSeconds: effective,
            startOffsetSeconds: effective > 0 ? -earlierShare(boundary.align, effective) : 0,
            endOffsetSeconds: effective > 0 ? laterShare(boundary.align, effective) : 0,
            state, reasons: state === 'ok' ? [] : [...reasons],
            freezeIncomingSeconds: 0, freezeOutgoingSeconds: 0
        });
    }
    return plans;
}
/**
 * earlierId の末尾の境目に付けるときの寄せ方を選ぶ。隣の境目は渡された値のまま固定する。
 * 前のクリップの後ろの余りが不明なら 0 として選ぶ（分からない側に頼らない）。
 */
function chooseTransitionAlign(clips, earlierId, declaredSeconds, options) {
    const index = clips.findIndex(clip => clip.id === earlierId);
    if (index < 0 || index + 1 >= clips.length)
        return undefined;
    const laterId = clips[index + 1].id;
    const boundaryOf = (plans) => plans.find(plan => plan.earlierId === earlierId && plan.laterId === laterId);
    const baseline = planTrackTransitions(clips, options);
    let best;
    for (const align of exports.TRANSITION_ALIGN_IDS) {
        const candidateClips = clips.map((clip, clipIndex) => clipIndex === index ? {
            ...clip,
            tailRoomSeconds: clip.tailRoomSeconds ?? 0,
            transitionOut: { declaredSeconds, align, fill: false }
        } : clip);
        const plans = planTrackTransitions(candidateClips, options);
        const plan = boundaryOf(plans);
        if (!plan || plan.legacyOverlap)
            continue;
        if (!best || plan.effectiveSeconds > best.plan.effectiveSeconds + EPSILON)
            best = { align, plan, plans };
    }
    if (!best)
        return undefined;
    const neighborChanges = best.plans.filter(plan => {
        if (plan.earlierId === earlierId && plan.laterId === laterId)
            return false;
        const before = baseline.find(entry => entry.earlierId === plan.earlierId && entry.laterId === plan.laterId);
        return !before || Math.abs(before.effectiveSeconds - plan.effectiveSeconds) > EPSILON;
    });
    return { align: best.align, needsFill: false, plan: best.plan, neighborChanges };
}
/**
 * レイヤーへ退避した後のカットの並びから、計画用のクリップの並びをトラックごとに作る。
 * クリップの id は、渡された並びの中の番号（文字列）。
 */
function transitionPlanClipsFromCuts(cuts, options) {
    const usable = [];
    cuts.forEach((cut, index) => {
        if (typeof cut?.in === 'number' && Number.isFinite(cut.in)
            && typeof cut?.out === 'number' && Number.isFinite(cut.out) && cut.in < cut.out) {
            usable.push({ cut, index });
        }
    });
    const tracks = new Map();
    for (const segment of (0, edit_store_1.computeCutTrackSegments)(usable.map(entry => entry.cut))) {
        const { cut, index } = usable[segment.index];
        const facts = options.resolve(cut, index);
        const speed = typeof cut.speed === 'number' && cut.speed > 0 ? cut.speed : 1;
        const freezeSeconds = Number.isFinite(facts.freezeSeconds) && facts.freezeSeconds > 0 ? facts.freezeSeconds : 0;
        const transition = cut.transitionOut;
        const clip = {
            id: String(index),
            startSeconds: segment.at,
            lengthSeconds: segment.duration + freezeSeconds,
            headRoomSeconds: facts.stillImage ? Number.POSITIVE_INFINITY : Math.max(0, cut.in / speed),
            tailRoomSeconds: facts.stillImage ? Number.POSITIVE_INFINITY
                : typeof facts.materialDurationSeconds === 'number' && Number.isFinite(facts.materialDurationSeconds)
                    ? Math.max(0, (facts.materialDurationSeconds - cut.out) / speed) : undefined,
            ...(transition && typeof transition.duration === 'number' && Number.isFinite(transition.duration)
                && transition.duration > 0 ? { transitionOut: {
                    declaredSeconds: transition.duration,
                    align: readTransitionAlign(transition.align),
                    fill: readTransitionFill(transition.fill) === 'freeze'
                } } : {})
        };
        const list = tracks.get(segment.track) ?? [];
        list.push(clip);
        tracks.set(segment.track, list);
    }
    return [...tracks.entries()].sort((left, right) => left[0] - right[0])
        .map(([track, clips]) => ({ track, clips }));
}
