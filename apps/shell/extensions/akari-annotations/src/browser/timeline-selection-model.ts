import { Emitter, Event } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';

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
    transform?: { x?: number; y?: number; scale?: number; rotate?: number };
    opacity?: number;
    speed?: number;
    transitionOut?: { type: 'dissolve' | 'fade-black' | 'fade-white'; duration: number };
    track?: number;
}

export interface TimelineOverlaySelection {
    kind: 'overlay';
    id: string;
    outputStart: number;
    duration: number;
    track?: number;
    payload: Record<string, unknown>;
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
}

export interface TimelineLayerSelection {
    kind: 'layer';
    id: string;
    layerKind: 'baked' | 'video';
    outputStart: number;
    duration: number;
    src: string;
    preset?: string;
    transform?: { x?: number; y?: number; scale?: number; rotate?: number };
    opacity?: number;
    blend?: 'normal' | 'screen' | 'multiply' | 'add' | 'difference' | 'darken' | 'lighten'
        | 'overlay' | 'hardlight' | 'softlight';
    chromaKey?: { color: string; similarity?: number; blend?: number };
    track?: number;
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
}

export type TimelineSelectionSnapshot =
    | TimelineCutSelection
    | TimelineOverlaySelection
    | TimelineCaptionSelection
    | TimelineLayerSelection
    | TimelineAudioSelection
    | { kind: 'multi'; count: number }
    | undefined;

export type InspectorWriteRequest =
    | { kind: 'cut-speed'; index: number; value: number | null }
    | { kind: 'cut-transform-x'; index: number; value: number | null }
    | { kind: 'cut-transform-y'; index: number; value: number | null }
    | { kind: 'cut-scale'; index: number; value: number | null }
    | { kind: 'cut-rotate'; index: number; value: number | null }
    | { kind: 'cut-opacity'; index: number; value: number | null }
    | { kind: 'cut-source-in'; index: number; value: number }
    | { kind: 'cut-source-out'; index: number; value: number }
    | { kind: 'layer-transform-x'; id: string; value: number | null }
    | { kind: 'layer-transform-y'; id: string; value: number | null }
    | { kind: 'layer-scale'; id: string; value: number | null }
    | { kind: 'layer-rotate'; id: string; value: number | null }
    | { kind: 'layer-opacity'; id: string; value: number | null }
    | { kind: 'layer-blend'; id: string; value: string | null }
    | { kind: 'caption-text'; id: string; value: string }
    | { kind: 'caption-speaker'; id: string; value: string | null }
    | { kind: 'sfx-gain'; id: string; value: number | null }
    | { kind: 'bgm-gain'; value: number | null }
    | { kind: 'bgm-fade-in'; value: number | null }
    | { kind: 'bgm-fade-out'; value: number | null }
    | { kind: 'bgm-ducking'; value: boolean | null }
    | { kind: 'overlay-var'; id: string; name: string; value: string };

export interface InspectorWriteResult {
    ok: boolean;
    message?: string;
}

/**
 * インスペクターのスクラブドラッグ中に、書き込みなしでプレビューへ即時反映するための
 * ephemeral な通知。対象は cuts/layers の transform/opacity のみ。
 */
export type LivePreviewTarget =
    | { kind: 'cut'; index: number }
    | { kind: 'layer'; id: string };

export interface LivePreviewRequest {
    target: LivePreviewTarget;
    field: 'x' | 'y' | 'scale' | 'rotate' | 'opacity';
    value: number;
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

    get snapshot(): TimelineSelectionSnapshot {
        return this._snapshot;
    }

    set snapshot(value: TimelineSelectionSnapshot) {
        this._snapshot = value;
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
