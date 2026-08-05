import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { AkariRoleBucketsWidget } from './akari-role-buckets-widget';
import { AkariProjectModeService } from './akari-project-mode-service';

/**
 * F12「カタログを開く」コマンド（task 2026-08-05-welcome-screen）。
 *
 * 背景（`planning/notes-2026-08-03-owner-feedback-shell-v013.md` F12）:
 * developer mode 中は左パネルの「素材」枠が標準 Explorer に差し替わる
 * （`akari-shell-strip` の `AkariActivityBarCuration` が担当・本タスクの
 * 編集境界外）ため、「＋ カタログから素材をさがす」ボタンごと消え、カタログへの
 * 入口が無くなる。対応はコマンドパレットへの「カタログを開く」1 個の追加。
 *
 * developer mode との衝突回避方式（task.md 指定の「調査して選ぶ」）:
 * `AkariActivityBarCuration` は `ApplicationShell.onDidAddWidget` を購読し、
 * 左パネル（`leftPanelHandler.tabBar`）に何か追加されるたび再走査して、
 * developer mode 中は `akari-role-buckets-widget` を毎回 `close()` してしまう
 * （`isModeMismatched` 判定）。そのため developer mode 中に本コマンドが
 * 素材ウィジェットを 'left' へ addWidget すると、直後の再走査で即座に閉じ
 * 直されてしまい「喧嘩」する。curation は左パネルの tabBar しか見ていない
 * ため、非 dev モードは従来どおり 'left'（サイドバー本来の置き場）へ、
 * developer mode 中だけ 'main'（エディタ領域のタブ）へ逃がすことで衝突を
 * 避ける。これは task.md が明記する最悪許容ケース
 * 「dev モード時はコマンドが素材ウィジェットを一時的に開く」に相当する
 * （`akari-shell-strip` を編集しない範囲で選べる最小の方式）。
 */
export const AkariCatalogCommands = {
    OPEN_CATALOG: {
        id: 'akari.catalog.open',
        label: 'カタログを開く'
    } as Command
};

@injectable()
export class AkariCatalogCommandContribution implements CommandContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(AkariProjectModeService)
    protected readonly modeService!: AkariProjectModeService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(AkariCatalogCommands.OPEN_CATALOG, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariRoleBucketsWidget>(AkariRoleBucketsWidget.ID);
                if (!widget.isAttached) {
                    if (this.modeService.developerMode) {
                        // 'left' に置くと AkariActivityBarCuration の常時フィルタに
                        // 即座に close() される（developer mode 中は Explorer だけを
                        // 許可する出し分けのため）。curation は左パネルの tabBar しか
                        // 見ていないので 'main' へ逃がせば衝突しない。closable を
                        // 明示的に立てる — サイドバー常駐（closable: false）の前提とは
                        // 違い、こちらは「一時的に開く」逃げ道なのでユーザーが
                        // 自分でタブを閉じられるようにする。
                        widget.title.closable = true;
                        this.shell.addWidget(widget, { area: 'main' });
                    } else {
                        this.shell.addWidget(widget, { area: 'left', rank: 100 });
                    }
                }
                await this.shell.activateWidget(widget.id);
                widget.openCatalogView();
            }
        });
    }
}
