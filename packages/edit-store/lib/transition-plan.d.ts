/**
 * トラック 1 本ぶんのトランジションの計画（窓の位置と長さ）を決める単一定義。
 *
 * 投影する前の、動かないクリップの並びを受け取り、描かれる境目をすべて挙げてからまとめて計画する。
 * 映像の投影・音・タイムラインの帯・lint は、ここで決めた窓を読む。
 */
import { type EditCut } from './edit-store';
export type TransitionAlign = 'center' | 'before-cut' | 'after-cut';
export declare const TRANSITION_ALIGN_IDS: readonly TransitionAlign[];
export declare const TRANSITION_FILL_IDS: readonly 'freeze'[];
export declare function isTransitionAlign(value: unknown): value is TransitionAlign;
/** 省略・知らない値は center として読む。 */
export declare function readTransitionAlign(value: unknown): TransitionAlign;
/** 知らない値は「埋めない」として読む。 */
export declare function readTransitionFill(value: unknown): 'freeze' | undefined;
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
    transitionOut?: {
        declaredSeconds: number;
        align: TransitionAlign;
        fill: boolean;
    };
    /** このクリップの頭は止め絵にできない（既存のフリーズがある）。 */
    holdBlocked?: boolean;
}
export type TransitionShortenReason = 'outgoing-length' | 'incoming-length' | 'outgoing-room' | 'incoming-room' | 'neighbor' | 'too-short';
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
/**
 * 1 本のトラックのクリップの並び（始まりの順）から、描かれる境目の窓を決める。
 * 結果は順番によらず、新しい形の窓どうしは正の長さで重ならない。
 */
export declare function planTrackTransitions(clips: readonly TransitionPlanClip[], options: TransitionPlanOptions): TransitionBoundaryPlan[];
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
export declare function chooseTransitionAlign(clips: readonly TransitionPlanClip[], earlierId: string, declaredSeconds: number, options: TransitionPlanOptions & {
    allowFill: boolean;
}): TransitionAlignChoice | undefined;
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
export declare function transitionPlanClipsFromCuts(cuts: readonly EditCut[], options: TransitionPlanOptions & {
    resolve: (cut: EditCut, index: number) => TransitionPlanCutFacts;
}): TransitionPlanTrack[];
