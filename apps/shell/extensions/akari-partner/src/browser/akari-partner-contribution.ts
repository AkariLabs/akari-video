import { inject, injectable } from '@theia/core/shared/inversify';
import {
    ApplicationShell,
    FrontendApplication,
    FrontendApplicationContribution,
    WidgetManager
} from '@theia/core/lib/browser';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { VSXExtensionsViewContainer } from '@theia/vsx-registry/lib/browser/vsx-extensions-view-container';
import { AkariPartnerWidget } from './akari-partner-widget';
import { AkariPartnerCatalogWidget } from './akari-partner-catalog-widget';
import { PartnerExtensionUpdater } from './partner-extension-updater';
import { installPartnerTerminalStyle } from './partner-terminal-style';

// パートナーペイン既定幅（契約 §2「パートナーペインは全状態で右側既定 44%」、
// モック mock-2026-07-21-shell-home-chat-first.html の `.app`
// grid-template-columns: 52px 1fr 44%）。
const PARTNER_PANE_DEFAULT_RATIO = 0.44;

// ShellLayoutRestorer（@theia/core/lib/browser/shell/shell-layout-restorer.js）が
// 使う StorageService のキーと同じ値。「保存済みレイアウトが一度も無い」＝
// 真の初回起動の判定に使う（下記 correctFirstLaunchPaneWidth のコメント参照）。
const LAYOUT_STORAGE_KEY = 'layout';

@injectable()
export class AkariPartnerContribution implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(StorageService)
    protected readonly storageService!: StorageService;

    @inject(PartnerExtensionUpdater)
    protected readonly extensionUpdater!: PartnerExtensionUpdater;

    async onStart(app: FrontendApplication): Promise<void> {
        installPartnerTerminalStyle();
        this.applyDefaultPaneWidth(app);

        const onboarding = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
        if (!onboarding.isAttached) {
            await app.shell.addWidget(onboarding, { area: 'right', rank: 100 });
        }
        app.shell.activateWidget(onboarding.id);

        const rawOpenVsx = await this.widgetManager.getOrCreateWidget(VSXExtensionsViewContainer.ID);
        rawOpenVsx?.dispose();
        const catalog = await this.widgetManager.getOrCreateWidget<AkariPartnerCatalogWidget>(AkariPartnerCatalogWidget.FACTORY_ID);
        if (!catalog.isAttached) {
            await this.shell.addWidget(catalog, { area: 'left', rank: 300 });
        }
        void this.extensionUpdater.checkOnStartup();
    }

    /**
     * `onDidInitializeLayout` は `FrontendApplication.start()` で
     * `attachShell()`（= `ApplicationShell` を document へ実際に attach する
     * 処理）の**後**に発火する（frontend-application.js の `start()` を実測:
     * startContributions → attachShell → initializeLayout →
     * fireOnDidInitializeLayout の順）。ここで初めて `clientWidth` 系の計測が
     * 正しい値を返す。真の初回起動（後述の判定）に限り、既定 44% を
     * 実ウィンドウ幅から確定ピクセル値として明示的に補正する。
     */
    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        const hadPersistedLayout = (await this.storageService.getData(LAYOUT_STORAGE_KEY)) !== undefined;
        if (!hadPersistedLayout) {
            this.correctFirstLaunchPaneWidth(app);
        }
        const onboarding = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
        await onboarding.restorePartnerTerminals();
    }

    /**
     * 右パネルの既定幅比率を 44% にする（task.md 指示1・実測当たり所の一つ）。
     *
     * Theia 1.73.1 の SidePanelHandler（apps/shell/node_modules/@theia/core/lib/
     * browser/shell/side-panel-handler.js を実測）は `options.initialSizeRatio` を
     * 「右パネルにまだ一度もサイズが記録されていない（`state.lastPanelSize` が
     * 未設定）」ときの `getDefaultPanelSize()` でのみ参照する。ここで書き換えて
     * おけば、2 回目以降の起動（ユーザーがリサイズ済み）では `restoreLayout()` が
     * `setLayoutData()` 経由で `lastPanelSize` を保存値に上書きするため、この
     * メソッドの実行有無に関わらずユーザーのリサイズが優先される
     * （＝「初期化時のみ既定 44%、毎回強制リセットしない」を自然に満たす）。
     *
     * ただし真の初回起動では **このメソッドだけでは不十分**（実機で確認した
     * 既知の穴）: この widget は `onStart()`（`startContributions()` フェーズ）
     * で右パネルへ追加される最初の widget であり、そのフェーズは
     * `attachShell()`（shell を document に実際に attach する処理）より
     * **前**に完了する（frontend-application.js の `start()` を実測確認）。
     * つまり `addWidget()` が同期的に引き起こす最初の展開（`getDefaultPanelSize()`
     * が `parent.node.clientWidth * ratio` を計算する瞬間）は、右パネルが
     * まだ document に attach されていない状態で走る。この状態の
     * `clientWidth` は実ウィンドウ幅ではなく detached 時のレイアウト値
     * （実測: 1120px 幅のウィンドウで 336px 相当）を返すため、比率は正しくても
     * 得られるピクセル値が小さくなりすぎる（実測: 0.44 のはずが 1120px 中
     * 148px = 13.2% にしかならなかった）。この誤りは初回起動時に一度きり
     * `lastPanelSize` として確定してしまう（2 回目以降は `restoreLayout()` が
     * 正しい保存値で上書きするので実害はない）ため、`onDidInitializeLayout`
     * （shell attach 後）で真の初回起動に限り明示的に補正する
     * （`correctFirstLaunchPaneWidth` 参照）。
     *
     * `SidePanelHandler.options` は protected 宣言だが、Theia は右パネル既定幅を
     * 外部から調整する public API を提供していないため、この 1 プロパティに
     * 限り `as` で越境する。
     */
    protected applyDefaultPaneWidth(app: FrontendApplication): void {
        const handler = app.shell.rightPanelHandler as unknown as { options?: { initialSizeRatio?: number } };
        if (handler.options) {
            handler.options.initialSizeRatio = PARTNER_PANE_DEFAULT_RATIO;
        }
    }

    /**
     * 真の初回起動（`onDidInitializeLayout` 時点で保存済みレイアウトが一件も
     * 無い = `hadPersistedLayout === false`）に限り、shell が document に
     * attach された後の正しい `clientWidth` を使って右パネル幅を明示的に
     * 44% へ補正する（`applyDefaultPaneWidth` の JSDoc 参照）。
     * `shell.resize()` は `SidePanelHandler.resize()` を呼ぶ公開 API
     * （`state.lastPanelSize` を更新 → 以後のユーザーリサイズ・レイアウト
     * 保存はこの正しい値を起点に積み重なる）。
     */
    protected correctFirstLaunchPaneWidth(app: FrontendApplication): void {
        const container = app.shell.rightPanelHandler.container;
        const parent = container.parent;
        if (!parent) {
            return;
        }
        const clientWidth = parent.node.clientWidth;
        if (!clientWidth) {
            return;
        }
        app.shell.resize(Math.round(clientWidth * PARTNER_PANE_DEFAULT_RATIO), 'right');
    }
}
