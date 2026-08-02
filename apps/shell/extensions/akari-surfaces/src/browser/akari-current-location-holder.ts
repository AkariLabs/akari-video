import { injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';

/**
 * F6（task 2026-08-03-shell-quickwins-feedback）「現在地」の最新値を保持する
 * 小さな共有シングルトン。`AkariHomeWidget` が唯一の書き手（ホーム上部の 1 行
 * 表示と同じ解決結果を書き込む）で、`AkariWindowTitleContribution` が読み手
 * （ウィンドウタイトルへの反映はベストエフォート・task.md 指定）。
 *
 * 作業場の解決（マシンポインタ読み → root.json 検証）は非同期かつ
 * ファイル I/O を伴うため、同期にしか呼べないウィンドウタイトルの
 * `enhanceTitle()` から直接は呼べない。ホーム側の解決結果をこのホルダー経由で
 * 使い回すことで、同じロジックの二重実装を避ける。
 */
export interface AkariCurrentLocationDescriptor {
    kind: 'inside' | 'outside';
    /** 作業場ディレクトリ名（`kind: 'inside'` のときのみ。ウィンドウタイトル用の短い表示名）。 */
    workspaceName?: string;
    channel?: string;
    project?: string;
}

@injectable()
export class AkariCurrentLocationHolder {
    protected _current: AkariCurrentLocationDescriptor | undefined;
    protected readonly onDidChangeEmitter = new Emitter<AkariCurrentLocationDescriptor | undefined>();
    readonly onDidChange: Event<AkariCurrentLocationDescriptor | undefined> = this.onDidChangeEmitter.event;

    get current(): AkariCurrentLocationDescriptor | undefined {
        return this._current;
    }

    set(descriptor: AkariCurrentLocationDescriptor | undefined): void {
        this._current = descriptor;
        this.onDidChangeEmitter.fire(descriptor);
    }
}
