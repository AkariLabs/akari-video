import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication, WidgetManager } from '@theia/core/lib/browser';
import { AkariSettingsWidget } from './akari-settings-widget';

/**
 * 設定を activity bar の 4 番目のアイコンとして左パネルに追加する。
 * onStart（onDidInitializeLayout より後）で追加するため、
 * AkariActivityBarCuration の起動時一括フィルタの対象にはならない
 * （allowlist に akari-settings-widget を明示済みなので、後続の
 * onDidAddWidget 常時フィルタが走っても隠されない）。
 */
@injectable()
export class AkariSettingsContribution implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    async onStart(app: FrontendApplication): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget(AkariSettingsWidget.ID);
        if (!widget.isAttached) {
            app.shell.addWidget(widget, { area: 'left', rank: 400 });
        }
    }
}
