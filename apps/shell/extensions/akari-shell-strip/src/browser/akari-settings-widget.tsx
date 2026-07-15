import * as React from '@theia/core/shared/react';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';

/**
 * AKARI 設定サーフェス — S-A ではプレースホルダー。
 * activity bar の 4 番目のアイコン（⚙️設定）としての枠を実証する。
 * 品質ティア draft/final・テーマ・developer mode スイッチ・Akari Cloud
 * アカウント等の実項目は v0 の後続タスク（S-C/S-D）のスコープ。
 */
@injectable()
export class AkariSettingsWidget extends ReactWidget {

    static readonly ID = 'akari-settings-widget';

    @postConstruct()
    protected init(): void {
        this.id = AkariSettingsWidget.ID;
        this.title.label = '設定';
        this.title.caption = 'AKARI 設定';
        this.title.iconClass = 'codicon codicon-settings-gear';
        this.title.closable = false;
        this.update();
    }

    protected render(): React.ReactNode {
        return (
            <div style={{ padding: '16px' }}>
                <h3>AKARI 設定</h3>
                <p style={{ opacity: 0.7, fontSize: '0.9em' }}>
                    品質ティア / テーマ / developer mode スイッチは後続タスクの実装スコープ
                    （本タスクはシェル基盤 = S-A のみ）。
                </p>
            </div>
        );
    }
}
