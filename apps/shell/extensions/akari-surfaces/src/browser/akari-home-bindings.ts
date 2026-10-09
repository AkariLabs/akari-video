import { interfaces } from '@theia/core/shared/inversify';
import { WidgetFactory } from '@theia/core/lib/browser';
import { AkariProjectListWidget } from './akari-project-list-widget';

/**
 * 1 枚の画面 v0 — ホーム側の追加の束ね口（契約 §3 レーン H）。
 * 司令塔が frontend module に呼び出し行だけ先に配線した空殻。レーン H がここに
 * 「プロジェクト一覧」タブ・開く確認・閉じる などの binding を足す。
 */
export function bindHomeOneShell(bind: interfaces.Bind): void {
    bind(AkariProjectListWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariProjectListWidget.ID,
        createWidget: () => ctx.container.get(AkariProjectListWidget)
    })).inSingletonScope();
}
