import { Emitter, Event } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';
import type { EditAudioKeyframe, ReadableTransitionType } from '@akari-video/edit-store';
import type { CaptionBackgroundMode, CaptionTextStyle, CaptionZone } from '../common/caption-store';
import type { CutFraming, CutFramingKeyframe } from './inspector/framing-fields';

export interface TimelineCutSelection {
    kind: 'cut';
    index: number;
    label: string;
    sourceName: string;
    src?: string;
    sourcePath?: string;
    sourceIn: number;
    sourceOut: number;
    outputStart: number;
    outputEnd: number;
    playheadSeconds?: number;
    transform?: { x?: number; y?: number; scale?: number; rotate?: number };
    framing?: CutFraming;
    opacity?: number;
    speed?: number;
    transitionOut?: {
        type: ReadableTransitionType;
        duration: number;
    };
    track?: number;
    trackName: string;
    clipName: string;
}

export interface TimelineCropSnapshot {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface TimelineOverlaySelection {
    kind: 'overlay';
    id: string;
    outputStart: number;
    duration: number;
    track?: number;
    payload: Record<string, unknown>;
    crop?: TimelineCropSnapshot;
    trackName: string;
    clipName: string;
}

export interface TimelineCaptionSelection {
    kind: 'caption';
    id: string;
    text: string;
    sourceStart: number;
    sourceEnd: number;
    /** 削除区間に完全に落ちて射影できない場合は undefined */
    outputStart: number | undefined;
    outputEnd: number | undefined;
    speaker: string | null;
    sourceRef: { segment: number } | null;
    edited: boolean;
    textStyle?: CaptionTextStyle;
    effectiveTextStyle?: CaptionTextStyle;
}

export interface TimelineLayerSelection {
    kind: 'layer';
    id: string;
    layerKind: 'baked' | 'video';
    outputStart: number;
    duration: number;
    src?: string;
    preset?: string;
    params?: Record<string, unknown>;
    transform?: { x?: number; y?: number; scale?: number; rotate?: number };
    crop?: TimelineCropSnapshot;
    opacity?: number;
    blend?: 'normal' | 'screen' | 'multiply' | 'add' | 'difference' | 'darken' | 'lighten'
        | 'overlay' | 'hardlight' | 'softlight';
    chromaKey?: { color: string; similarity?: number; blend?: number };
    track?: number;
    trackName: string;
    clipName: string;
}

export interface TimelineTreeItemSelection {
    kind: 'item';
    id: string;
    itemKind: 'group' | 'bag' | 'part' | 'media' | 'caption' | 'captions'
        | 'telop' | 'filter' | 'item';
    parentId?: string;
    trackId: string;
}

export interface TimelineTreeItemSnapshot extends TimelineTreeItemSelection {
    outputStart: number;
    duration: number;
    durationFrames: number;
    transform?: { x?: number; y?: number; scale?: number; rotate?: number };
    opacity?: number;
    crop?: TimelineCropSnapshot;
    perspective?: Record<string, unknown>;
    keyframes?: readonly Record<string, unknown>[];
    src?: string;
    sourceKind: string;
    trackName: string;
    clipName: string;
}

/** captions 袋の写し / 明示子 / 出した行を captions.json の同じ行選択へ結ぶ。 */
export function captionIdForTreeSelection(
    selection: TimelineTreeItemSelection,
    declaredCaptionId?: string
): string | undefined {
    if (selection.itemKind !== 'caption') return undefined;
    if (declaredCaptionId) return declaredCaptionId;
    const separator = selection.id.lastIndexOf('#');
    return separator >= 0 ? selection.id.slice(separator + 1) : undefined;
}

export interface TimelineClipNameInput {
    id: string;
    src?: unknown;
    preset?: unknown;
    html?: unknown;
    params?: unknown;
    payload?: Record<string, unknown>;
}

/**
 * インスペクターに表示するクリップ名を、実在する宣言値だけから解決する。
 * 未焼成 telop は src を持たないため preset、さらに無ければ安定した item id を使う。
 */
export function resolveTimelineClipName(item: TimelineClipNameInput): string {
    if (typeof item.src === 'string' && item.src.length > 0) {
        return item.src.split('/').pop() || item.src;
    }
    // params は native telop にも存在する。HTML 宣言（html が実在）に限って代表値へ使い、
    // kind:"telop" の src → preset → id という既存名解決は変えない。
    const html = item.html ?? item.payload?.html;
    const params = item.params ?? item.payload?.params;
    if (typeof html === 'string' && params && typeof params === 'object'
        && !Array.isArray(params)) {
        const first = Object.values(params as Record<string, unknown>)[0];
        if (typeof first === 'string' && first.length > 0) {
            return first;
        }
    }
    if (typeof item.preset === 'string' && item.preset.length > 0) {
        return item.preset;
    }
    return item.id;
}

export interface TimelineAudioSelection {
    kind: 'audio';
    id: string;
    audioKind: 'sfx' | 'bgm' | 'narration';
    label: string;
    outputStart: number;
    duration: number;
    gainDb?: number;
    script?: string;
    fadeIn?: number;
    fadeOut?: number;
    ducking?: boolean;
    trackName: string;
    clipName: string;
}

export type TimelineItemSelectionSnapshot =
    | TimelineCutSelection
    | TimelineOverlaySelection
    | TimelineCaptionSelection
    | TimelineLayerSelection
    | TimelineTreeItemSnapshot
    | TimelineAudioSelection;

export interface TimelineMultiSelectionSnapshot {
    kind: 'multi';
    count: number;
    /** kind 非依存の選択実体。今回の一括 write 配線は caption のみ。 */
    items: TimelineItemSelectionSnapshot[];
}

export type TimelineSelectionTarget =
    | { kind: 'cut'; index: number }
    | { kind: 'item'; id: string }
    | { kind: Exclude<TimelineItemSelectionSnapshot['kind'], 'cut'>; id: string };

export type TimelineSelectionSnapshot =
    | TimelineItemSelectionSnapshot
    | TimelineMultiSelectionSnapshot
    | undefined;

type InspectorWriteOperation =
    | {
        kind: 'item-field';
        id: string;
        path: 'transform.x' | 'transform.y' | 'transform.scale' | 'transform.rotate'
            | 'crop.x' | 'crop.y' | 'crop.w' | 'crop.h'
            | 'opacity' | 'blend' | `source.vars.${string}` | `source.params.${string}`
            | 'source.chroma_key.similarity' | 'source.chroma_key.blend';
        value: number | string | boolean | null;
    }
    | { kind: 'cut-speed'; index: number; value: number | null }
    | { kind: 'cut-transform-x'; index: number; value: number | null }
    | { kind: 'cut-transform-y'; index: number; value: number | null }
    | { kind: 'cut-scale'; index: number; value: number | null }
    | { kind: 'cut-rotate'; index: number; value: number | null }
    | { kind: 'cut-opacity'; index: number; value: number | null }
    | { kind: 'cut-framing-crop-x'; index: number; value: number | null }
    | { kind: 'cut-framing-crop-y'; index: number; value: number | null }
    | { kind: 'cut-framing-crop-w'; index: number; value: number | null }
    | { kind: 'cut-framing-crop-h'; index: number; value: number | null }
    | { kind: 'cut-framing-keyframes'; index: number; value: CutFramingKeyframe[] | null }
    | { kind: 'cut-source-in'; index: number; value: number }
    | { kind: 'cut-source-out'; index: number; value: number }
    | { kind: 'layer-transform-x'; id: string; value: number | null }
    | { kind: 'layer-transform-y'; id: string; value: number | null }
    | { kind: 'layer-crop-x'; id: string; value: number | null }
    | { kind: 'layer-crop-y'; id: string; value: number | null }
    | { kind: 'layer-crop-w'; id: string; value: number | null }
    | { kind: 'layer-crop-h'; id: string; value: number | null }
    | { kind: 'layer-scale'; id: string; value: number | null }
    | { kind: 'layer-rotate'; id: string; value: number | null }
    | { kind: 'layer-opacity'; id: string; value: number | null }
    | { kind: 'layer-blend'; id: string; value: string | null }
    | { kind: 'caption-text'; id: string; value: string }
    | { kind: 'caption-speaker'; id: string; value: string | null }
    | { kind: 'caption-style-color'; id: string; value: string }
    | { kind: 'caption-style-size'; id: string; value: number }
    | { kind: 'caption-style-stroke-color'; id: string; value: string }
    | { kind: 'caption-style-stroke-width'; id: string; value: number }
    | { kind: 'caption-style-bg-color'; id: string; value: string }
    | { kind: 'caption-style-bg-opacity'; id: string; value: number }
    | { kind: 'caption-style-bg-radius'; id: string; value: number }
    | { kind: 'caption-style-bg-mode'; id: string; value: CaptionBackgroundMode }
    | { kind: 'caption-style-zone'; id: string; value: CaptionZone }
    | { kind: 'sfx-gain'; id: string; value: number | null }
    | { kind: 'sfx-fade-in'; id: string; value: number | null }
    | { kind: 'sfx-fade-out'; id: string; value: number | null }
    | { kind: 'narration-gain'; id: string; value: number | null }
    | { kind: 'bgm-gain'; value: number | null }
    | { kind: 'bgm-fade-in'; value: number | null }
    | { kind: 'bgm-fade-out'; value: number | null }
    | { kind: 'bgm-ducking'; value: boolean | null }
    | { kind: 'bgm-duck-db'; value: number | null }
    | { kind: 'bgm-duck-attack'; value: number | null }
    | { kind: 'bgm-duck-release'; value: number | null }
    | { kind: 'sfx-ducking'; id: string; value: boolean | null }
    | { kind: 'sfx-duck-db'; id: string; value: number | null }
    | { kind: 'sfx-duck-attack'; id: string; value: number | null }
    | { kind: 'sfx-duck-release'; id: string; value: number | null }
    | {
        kind: 'audio-keyframes';
        id: string;
        audioKind: 'bgm' | 'sfx' | 'narration';
        value: EditAudioKeyframe[] | null;
    }
    | {
        kind: 'audio-auto-level';
        id: string;
        audioKind: 'bgm' | 'sfx' | 'narration';
    }
    | { kind: 'overlay-var'; id: string; name: string; value: string };

/**
 * targets は複数選択の kind 非依存な一括 write 器。未指定なら各 operation の id/index が対象。
 * 現時点で複数 targets を消費するのは caption-style operation だけ。
 */
export type InspectorWriteRequest = InspectorWriteOperation & {
    targets?: readonly TimelineSelectionTarget[];
};

export interface InspectorWriteResult {
    ok: boolean;
    message?: string;
}

export interface TimelineKeyframeSelection {
    kind: 'keyframe';
    itemId: string;
    property: 'transform.x' | 'transform.y' | 'transform.scale' | 'transform.rotate' | 'opacity';
    times: number[];
    easing?: string;
}

export interface KeyframeControlRequest {
    action: 'toggle' | 'previous' | 'next' | 'easing';
    itemId: string;
    property: TimelineKeyframeSelection['property'];
    value?: number;
    easing?: string;
}

/**
 * インスペクターのスクラブドラッグ中に、書き込みなしでプレビューへ即時反映するための
 * ephemeral な通知。対象は cuts/layers の transform/opacity/crop。
 */
export type LivePreviewTarget =
    | { kind: 'cut'; index: number }
    | { kind: 'layer'; id: string }
    | { kind: 'item'; id: string };

export interface LivePreviewRequest {
    target: LivePreviewTarget;
    field: 'x' | 'y' | 'scale' | 'rotate' | 'opacity'
        | 'crop.x' | 'crop.y' | 'crop.w' | 'crop.h';
    value: number;
    easing?: string;
}

/**
 * タイムラインでの選択状態をインスペクターへ受け渡すためのモデル。
 * 読み書きの主体はタイムラインウィジェットで、インスペクターは onChanged を購読して表示を更新する。
 */
@injectable()
export class TimelineSelectionModel {

    protected readonly onChangedEmitter = new Emitter<void>();
    readonly onChanged: Event<void> = this.onChangedEmitter.event;

    protected _snapshot: TimelineSelectionSnapshot;
    protected _treeSelection: TimelineTreeItemSelection | undefined;
    protected _keyframeSelection: TimelineKeyframeSelection | undefined;
    protected _fps = 30;

    /**
     * インスペクターからの編集要求を受け取るブリッジ。実体はタイムラインウィジェットが
     * 初期化時に代入する。
     */
    requestWrite?: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>;

    /**
     * インスペクターのスクラブドラッグ中の ephemeral なライブプレビュー反映ブリッジ。
     * 実体はタイムラインウィジェットが初期化時に代入する（requestWrite と同様）。
     * 書き込みは行わない・pointerup の requestWrite とは独立。
     */
    requestLivePreview?: (request: LivePreviewRequest) => void;
    requestKeyframe?: (request: KeyframeControlRequest) => Promise<InspectorWriteResult>;

    get snapshot(): TimelineSelectionSnapshot {
        return this._snapshot;
    }

    set snapshot(value: TimelineSelectionSnapshot) {
        this._snapshot = value;
        this.onChangedEmitter.fire();
    }

    get treeSelection(): TimelineTreeItemSelection | undefined {
        return this._treeSelection;
    }

    set treeSelection(value: TimelineTreeItemSelection | undefined) {
        this._treeSelection = value;
        this.onChangedEmitter.fire();
    }

    get keyframeSelection(): TimelineKeyframeSelection | undefined {
        return this._keyframeSelection;
    }

    set keyframeSelection(value: TimelineKeyframeSelection | undefined) {
        this._keyframeSelection = value;
        this.onChangedEmitter.fire();
    }

    get fps(): number {
        return this._fps;
    }

    set fps(value: number) {
        if (this._fps === value) {
            return;
        }
        this._fps = value;
        this.onChangedEmitter.fire();
    }
}
