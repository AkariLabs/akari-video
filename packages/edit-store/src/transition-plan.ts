/**
 * トラック 1 本ぶんのトランジションの計画（窓の位置と長さ）を決める単一定義。
 *
 * 投影する前の、動かないクリップの並びを受け取り、描かれる境目をすべて挙げてからまとめて計画する。
 * 映像の投影・音・タイムラインの帯・lint は、ここで決めた窓を読む。
 */

import { cutOverlapFrames, effectiveCutFps } from './cut-adjacency';
import { computeCutTrackSegments, type EditCut } from './edit-store';

export type TransitionAlign = 'center' | 'before-cut' | 'after-cut';

export const TRANSITION_ALIGN_IDS: readonly TransitionAlign[] = ['center', 'before-cut', 'after-cut'];
export const TRANSITION_FILL_IDS: readonly 'freeze'[] = ['freeze'];

export function isTransitionAlign(value: unknown): value is TransitionAlign {
    return typeof value === 'string' && (TRANSITION_ALIGN_IDS as readonly string[]).includes(value);
}

/** 省略・知らない値は center として読む。 */
export function readTransitionAlign(value: unknown): TransitionAlign {
    return isTransitionAlign(value) ? value : 'center';
}

/** 知らない値は「埋めない」として読む。 */
export function readTransitionFill(value: unknown): 'freeze' | undefined {
    return value === 'freeze' ? 'freeze' : undefined;
}

export interface TransitionPlanClip {
    id: string;
    /** 投影前の出力の始まり（秒）。 */
    startSeconds: number;
    /** 投影前の表示の長さ（秒）。既存のフリーズを含む。 */
    lengthSeconds: number;
    /** in より前に残る素材（出力秒）。静止画は Infinity。 */
    headRoomSeconds: number;
    /** out より後ろに残る素材（出力秒）。素材の長さが不明なら undefined。静止画は Infinity。 */
    tailRoomSeconds: number | undefined;
    transitionOut?: { declaredSeconds: number; align: TransitionAlign; fill: boolean };
    /** このクリップの頭は止め絵にできない（既存のフリーズがある）。 */
    holdBlocked?: boolean;
}

export type TransitionShortenReason =
    'outgoing-length' | 'incoming-length' | 'outgoing-room' | 'incoming-room' | 'neighbor' | 'too-short';

export interface TransitionBoundaryPlan {
    earlierId: string;
    laterId: string;
    /** カット点（投影前の出力秒）。後のクリップの始まり。 */
    cutSeconds: number;
    /** 実際の重なりをそのまま窓に使った境目（古い形）。 */
    legacyOverlap: boolean;
    align: TransitionAlign;
    declaredSeconds: number;
    /** 窓の長さ。state が none なら 0。 */
    effectiveSeconds: number;
    /** 窓の始まり − カット点（0 以下）。 */
    startOffsetSeconds: number;
    /** 窓の終わり − カット点（0 以上）。 */
    endOffsetSeconds: number;
    state: 'ok' | 'shortened' | 'none';
    reasons: readonly TransitionShortenReason[];
    /** 後のクリップの頭の止め絵（秒）。fill のある境目だけ 0 以外になる。 */
    freezeIncomingSeconds: number;
    /** 前のクリップの終わりの止め絵（秒）。後ろの余りが不明なら上限（後ろへ入る分）を返し、freezeOutgoingUnknown を立てる。 */
    freezeOutgoingSeconds: number | undefined;
    freezeOutgoingUnknown?: true;
}

export interface TransitionPlanOptions {
    fps: number;
    /**
     * 前のクリップの後ろの余りの扱い。'limit'（省略時）は fill の無い境目を余りで制限する。
     * 'ignore' は描画と同じ見方で、制限せずに止め絵の秒数だけ報告する。
     */
    tailRoom?: 'limit' | 'ignore';
}

interface InternalPlanOptions extends TransitionPlanOptions {
    /** この番号のクリップの末尾の境目だけ、'ignore' でも後ろの余りで制限する（置き方を選ぶ候補）。 */
    strictTailIndex?: number;
}

const EPSILON = 0.000001;

const room = (value: number | undefined): number => value === undefined || value === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(value) && value > 0 ? value : 0;

/** 長さ x の窓が、前のクリップの範囲に入る分。 */
const earlierShare = (align: TransitionAlign, x: number): number =>
    align === 'before-cut' ? x : align === 'after-cut' ? 0 : x / 2;

/** 長さ x の窓が、後のクリップの範囲に入る分。 */
const laterShare = (align: TransitionAlign, x: number): number =>
    align === 'after-cut' ? x : align === 'before-cut' ? 0 : x / 2;

/** 前のクリップの範囲に入る分の上限 a と、後のクリップの範囲に入る分の上限 b から、窓の長さの上限を出す。 */
const lengthWithin = (align: TransitionAlign, a: number, b: number): number =>
    align === 'before-cut' ? a : align === 'after-cut' ? b : 2 * Math.min(a, b);

interface NewBoundary {
    kind: 'new';
    earlier: number;
    later: number;
    cutSeconds: number;
    align: TransitionAlign;
    declaredSeconds: number;
    requested: number;
    reasons: Set<TransitionShortenReason>;
    blockedByLegacy: boolean;
    /** 後のクリップの頭を止め絵で埋める（fill があり、頭を止められるクリップ）。 */
    fillHead: boolean;
    /** 前のクリップの後ろの余りで制限していない（止め絵の秒数を報告する）。 */
    reportTail: boolean;
    /** 余りの実際の値。頭は出力秒、後ろは不明なら undefined。 */
    headRoomSeconds: number;
    tailRoomSeconds: number | undefined;
}

interface LegacyBoundary {
    kind: 'legacy';
    earlier: number;
    later: number;
    cutSeconds: number;
    declaredSeconds: number;
    /** 前のクリップの末尾側で使う区間（実際の重なり）。 */
    overlapSeconds: number;
    /** 窓の長さ（後のクリップの頭側で使う区間）。 */
    windowSeconds: number;
    coversLater: boolean;
}

type Boundary = NewBoundary | LegacyBoundary;

/**
 * 1 本のトラックのクリップの並び（始まりの順）から、描かれる境目の窓を決める。
 * 結果は順番によらず、新しい形の窓どうしは正の長さで重ならない。
 */
export function planTrackTransitions(
    clips: readonly TransitionPlanClip[],
    options: TransitionPlanOptions
): TransitionBoundaryPlan[] {
    return planTrack(clips, options);
}

function planTrack(
    clips: readonly TransitionPlanClip[],
    options: InternalPlanOptions
): TransitionBoundaryPlan[] {
    const fps = effectiveCutFps(options.fps);
    const boundaries: Array<Boundary | undefined> = [];
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
        const overlapFrames = cutOverlapFrames({ tlEnd: earlierEnd }, { tlStart: later.startSeconds }, fps);
        if (overlapFrames === 0) {
            boundaries.push({
                kind: 'new', earlier: index, later: index + 1, cutSeconds: later.startSeconds,
                align: earlier.transitionOut!.align, declaredSeconds: declared, requested: 0,
                reasons: new Set(), blockedByLegacy: false,
                fillHead: false, reportTail: false, headRoomSeconds: 0, tailRoomSeconds: undefined
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
        if (boundary?.kind !== 'new') continue;
        const earlier = clips[boundary.earlier];
        const later = clips[boundary.later];
        const cutDrift = earlier.startSeconds + earlier.lengthSeconds - boundary.cutSeconds;
        const fill = earlier.transitionOut?.fill === true;
        const knownTailRoom = earlier.tailRoomSeconds === undefined
            ? undefined : Math.max(0, room(earlier.tailRoomSeconds) + cutDrift);
        const knownHeadRoom = room(later.headRoomSeconds);
        boundary.fillHead = fill && later.holdBlocked !== true;
        boundary.reportTail = fill
            || (options.tailRoom === 'ignore' && options.strictTailIndex !== boundary.earlier);
        boundary.headRoomSeconds = knownHeadRoom;
        boundary.tailRoomSeconds = knownTailRoom;
        const tailRoom = knownTailRoom === undefined || boundary.reportTail
            ? Number.POSITIVE_INFINITY : knownTailRoom;
        const headRoom = boundary.fillHead ? Number.POSITIVE_INFINITY : knownHeadRoom;
        const earlierCap = Math.min(ownLength[boundary.earlier], headRoom);
        const laterCap = Math.min(ownLength[boundary.later], tailRoom);
        const requested = Math.max(0, Math.min(boundary.declaredSeconds,
            lengthWithin(boundary.align, earlierCap, laterCap)));
        if (requested < boundary.declaredSeconds - EPSILON) {
            const a = earlierShare(boundary.align, requested);
            const b = laterShare(boundary.align, requested);
            const uses = (share: number, cap: number): boolean => share >= cap - EPSILON;
            if (boundary.align !== 'after-cut') {
                if (uses(a, ownLength[boundary.earlier])) boundary.reasons.add('outgoing-length');
                if (uses(a, headRoom)) boundary.reasons.add('incoming-room');
            }
            if (boundary.align !== 'before-cut') {
                if (uses(b, ownLength[boundary.later])) boundary.reasons.add('incoming-length');
                if (uses(b, tailRoom)) boundary.reasons.add('outgoing-room');
            }
        }
        boundary.requested = requested;
    }

    // 4: 1 つのクリップの両端の窓がぶつかるときだけ、取り合う。
    const tailLimit = new Array<number>(clips.length).fill(Number.POSITIVE_INFINITY);
    const headLimit = new Array<number>(clips.length).fill(Number.POSITIVE_INFINITY);
    for (let index = 0; index < clips.length; index++) {
        const head = index > 0 ? boundaries[index - 1] : undefined;
        const tail = boundaries[index];
        if (!head || !tail) continue;
        if (head.kind === 'legacy' && head.coversLater && tail.kind === 'new') {
            tail.blockedByLegacy = true;
            continue;
        }
        const length = ownLength[index];
        const headUse = head.kind === 'legacy' ? head.windowSeconds : laterShare(head.align, head.requested);
        const tailUse = tail.kind === 'legacy' ? tail.overlapSeconds : earlierShare(tail.align, tail.requested);
        if (!(headUse + tailUse > length + EPSILON)) continue;
        if (head.kind === 'legacy' && tail.kind === 'legacy') continue;
        if (head.kind === 'legacy') tailLimit[index] = Math.max(0, length - headUse);
        else if (tail.kind === 'legacy') headLimit[index] = Math.max(0, length - tailUse);
        else {
            headLimit[index] = Math.max(length / 2, length - tailUse);
            tailLimit[index] = Math.max(length / 2, length - headUse);
        }
    }

    const minimumSeconds = 1 / fps;
    const plans: TransitionBoundaryPlan[] = [];
    for (const boundary of boundaries) {
        if (!boundary) continue;
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
        } else {
            const limited = lengthWithin(boundary.align, tailLimit[boundary.earlier], headLimit[boundary.later]);
            if (limited < effective - EPSILON) {
                effective = Math.max(0, limited);
                reasons.add('neighbor');
            }
        }
        if (effective > 0 && (effective < minimumSeconds - EPSILON
            || cutOverlapFrames(
                { tlEnd: boundary.cutSeconds + laterShare(boundary.align, effective) },
                { tlStart: boundary.cutSeconds - earlierShare(boundary.align, effective) }, fps) < 1)) {
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
            ...freezeOf(boundary, effective)
        });
    }
    return plans;
}

/** 効く長さ effective の窓が、素材の余りを越えて使う分（止め絵になる分）。 */
function freezeOf(boundary: NewBoundary, effective: number): Pick<TransitionBoundaryPlan,
    'freezeIncomingSeconds' | 'freezeOutgoingSeconds' | 'freezeOutgoingUnknown'> {
    const over = (used: number, available: number): number => {
        const excess = used - available;
        return excess > EPSILON ? excess : 0;
    };
    const before = effective > 0 ? earlierShare(boundary.align, effective) : 0;
    const after = effective > 0 ? laterShare(boundary.align, effective) : 0;
    const freezeIncomingSeconds = boundary.fillHead ? over(before, boundary.headRoomSeconds) : 0;
    if (!boundary.reportTail) return { freezeIncomingSeconds, freezeOutgoingSeconds: 0 };
    if (boundary.tailRoomSeconds === undefined) {
        return after > EPSILON
            ? { freezeIncomingSeconds, freezeOutgoingSeconds: after, freezeOutgoingUnknown: true }
            : { freezeIncomingSeconds, freezeOutgoingSeconds: 0 };
    }
    return { freezeIncomingSeconds, freezeOutgoingSeconds: over(after, boundary.tailRoomSeconds) };
}

export interface TransitionAlignChoice {
    align: TransitionAlign;
    /** 止め絵で埋めると、埋めないときより 1 コマ以上長く効く。true のとき plan は fill つきで計画した結果。 */
    needsFill: boolean;
    plan: TransitionBoundaryPlan;
    /** この選び方で窓の長さが変わる、ほかの境目。 */
    neighborChanges: readonly TransitionBoundaryPlan[];
}

/**
 * earlierId の末尾の境目に付けるときの寄せ方を選ぶ。隣の境目は渡された値のまま固定する。
 * 止め絵なしの候補は、前のクリップの後ろの余りが不明なら 0 として選ぶ（分からない側に頼らない）。
 * allowFill のときは、止め絵で埋めると 1 コマ以上長く効く場合だけ、いちばん長く効く置き方のうち
 * 止め絵がいちばん少ないものを fill つきで返す（後ろの余りが不明なら、後ろへ入る分をすべて止め絵と数える）。
 */
export function chooseTransitionAlign(
    clips: readonly TransitionPlanClip[],
    earlierId: string,
    declaredSeconds: number,
    options: TransitionPlanOptions & { allowFill: boolean }
): TransitionAlignChoice | undefined {
    const index = clips.findIndex(clip => clip.id === earlierId);
    if (index < 0 || index + 1 >= clips.length) return undefined;
    const laterId = clips[index + 1].id;
    const boundaryOf = (plans: readonly TransitionBoundaryPlan[]): TransitionBoundaryPlan | undefined =>
        plans.find(plan => plan.earlierId === earlierId && plan.laterId === laterId);
    const baseline = planTrackTransitions(clips, options);
    type Candidate = { align: TransitionAlign; plan: TransitionBoundaryPlan; plans: TransitionBoundaryPlan[] };
    let best: Candidate | undefined;
    for (const align of TRANSITION_ALIGN_IDS) {
        const candidateClips = clips.map((clip, clipIndex) => clipIndex === index ? {
            ...clip,
            tailRoomSeconds: clip.tailRoomSeconds ?? 0,
            transitionOut: { declaredSeconds, align, fill: false }
        } : clip);
        const plans = planTrack(candidateClips, { ...options, strictTailIndex: index });
        const plan = boundaryOf(plans);
        if (!plan || plan.legacyOverlap) continue;
        if (!best || plan.effectiveSeconds > best.plan.effectiveSeconds + EPSILON) best = { align, plan, plans };
    }
    if (!best) return undefined;
    const neighborChangesOf = (plans: readonly TransitionBoundaryPlan[]): TransitionBoundaryPlan[] => plans.filter(plan => {
        if (plan.earlierId === earlierId && plan.laterId === laterId) return false;
        const before = baseline.find(entry => entry.earlierId === plan.earlierId && entry.laterId === plan.laterId);
        return !before || Math.abs(before.effectiveSeconds - plan.effectiveSeconds) > EPSILON;
    });
    if (options.allowFill) {
        const freezeTotal = (plan: TransitionBoundaryPlan): number =>
            plan.freezeIncomingSeconds + (plan.freezeOutgoingSeconds ?? 0);
        let filled: Candidate | undefined;
        for (const align of TRANSITION_ALIGN_IDS) {
            const candidateClips = clips.map((clip, clipIndex) => clipIndex === index ? {
                ...clip,
                transitionOut: { declaredSeconds, align, fill: true }
            } : clip);
            const plans = planTrack(candidateClips, options);
            const plan = boundaryOf(plans);
            if (!plan || plan.legacyOverlap) continue;
            if (!filled || plan.effectiveSeconds > filled.plan.effectiveSeconds + EPSILON
                || (Math.abs(plan.effectiveSeconds - filled.plan.effectiveSeconds) <= EPSILON
                    && freezeTotal(plan) < freezeTotal(filled.plan) - EPSILON)) {
                filled = { align, plan, plans };
            }
        }
        const frameSeconds = 1 / effectiveCutFps(options.fps);
        if (filled && filled.plan.effectiveSeconds - best.plan.effectiveSeconds >= frameSeconds - EPSILON) {
            return { align: filled.align, needsFill: true, plan: filled.plan,
                neighborChanges: neighborChangesOf(filled.plans) };
        }
    }
    return { align: best.align, needsFill: false, plan: best.plan, neighborChanges: neighborChangesOf(best.plans) };
}

export interface TransitionPlanCutFacts {
    /** 静止画（余りは頭も後ろも無限）。 */
    stillImage: boolean;
    /** 既存のフリーズの長さ（無ければ 0）。表示の長さに足す。 */
    freezeSeconds: number;
    /** 素材の長さ。分かる層だけ渡す。無ければ後ろの余りは不明。 */
    materialDurationSeconds?: number;
    /** 投影済みの並びを読むとき: 最初のコマを at の手前に前出ししている秒数（transitionHold.headSeconds）。 */
    holdHeadSeconds?: number;
    /** 頭を止め絵にできないクリップ。省けば、既存のフリーズがあるときに立つ。 */
    holdBlocked?: boolean;
}

export interface TransitionPlanTrack {
    track: number;
    clips: TransitionPlanClip[];
}

/**
 * レイヤーへ退避した後のカットの並びから、計画用のクリップの並びをトラックごとに作る。
 * クリップの id は、渡された並びの中の番号（文字列）。
 */
export function transitionPlanClipsFromCuts(
    cuts: readonly EditCut[],
    options: TransitionPlanOptions & { resolve: (cut: EditCut, index: number) => TransitionPlanCutFacts }
): TransitionPlanTrack[] {
    const usable: Array<{ cut: EditCut; index: number }> = [];
    cuts.forEach((cut, index) => {
        if (typeof cut?.in === 'number' && Number.isFinite(cut.in)
            && typeof cut?.out === 'number' && Number.isFinite(cut.out) && cut.in < cut.out) {
            usable.push({ cut, index });
        }
    });
    const tracks = new Map<number, TransitionPlanClip[]>();
    for (const segment of computeCutTrackSegments(usable.map(entry => entry.cut))) {
        const { cut, index } = usable[segment.index];
        const facts = options.resolve(cut, index);
        const speed = typeof cut.speed === 'number' && cut.speed > 0 ? cut.speed : 1;
        const freezeSeconds = Number.isFinite(facts.freezeSeconds) && facts.freezeSeconds > 0 ? facts.freezeSeconds : 0;
        const holdHeadSeconds = typeof facts.holdHeadSeconds === 'number' && Number.isFinite(facts.holdHeadSeconds)
            && facts.holdHeadSeconds > 0 ? facts.holdHeadSeconds : 0;
        const transition = cut.transitionOut;
        const clip: TransitionPlanClip = {
            id: String(index),
            // 前出しのある投影済みのクリップは、前出しの始まりから数える（前の境目の重なりが宣言の長さになる）。
            startSeconds: segment.at - holdHeadSeconds,
            lengthSeconds: segment.duration + freezeSeconds + holdHeadSeconds,
            headRoomSeconds: facts.stillImage ? Number.POSITIVE_INFINITY : Math.max(0, cut.in / speed),
            tailRoomSeconds: facts.stillImage ? Number.POSITIVE_INFINITY
                : typeof facts.materialDurationSeconds === 'number' && Number.isFinite(facts.materialDurationSeconds)
                    ? Math.max(0, (facts.materialDurationSeconds - cut.out) / speed) : undefined,
            ...(transition && typeof transition.duration === 'number' && Number.isFinite(transition.duration)
                && transition.duration > 0 ? { transitionOut: {
                    declaredSeconds: transition.duration,
                    align: readTransitionAlign(transition.align),
                    fill: readTransitionFill(transition.fill) === 'freeze'
                } } : {}),
            ...((facts.holdBlocked ?? freezeSeconds > 0) ? { holdBlocked: true } : {})
        };
        const list = tracks.get(segment.track) ?? [];
        list.push(clip);
        tracks.set(segment.track, list);
    }
    return [...tracks.entries()].sort((left, right) => left[0] - right[0])
        .map(([track, clips]) => ({ track, clips }));
}
