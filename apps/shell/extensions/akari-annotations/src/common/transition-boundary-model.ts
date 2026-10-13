import type { TransitionBoundaryPlan, TransitionShortenReason, TransitionAlign } from '@akari-video/edit-store';

/** コマンド ID（文字列の正本）。登録は annotations の contribution が行う。 */
export const TRANSITION_OPEN_PICKER_COMMAND_ID = 'akari.transition.openPicker';
export const TRANSITION_APPLY_TO_ACTIVE_BOUNDARY_COMMAND_ID = 'akari.transition.applyToActiveBoundary';
export const TRANSITION_REMOVE_COMMAND_ID = 'akari.transition.remove';
export const TRANSITION_REVEAL_IN_INSPECTOR_COMMAND_ID = 'akari.transition.revealInInspector';

/**
 * 境目の指し方。クリップの index は編集で変わるので、前後の item ID の組で持つ。
 * 書き込む直前に、この 2 つがまだ隣り合っているかを必ず確かめ直す。
 */
export interface BoundaryRef {
    readonly earlierItemId: string;
    readonly laterItemId: string;
}

export function sameBoundary(a: BoundaryRef | undefined, b: BoundaryRef | undefined): boolean {
    return !!a && !!b && a.earlierItemId === b.earlierItemId && a.laterItemId === b.laterItemId;
}

/** トランジションを付けられない理由。画面はこのコードから一言を出す。 */
export type BoundaryBlock = 'multi-track' | 'track-order' | 'gap' | 'locked';

/** 理由が複数あるときに画面へ出す 1 つを選ぶ順（直しにくいものが先）。 */
export const BOUNDARY_BLOCK_PRIORITY: readonly BoundaryBlock[] = ['multi-track', 'track-order', 'gap', 'locked'];

export function primaryBoundaryBlock(blocks: readonly BoundaryBlock[]): BoundaryBlock | undefined {
    return BOUNDARY_BLOCK_PRIORITY.find(block => blocks.includes(block));
}

/**
 * 宣言を書き換えるときの決まり。種類と尺だけを差し替え、知らない項目
 * （新しい版が足した項目など）はそのまま残す。
 * 置き方（align）と埋め方（fill）は、省けば既存の値を保ち、null を渡せば項目ごと消す
 * （中央に戻す = align を消す）。
 */
export function mergeTransitionDeclaration(
    existing: unknown,
    patch: { type: string; duration: number; align?: string | null; fill?: string | null }
): Record<string, unknown> {
    const base = existing !== null && typeof existing === 'object' && !Array.isArray(existing)
        ? existing as Record<string, unknown> : {};
    const merged: Record<string, unknown> = { ...base, type: patch.type, duration: patch.duration };
    for (const key of ['align', 'fill'] as const) {
        const value = patch[key];
        if (value === null) delete merged[key];
        else if (value !== undefined) merged[key] = value;
    }
    return merged;
}

/**
 * 境目の帯を描くための値。カット点を 0 として、窓がどこからどこまでか、
 * そのうち何秒が止め絵かを返す。
 */
export interface BoundaryPlacement {
    effectiveSeconds: number;
    /** カット点からの相対（<= 0）。 */
    startOffsetSeconds: number;
    /** カット点からの相対（>= 0）。 */
    endOffsetSeconds: number;
    /** 前のクリップが止め絵になる秒（窓の尻側）。 */
    freezeOutgoingSeconds: number;
    /** 後のクリップが止め絵になる秒（窓の頭側）。 */
    freezeIncomingSeconds: number;
    state: 'ok' | 'shortened' | 'dead';
    reasons: readonly TransitionShortenReason[];
    align: TransitionAlign;
    legacyOverlap: boolean;
}

/** トラック計画を帯の表示状態へ写す。計画に無い宣言は効かない境目として扱う。 */
export function placeBoundary(plan: TransitionBoundaryPlan | undefined): BoundaryPlacement {
    return {
        effectiveSeconds: plan?.effectiveSeconds ?? 0,
        startOffsetSeconds: plan?.startOffsetSeconds ?? 0,
        endOffsetSeconds: plan?.endOffsetSeconds ?? 0,
        freezeOutgoingSeconds: 0,
        freezeIncomingSeconds: plan?.freezeIncomingSeconds ?? 0,
        state: !plan || plan.state === 'none' ? 'dead' : plan.state,
        reasons: plan?.reasons ?? [],
        align: plan?.align ?? 'center',
        legacyOverlap: plan?.legacyOverlap ?? false
    };
}

export interface BoundaryBandGeometry {
    /** 帯の左端（カット点からの相対・px）。 */
    leftPx: number;
    widthPx: number;
    /** 帯の中でのカット点の位置（px）。 */
    cutPx: number;
    /** 帯の頭側・尻側の斜線の幅（px）。 */
    freezeIncomingPx: number;
    freezeOutgoingPx: number;
}

export const BOUNDARY_BAND_MIN_WIDTH_PX = 26;

/** 窓を px に直す。最小幅に満たないときは窓の中心を保ったまま広げる。 */
export function boundaryBandGeometry(placement: BoundaryPlacement, pxPerSecond: number): BoundaryBandGeometry {
    const scale = Number.isFinite(pxPerSecond) && pxPerSecond > 0 ? pxPerSecond : 0;
    const naturalWidth = placement.effectiveSeconds * scale;
    const widthPx = Math.max(BOUNDARY_BAND_MIN_WIDTH_PX, naturalWidth);
    const centerPx = ((placement.startOffsetSeconds + placement.endOffsetSeconds) / 2) * scale;
    const leftPx = centerPx - widthPx / 2;
    const ratio = naturalWidth > 0 ? widthPx / naturalWidth : 0;
    // The marker and its halo occupy two pixels at each edge of the band.
    const markerInsetPx = 2;
    return {
        leftPx,
        widthPx,
        cutPx: Math.max(markerInsetPx, Math.min(widthPx - markerInsetPx, -leftPx)),
        freezeIncomingPx: Math.min(widthPx, placement.freezeIncomingSeconds * scale * ratio),
        freezeOutgoingPx: Math.min(widthPx, placement.freezeOutgoingSeconds * scale * ratio)
    };
}

/** 素材の端まで使っているか（クリップの角の三角）。素材の長さが分からなければどちらも false。 */
export function sourceEdgeMarks(input: {
    inSeconds: number;
    outSeconds: number;
    sourceDurationSeconds: number | undefined;
    sourceFps?: number;
    still?: boolean;
}): { atSourceStart: boolean; atSourceEnd: boolean } {
    const duration = input.sourceDurationSeconds;
    if (input.still || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
        return { atSourceStart: false, atSourceEnd: false };
    }
    const fps = typeof input.sourceFps === 'number' && Number.isFinite(input.sourceFps) && input.sourceFps > 0
        ? input.sourceFps : 30;
    const halfFrame = 0.5 / fps;
    return {
        atSourceStart: Number.isFinite(input.inSeconds) && input.inSeconds <= halfFrame,
        atSourceEnd: Number.isFinite(input.outSeconds) && input.outSeconds >= duration - halfFrame
    };
}
