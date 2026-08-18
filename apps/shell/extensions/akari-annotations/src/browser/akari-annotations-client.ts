import { Emitter, Event } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';
import {
    AkariAnnotationsClient,
    DeferredLintNotification
} from '../common/akari-annotations-protocol';

/**
 * 書き込み完了を拡張間へ配る window イベント名。
 *
 * akari-preview は akari-annotations を import できない（package.json 上 annotations →
 * preview の一方向依存で、逆向きは循環になる）ため、本リポの既存の流儀どおり
 * 「window の CustomEvent + イベント名の文字列定数を両拡張へ重複定義」で渡す
 * （先例: RAW_PREVIEW_ANNOTATION_STATE_EVENT / TIMELINE_OVERLAY_SELECTED_EVENT）。
 * **重複定義の相手は `akari-preview/src/browser/akari-preview-open-handler.ts` の
 * EDIT_STORE_DID_WRITE_EVENT。片方だけ変えると通知が届かなくなる。**
 */
export const EDIT_STORE_DID_WRITE_EVENT = 'akari.editStore.didWrite';

export interface EditStoreDidWriteDetail {
    /** 書けたファイルの URI（file スキーム）。 */
    uri: string;
    /** 書けた全文。受け側はこれを使って再読込 I/O を省ける。 */
    content: string;
}

@injectable()
export class AkariAnnotationsClientImpl implements AkariAnnotationsClient {
    protected readonly willWriteEmitter = new Emitter<string>();
    readonly onWillWriteEvent: Event<string> = this.willWriteEmitter.event;

    protected readonly didWriteEmitter = new Emitter<EditStoreDidWriteDetail>();
    readonly onDidWriteEvent: Event<EditStoreDidWriteDetail> = this.didWriteEmitter.event;

    protected readonly lintResultEmitter = new Emitter<DeferredLintNotification>();
    readonly onLintResultEvent: Event<DeferredLintNotification> = this.lintResultEmitter.event;

    onWillWrite(uri: string): void {
        this.willWriteEmitter.fire(uri);
    }

    onDidWrite(uri: string, content: string): void {
        const detail: EditStoreDidWriteDetail = { uri, content };
        // 拡張間へは window イベントで最短経路で流す（RPC の着弾点でそのまま撒く）。
        // 自拡張の購読者向けの Emitter も同時に立てておく。
        this.didWriteEmitter.fire(detail);
        window.dispatchEvent(new CustomEvent<EditStoreDidWriteDetail>(EDIT_STORE_DID_WRITE_EVENT, { detail }));
    }

    onLintResult(notification: DeferredLintNotification): void {
        this.lintResultEmitter.fire(notification);
    }
}
