import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication, ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { Widget } from '@theia/core/shared/@lumino/widgets';
import { EXPLORER_VIEW_CONTAINER_ID } from '@theia/navigator/lib/browser/navigator-widget-factory';
import { AkariDeveloperModeService } from './akari-developer-mode-service';

/**
 * AKARI Video shell — S15 動的 activity bar curation。
 *
 * 契約 (`contract-2026-07-15-tabshell-v0.md` §5-bis S15) が指摘する PoC の穴:
 * 「起動時フィルタ（`onDidInitializeLayout`）のみだと、VS Code 拡張が後から
 * 自分の view container を activity bar に追加したとき curation の対象外になり
 * 素通りする（実測: 5個目のアイコンとして出現）」。
 *
 * 対策: `onDidInitializeLayout` による起動時一括フィルタに加えて、
 * `ApplicationShell.onDidAddWidget`（左/右/メイン/下部いずれかの dock panel に
 * widget が追加されるたびに fire される Theia 公式イベント）を購読し、
 * 追加のたびに左サイドパネルの tabBar を再走査して allowlist 外を即座に隠す
 * 「常時フィルタ」にする。VS Code 拡張の view container 生成タイミング
 * （起動直後か、拡張アクティベート後の遅延追加かを問わない）に関わらず
 * 効くのが狙い。
 *
 * 実装メモ: `onDidAddWidget` は左パネル以外（メインエリア=タブ、右パネル、
 * 下部パネル）への追加でも fire される。widget 単位でフィルタするのではなく
 * 「イベントをトリガーに毎回、左パネルの tabBar 全体を再走査する」という
 * 単純な reconcile 方式にした（冪等 — 既に隠したものを重複 dispose しても
 * 実害なし、`Widget.dispose()` は複数回呼んでも安全）。
 *
 * ロール別ボタンビュー追加時の拡張（2026-07-20）: 「素材」枠は developer mode
 * によって中身が入れ替わる唯一のアイコンになった。開発者モード ON では
 * 標準 Explorer（`explorer-view-container`、Theia 本体所有）、OFF では
 * `akari-role-buckets-widget`（ロール別ボタン + フラット一覧、akari-project
 * 拡張が実装）を表示する。この 2 つは「非表示側を dispose せず close() のみ
 * （detach）する」特別扱いにしてある — 一度作った Explorer を dispose すると
 * `akari-project` の AkariAssetInspector が一度きりの onStart で足した
 * ネストパートが二度と復元できなくなるため（ViewContainer 全体を disposeする
 * と再生成時に自前で足した子パートは失われる）。detach のみなら状態を保った
 * まま何度でも出し入れできる（`ApplicationShell.addWidget` の JSDoc も
 * 「widget を消すのは close または dispose」と明記している）。
 */

interface CurationEntry {
    /** 実測した widget id（PoC 2026-07-15, Theia 1.73.1 で確定）。 */
    id: string;
    /** 表示ラベルの上書き（null なら変更しない） */
    label: string | null;
}

const ROLE_BUCKETS_WIDGET_ID = 'akari-role-buckets-widget';
const MENU_WIDGET_ID = 'akari-menu-widget';

// 既定 5 アイコン = 素材 / 検索 / パートナー・拡張 / 設定 / メニュー（task.md スコープ2 + 本ラウンド追加分）。
// 「素材」は下記 MODE_SENSITIVE_PAIR の 2 id のどちらか一方だけが常時表示される。
// akari-settings-widget は AkariSettingsContribution.onStart、
// akari-menu-widget は AkariMenuContribution.onStart で追加される自前 widget。
const ALLOWLIST: CurationEntry[] = [
    { id: EXPLORER_VIEW_CONTAINER_ID, label: '素材' },
    { id: ROLE_BUCKETS_WIDGET_ID, label: null },
    { id: 'search-view-container', label: '検索' },
    { id: 'vsx-extensions-view-container', label: 'パートナー / 拡張' },
    { id: 'akari-settings-widget', label: null },
    { id: MENU_WIDGET_ID, label: null }
];

const ALLOW_IDS = new Set(ALLOWLIST.map(e => e.id));
const LABEL_OVERRIDE = new Map(ALLOWLIST.map(e => [e.id, e.label]));

// developer mode に応じてどちらか一方だけを見せる「素材」ペア。
const DEVELOPER_MODE_WIDGET_ID = EXPLORER_VIEW_CONTAINER_ID;
const NON_DEVELOPER_MODE_WIDGET_ID = ROLE_BUCKETS_WIDGET_ID;

@injectable()
export class AkariActivityBarCuration implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;
    @inject(AkariDeveloperModeService)
    protected readonly developerMode!: AkariDeveloperModeService;

    protected shell?: ApplicationShell;
    protected loggedIds = new Set<string>();

    onDidInitializeLayout(app: FrontendApplication): void {
        this.shell = app.shell;
        // 起動時一括フィルタ（PoC 由来、pass 1）。
        this.reconcileLeftPanel('onDidInitializeLayout');
        void this.ensureModeAppropriateAssetView('onDidInitializeLayout');
        void this.ensureMenuWidgetAttachment('onDidInitializeLayout');

        // S15 常時フィルタ: 左パネルに何か追加されるたび（VS Code 拡張の
        // 遅延 view container 追加を含む）に再走査する。
        //
        // 検証済み（task 2026-07-15-shell-sa-foundation, report.md 参照）:
        // 起動 3 秒後に allowlist 外の widget を左パネルへ直接 addWidget する
        // 一時テストコードで実測し、onDidAddWidget イベントが実際に fire して
        // 5個目のアイコンが即座に隠されることをログ + スクリーンショットで
        // 確認済み（`evidence/theia-start-s15-testwidget.log` /
        // `evidence/03-s15-dynamic-test-4icons-after-late-add.png`）。
        // テストコード自体は納品物から除去済み（本コメントに実測結果のみ残す）。
        app.shell.onDidAddWidget((widget: Widget) => {
            this.reconcileLeftPanel(`onDidAddWidget:${widget.id}`);
        });

        // developer mode の切り替え時に「素材」の表示先を即座に入れ替える。
        // トグルはアプリ再起動なしに反映される想定（task.md 要件）。
        this.developerMode.onDidChange(() => {
            void this.ensureModeAppropriateAssetView('developerModeChanged');
        });
    }

    /**
     * 現在の developer mode に合う側（explorer-view-container もしくは
     * akari-role-buckets-widget）を作る/取り出し、左パネルへ未接続なら
     * 追加する。もう一方が表示中なら reconcileLeftPanel が close() で退避する。
     * 2026-07-30 裁定 R2 により、シェルは工程をゲートせずサーフェスを常時提供する。
     * 工程の状態管理はエージェント + ファイルが担う。
     */
    protected async ensureModeAppropriateAssetView(trigger: string): Promise<void> {
        const shell = this.shell;
        if (!shell) {
            return;
        }
        const showId = this.developerMode.isEnabled ? DEVELOPER_MODE_WIDGET_ID : NON_DEVELOPER_MODE_WIDGET_ID;
        const widget = await this.widgetManager.getOrCreateWidget(showId);
        if (!widget.isAttached) {
            await shell.addWidget(widget, { area: 'left', rank: 100 });
        }
        this.reconcileLeftPanel(trigger);
    }

    /**
     * メニュー（`akari-menu-widget`）は常時 1 種類の widget なので、
     * 無ければ作り、既存なら再アタッチする。
     */
    protected async ensureMenuWidgetAttachment(trigger: string): Promise<void> {
        const shell = this.shell;
        if (!shell) {
            return;
        }
        const widget = await this.widgetManager.getOrCreateWidget(MENU_WIDGET_ID);
        if (!widget.isAttached) {
            await shell.addWidget(widget, { area: 'left', rank: 500 });
        }
        this.reconcileLeftPanel(trigger);
    }

    protected reconcileLeftPanel(trigger: string): void {
        const shell = this.shell as unknown as {
            leftPanelHandler?: {
                tabBar?: {
                    titles: Iterable<{ owner: { id: string; dispose(): void; close(): void; isDisposed: boolean }; label: string }>;
                };
            };
        } | undefined;
        const tabBar = shell?.leftPanelHandler?.tabBar;
        if (!tabBar) {
            console.warn('[akari-shell-strip] leftPanelHandler.tabBar not found — Theia internal API may have changed.');
            return;
        }

        for (const title of Array.from(tabBar.titles)) {
            const id = title.owner.id;
            if (title.owner.isDisposed) {
                continue;
            }
            if (this.isHidden(id)) {
                // developer mode に合わない側（Explorer もしくはロールバケット）は
                // dispose せず close() のみ（detach）。モード切り替え時に再利用する。
                console.info(`[akari-shell-strip] closing hidden left activity bar widget (trigger=${trigger}):`, id);
                title.owner.close();
                continue;
            }
            if (!this.loggedIds.has(id)) {
                this.loggedIds.add(id);
                // 診断ログ（strip 工数所感の実測材料。新規 id が出るたびに1行追加される）
                console.info(`[akari-shell-strip] left activity bar widget observed (trigger=${trigger}):`, JSON.stringify({ id, label: title.label }));
            }
            if (ALLOW_IDS.has(id)) {
                const overriddenLabel = LABEL_OVERRIDE.get(id);
                if (overriddenLabel) {
                    title.label = overriddenLabel;
                }
                continue;
            }
            // allowlist 外 = 拡張が後から追加したものを含め、即座に隠す。
            console.info(`[akari-shell-strip] hiding non-allowlisted left activity bar widget (trigger=${trigger}):`, id);
            title.owner.dispose();
        }
    }

    /**
     * 素材（Explorer/ロールバケットの対）を developer mode で出し分ける。
     * メニューを含むその他の allowlist widget はここでは隠さない。
     */
    protected isHidden(id: string): boolean {
        if (id === DEVELOPER_MODE_WIDGET_ID || id === NON_DEVELOPER_MODE_WIDGET_ID) {
            return this.isModeMismatched(id);
        }
        return false;
    }

    protected isModeMismatched(id: string): boolean {
        if (id === DEVELOPER_MODE_WIDGET_ID) {
            return !this.developerMode.isEnabled;
        }
        if (id === NON_DEVELOPER_MODE_WIDGET_ID) {
            return this.developerMode.isEnabled;
        }
        return false;
    }
}
