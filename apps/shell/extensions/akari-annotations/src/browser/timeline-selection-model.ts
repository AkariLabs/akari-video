import { Emitter, Event } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';

export interface TimelineCutSelection {
    kind: 'cut';
    index: number;
    label: string;
    sourceName: string;
    sourceIn: number;
    sourceOut: number;
    outputStart: number;
    outputEnd: number;
}

export interface TimelineOverlaySelection {
    kind: 'overlay';
    id: string;
    outputStart: number;
    duration: number;
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
}

export interface TimelineLayerSelection {
    kind: 'layer';
    id: string;
    layerKind: 'baked' | 'video';
    outputStart: number;
    duration: number;
}

export interface TimelineAudioSelection {
    kind: 'audio';
    id: string;
    audioKind: 'sfx' | 'bgm';
    label: string;
    outputStart: number;
    duration: number;
}

export type TimelineSelectionSnapshot =
    | TimelineCutSelection
    | TimelineOverlaySelection
    | TimelineCaptionSelection
    | TimelineLayerSelection
    | TimelineAudioSelection
    | undefined;

/**
 * タイムラインでの選択状態をインスペクターへ受け渡すためのモデル。
 * 読み書きの主体はタイムラインウィジェットで、インスペクターは onChanged を購読して表示するだけ（読み取り専用）。
 */
@injectable()
export class TimelineSelectionModel {

    protected readonly onChangedEmitter = new Emitter<void>();
    readonly onChanged: Event<void> = this.onChangedEmitter.event;

    protected _snapshot: TimelineSelectionSnapshot;
    protected _fps = 30;

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
