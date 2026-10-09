import { guardInitLayout } from 'akari-theme/lib/browser/init-layout-guard';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication, ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { Widget } from '@theia/core/shared/@lumino/widgets';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { EXPLORER_VIEW_CONTAINER_ID } from '@theia/navigator/lib/browser/navigator-widget-factory';
import { AkariDeveloperModeService } from './akari-developer-mode-service';
import { computeLeftPanelOrder } from './left-panel-order';
import { LeftRailTooltip, railViewLabel, shouldDismissExpandedRail } from './left-rail-tooltip';
import { AkariScopeService } from './akari-scope-service';
import { AkariExportAvailabilityService } from './akari-export-availability-service';
import { installLeftRailStyle } from './left-rail-style';
import { railDisabledIds, railOpenerCommand, railSelection } from '../common/rail-model';
import {
    AKARI_CATALOG_TAB_BODY_ATTRIBUTE, EXPORT_ONBOARDING_TARGET,
    RAIL_EXPAND_ID, RAIL_PROJECT_OPENER_ID, RAIL_LIBRARY_OPENER_ID, RAIL_SKILLS_WIDGET_ID,
    RAIL_EXPORT_OPENER_ID, RAIL_CHANNEL_WIDGET_ID, RAIL_DEVELOPER_OPENER_ID,
    RAIL_SETTINGS_OPENER_ID, RAIL_ROLE_BUCKETS_WIDGET_ID
} from '../common/rail-ids';

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

/**
 * サイドパネル最上部のタイトル帯（`.theia-sidepanel-toolbar`）を畳むビュー。
 * 素材/ライブラリ面は自前の固定セグメントを最上部に持っており、その上にさらに
 * Theia のタイトル帯（`title.label` = 「素材」）が乗ると二重見出しになる
 * （2026-09-03 オーナー指示「一番上に書いてある『素材』という文字はいらない」）。
 * 検索・パートナー/拡張はツールバー項目を持つので対象にしない。
 */
const TITLE_BAR_SUPPRESSED_IDS = new Set([RAIL_ROLE_BUCKETS_WIDGET_ID]);

/** `ApplicationShell.leftPanelHandler` の、ここで触る分だけの最小形（Theia 内部 API）。 */
interface LeftPanelInternals {
    /** BoxLayout の子。`hide()`/`show()` で帯そのものを出し入れする。 */
    toolBar?: { hide(): void; show(): void; readonly isHidden: boolean };
    tabBar?: {
        titles: Iterable<{ owner: { id: string; dispose(): void; close(): void; isDisposed: boolean }; label: string }>;
        readonly currentTitle?: { owner: { id: string } } | null;
        readonly currentChanged?: { connect(slot: () => void, thisArg?: unknown): void };
    };
}

const ALLOWLIST: CurationEntry[] = [
    { id: RAIL_EXPAND_ID, label: null },
    { id: RAIL_PROJECT_OPENER_ID, label: null },
    { id: RAIL_LIBRARY_OPENER_ID, label: null },
    { id: RAIL_SKILLS_WIDGET_ID, label: null },
    { id: RAIL_EXPORT_OPENER_ID, label: null },
    { id: EXPLORER_VIEW_CONTAINER_ID, label: null },
    { id: 'search-view-container', label: null },
    { id: RAIL_CHANNEL_WIDGET_ID, label: null },
    { id: RAIL_DEVELOPER_OPENER_ID, label: null },
    { id: RAIL_SETTINGS_OPENER_ID, label: null },
    { id: RAIL_ROLE_BUCKETS_WIDGET_ID, label: null }
];

/** 保存レイアウトの順序や後からの追加にかかわらず、ALLOWLIST の順に揃える。 */
const LEFT_PANEL_FIXED_ORDER: readonly string[] = [
    RAIL_EXPAND_ID, RAIL_PROJECT_OPENER_ID, RAIL_LIBRARY_OPENER_ID,
    RAIL_SKILLS_WIDGET_ID, RAIL_EXPORT_OPENER_ID,
    EXPLORER_VIEW_CONTAINER_ID,
    'search-view-container',
    RAIL_CHANNEL_WIDGET_ID, RAIL_DEVELOPER_OPENER_ID, RAIL_SETTINGS_OPENER_ID,
    RAIL_ROLE_BUCKETS_WIDGET_ID
];

const ALLOW_IDS = new Set(ALLOWLIST.map(e => e.id));
const LABEL_OVERRIDE = new Map(ALLOWLIST.map(e => [e.id, e.label]));

// developer mode に応じてどちらか一方だけを見せる「素材」ペア。
const DEVELOPER_MODE_WIDGET_ID = EXPLORER_VIEW_CONTAINER_ID;
const NON_DEVELOPER_MODE_WIDGET_ID = RAIL_ROLE_BUCKETS_WIDGET_ID;

@injectable()
export class AkariActivityBarCuration implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;
    @inject(AkariDeveloperModeService)
    protected readonly developerMode!: AkariDeveloperModeService;
    @inject(CommandService)
    protected readonly commands!: CommandService;
    @inject(MessageService)
    protected readonly messages!: MessageService;
    @inject(AkariScopeService)
    protected readonly scopeService!: AkariScopeService;
    @inject(AkariExportAvailabilityService)
    protected readonly exportAvailability!: AkariExportAvailabilityService;

    protected shell?: ApplicationShell;
    protected loggedIds = new Set<string>();
    protected leftTooltip?: LeftRailTooltip;
    protected catalogObserver?: MutationObserver;
    protected leftRailObserver?: MutationObserver;
    protected leftRailDecorateFrame = 0;
    protected decoratingLeftRail = false;
    protected restoreLeftPanelForProject = false;
    protected railCloseTimer?: number;
    protected railCloseAnimationEnd?: (event: AnimationEvent) => void;

    onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        return guardInitLayout('akari-shell-strip', () => {
            this.shell = app.shell;
            if (this.shell.leftPanelHandler.tabBar) {
                this.installLeftRailInteractions();
            }
            // 起動時一括フィルタ（PoC 由来、pass 1）。
            this.reconcileLeftPanel('onDidInitializeLayout');
            void this.ensureModeAppropriateAssetView('onDidInitializeLayout');

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

            // 左パネルのタブ切り替え（素材 ⇄ 検索 ⇄ パートナー…）ではウィジェットの
            // 追加が起きないので onDidAddWidget では拾えない。タイトル帯の出し入れは
            // tabBar.currentChanged（Lumino シグナル）に直接ぶら下げる。
            this.installLeftRailObservers?.();

            // developer mode の切り替え時に「素材」の表示先を即座に入れ替える。
            // トグルはアプリ再起動なしに反映される想定（task.md 要件）。
            this.developerMode.onDidChange(() => {
                void this.ensureModeAppropriateAssetView('developerModeChanged');
            });
        });
    }

    protected installLeftRailInteractions(): void {
        const tabBar = this.shell?.leftPanelHandler.tabBar;
        if (!tabBar) { return; }
        installLeftRailStyle();
        const renderer = tabBar.renderer as typeof tabBar.renderer & { handleMouseEnterEvent?: (event: MouseEvent) => void };
        renderer.handleMouseEnterEvent = () => undefined;
        if (!this.leftTooltip) { this.leftTooltip = new LeftRailTooltip(tabBar); }
        // 擬似タブは Lumino に選ばせず、コマンドへ直結する。
        tabBar.contentNode.addEventListener('pointerdown', event => {
            if (event.button !== 0) { return; }
            const tab = (event.target as Element | null)?.closest?.('.lm-TabBar-tab');
            const index = tab ? Array.from(tabBar.contentNode.children).indexOf(tab) : -1;
            const id = index >= 0 ? tabBar.titles[index]?.owner.id : undefined;
            if (!id) return;
            if (document.body.getAttribute('data-akari-rail-expanded') === 'closing') {
                event.preventDefault();
                event.stopPropagation();
                if (id === RAIL_EXPAND_ID) this.setExpanded(true);
                return;
            }
            if (id !== RAIL_EXPAND_ID && document.body.getAttribute('data-akari-rail-expanded') === 'true') {
                this.setExpanded(false);
            }
            const command = railOpenerCommand(id);
            const disabled = railDisabledIds(this.scopeService.scope, this.exportAvailability.snapshot.exists).has(id);
            if (!command && id !== RAIL_SKILLS_WIDGET_ID) return;
            if (!command && !disabled) return;
            event.preventDefault();
            event.stopPropagation();
            if (disabled) {
                const message = this.scopeService.scope === 'channel'
                    ? id === RAIL_SKILLS_WIDGET_ID
                        ? 'プロジェクトを開くと、スキルをパートナーに頼めます'
                        : 'プロジェクトを開くと使えます'
                    : '編集まで進むと使えます';
                void this.messages.info(message);
                return;
            }
            if (!command) return;
            if (id === RAIL_EXPAND_ID) {
                this.setExpanded(document.body.getAttribute('data-akari-rail-expanded') !== 'true');
                return;
            }
            void this.commands.executeCommand(command.id, ...(command.args ? [command.args] : [])).catch(() => undefined);
        }, true);
        let clearOutsideClick: (() => void) | undefined;
        document.addEventListener('pointerdown', event => {
            clearOutsideClick?.();
            if (!shouldDismissExpandedRail(document.body.getAttribute('data-akari-rail-expanded'),
                tabBar.node.contains(event.target as Node), event.button)) return;
            event.preventDefault();
            event.stopPropagation();
            this.setExpanded(false);
            const stopFollowingEvent = (following: Event) => {
                following.preventDefault();
                following.stopPropagation();
            };
            const onPointerUp = (following: PointerEvent) => {
                stopFollowingEvent(following);
                document.removeEventListener('pointerup', onPointerUp, true);
            };
            const onMouseUp = (following: MouseEvent) => {
                stopFollowingEvent(following);
                document.removeEventListener('mouseup', onMouseUp, true);
            };
            const onClick = (following: MouseEvent) => {
                stopFollowingEvent(following);
                clear();
            };
            const clear = () => {
                document.removeEventListener('pointerup', onPointerUp, true);
                document.removeEventListener('mouseup', onMouseUp, true);
                document.removeEventListener('click', onClick, true);
                window.clearTimeout(timeout);
                if (clearOutsideClick === clear) clearOutsideClick = undefined;
            };
            document.addEventListener('pointerup', onPointerUp, true);
            document.addEventListener('mouseup', onMouseUp, true);
            document.addEventListener('click', onClick, true);
            const timeout = window.setTimeout(clear, 1000);
            clearOutsideClick = clear;
        }, true);
    }

    protected setExpanded(expanded: boolean): void {
        const body = document.body;
        if (!expanded && body.getAttribute('data-akari-rail-expanded') !== 'true') return;
        const tabBarNode = this.shell?.leftPanelHandler.tabBar?.node;
        if (this.railCloseTimer !== undefined) window.clearTimeout(this.railCloseTimer);
        if (tabBarNode && this.railCloseAnimationEnd) tabBarNode.removeEventListener('animationend', this.railCloseAnimationEnd);
        this.railCloseTimer = undefined;
        this.railCloseAnimationEnd = undefined;
        if (expanded) {
            body.setAttribute('data-akari-rail-expanded', 'true');
            return;
        }
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !tabBarNode) {
            body.removeAttribute('data-akari-rail-expanded');
            return;
        }
        body.setAttribute('data-akari-rail-expanded', 'closing');
        const finish = () => {
            if (body.getAttribute('data-akari-rail-expanded') === 'closing') body.removeAttribute('data-akari-rail-expanded');
            if (this.railCloseTimer !== undefined) window.clearTimeout(this.railCloseTimer);
            tabBarNode.removeEventListener('animationend', onAnimationEnd);
            this.railCloseTimer = undefined;
            this.railCloseAnimationEnd = undefined;
        };
        const onAnimationEnd = (event: AnimationEvent) => {
            if (event.target === tabBarNode && event.animationName === 'akari-rail-slide-out') finish();
        };
        this.railCloseAnimationEnd = onAnimationEnd;
        tabBarNode.addEventListener('animationend', onAnimationEnd);
        this.railCloseTimer = window.setTimeout(finish, 320);
    }

    protected installLeftRailObservers(): void {
        void this.exportAvailability.refresh().then(() => this.reconcileLeftPanelOrder());
        this.leftPanelInternals()?.tabBar?.currentChanged?.connect(() => {
            this.reconcileSidePanelTitleBar();
            this.reconcileLeftPanelOrder();
            this.reconcileLeftPanelScope();
            this.scheduleLeftRailDecoration();
        });
        const contentNode = this.shell?.leftPanelHandler.tabBar?.contentNode;
        if (contentNode && !this.leftRailObserver) {
            this.leftRailObserver = new MutationObserver(() => {
                if (!this.decoratingLeftRail) this.scheduleLeftRailDecoration();
            });
            this.leftRailObserver.observe(contentNode, {
                childList: true, subtree: true, attributes: true, attributeFilter: ['class']
            });
        }
        this.scopeService.onDidChangeScope(() => {
            this.reconcileLeftPanelScope();
            this.reconcileLeftPanelOrder();
        });
        this.reconcileLeftPanelScope();
        this.exportAvailability.onDidChange(() => this.reconcileLeftPanelOrder());
        this.catalogObserver = new MutationObserver(() => this.reconcileLeftPanelOrder());
        this.catalogObserver.observe(document.body, { attributes: true, attributeFilter: [AKARI_CATALOG_TAB_BODY_ATTRIBUTE] });
    }

    protected reconcileLeftPanelScope(): void {
        const shell = this.shell;
        if (shell && this.scopeService.scope === 'channel') {
            if (this.leftPanelInternals()?.tabBar?.currentTitle?.owner.id === RAIL_ROLE_BUCKETS_WIDGET_ID) {
                this.restoreLeftPanelForProject = true;
                void shell.collapsePanel('left');
            }
        } else if (shell && this.restoreLeftPanelForProject) {
            this.restoreLeftPanelForProject = false;
            shell.expandPanel('left');
        }
    }

    /**
     * 現在の developer mode に合う側（explorer-view-container もしくは
     * akari-role-buckets-widget）を作る/取り出し、左パネルへ未接続なら
     * 追加する。もう一方が表示中なら reconcileLeftPanel が close() で退避する。
     * 2026-07-30 裁定 R2 により、シェルは工程をゲートせずサーフェスを常時提供する。
     * 工程の状態管理はエージェント + ファイルが担う。
     *
     * F1（task 2026-08-03-shell-quickwins-feedback）: 起動直後に左パネルの
     * 既定選択が「検索」になってしまう実機不具合の修正。原因は Theia core の
     * `SearchInWorkspaceFrontendContribution.initializeLayout()` が
     * `openView({ activate: false })` を「素材」ウィジェット追加より早い
     * レイアウト初期化フェーズで呼び、空だった左パネルの tabBar に最初に
     * 挿入されたタブとして自動的に current になる（Lumino TabBar は
     * currentIndex が -1 のときだけ新規タブを自動選択する）ため。ここで
     * `shell.revealWidget()` を呼んで「素材」側を tabBar の current に
     * 選び直す — `activateWidget()` と異なり `.activate()`（フォーカス奪取）は
     * 呼ばないため、起動時に意図せず左パネルへキーボードフォーカスが移ることはない。
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
        if (this.developerMode.isEnabled) {
            const search = await this.widgetManager.getOrCreateWidget('search-view-container');
            if (!search.isAttached) { await shell.addWidget(search, { area: 'left', rank: 200 }); }
            const developer = await this.widgetManager.getOrCreateWidget(RAIL_DEVELOPER_OPENER_ID);
            if (!developer.isAttached) await shell.addWidget(developer, { area: 'left', rank: 390 });
        }
        await shell.revealWidget(showId);
        this.reconcileLeftPanelScope();
    }

    protected reconcileLeftPanel(trigger: string): void {
        const tabBar = this.leftPanelInternals()?.tabBar;
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
                const overriddenLabel = railViewLabel(id, EXPLORER_VIEW_CONTAINER_ID) ?? LABEL_OVERRIDE.get(id);
                if (overriddenLabel) {
                    title.label = overriddenLabel;
                }
                continue;
            }
            // allowlist 外 = 拡張が後から追加したものを含め、即座に隠す。
            console.info(`[akari-shell-strip] hiding non-allowlisted left activity bar widget (trigger=${trigger}):`, id);
            title.owner.dispose();
        }

        this.reconcileLeftPanelOrder();
        this.reconcileSidePanelTitleBar();
    }

    protected reconcileLeftPanelOrder(): void {
        const tabBar = this.shell?.leftPanelHandler.tabBar;
        if (!tabBar) {
            return;
        }
        const titles = Array.from(tabBar.titles).filter(title => !title.owner.isDisposed);
        const titlesById = new Map(titles.map(title => [title.owner.id, title]));
        const targetOrder = computeLeftPanelOrder(titles.map(title => title.owner.id), LEFT_PANEL_FIXED_ORDER);
        targetOrder.forEach((id, index) => {
            const title = titlesById.get(id);
            if (title && tabBar.titles[index] !== title) {
                tabBar.insertTab(index, title);
            }
        });
        this.scheduleLeftRailDecoration();
    }

    protected scheduleLeftRailDecoration(): void {
        if (this.leftRailDecorateFrame) return;
        this.leftRailDecorateFrame = requestAnimationFrame(() => {
            this.leftRailDecorateFrame = 0;
            this.decorateLeftRailTabs();
        });
    }

    protected decorateLeftRailTabs(): void {
        const tabBar = this.shell?.leftPanelHandler.tabBar;
        if (!tabBar) return;
        this.decoratingLeftRail = true;
        try {
            const disabled = railDisabledIds(this.scopeService.scope, this.exportAvailability.snapshot.exists);
            const selected = this.scopeService.scope === 'project'
                ? railSelection(document.body.getAttribute(AKARI_CATALOG_TAB_BODY_ATTRIBUTE),
                    tabBar.currentTitle?.owner.id, !this.shell?.isExpanded('left'))
                : undefined;
            const present = new Set(Array.from(tabBar.titles, title => title.owner.id));
            const lowerStart = [RAIL_CHANNEL_WIDGET_ID, RAIL_DEVELOPER_OPENER_ID, RAIL_SETTINGS_OPENER_ID]
                .find(id => present.has(id) && !this.isHidden(id));
            Array.from(tabBar.contentNode.children).forEach((element, index) => {
                if (!(element instanceof HTMLElement)) return;
                const title = tabBar.titles[index];
                const id = title?.owner.id;
                if (!id) return;
                element.setAttribute('data-akari-rail-id', id);
                element.classList.toggle('akari-rail-disabled', disabled.has(id));
                element.classList.toggle('akari-rail-selected', selected === id);
                element.classList.toggle('akari-rail-separator', id === RAIL_EXPORT_OPENER_ID || id === lowerStart);
                element.classList.toggle('akari-rail-lower-start', id === lowerStart);
                element.toggleAttribute('data-akari-rail-hidden', id === RAIL_ROLE_BUCKETS_WIDGET_ID);
                if (id === RAIL_EXPORT_OPENER_ID) element.setAttribute('data-akari-onboarding-target', EXPORT_ONBOARDING_TARGET);
                else element.removeAttribute('data-akari-onboarding-target');
                element.title = disabled.has(id)
                    ? (id === RAIL_EXPORT_OPENER_ID ? '編集まで進むと使えます' : 'プロジェクトを開くと使えます')
                    : title.caption || title.label;
            });
        } finally {
            this.leftRailObserver?.takeRecords();
            this.decoratingLeftRail = false;
        }
    }

    protected leftPanelInternals(): LeftPanelInternals | undefined {
        return (this.shell as unknown as { leftPanelHandler?: LeftPanelInternals } | undefined)?.leftPanelHandler;
    }

    /**
     * 現在の左パネルビューに応じてタイトル帯を出し入れする。
     *
     * CSS の `display: none` ではなく Lumino の `hide()` を使う: この帯は
     * `SidePanelHandler.createContainer()` が組む BoxLayout の子で、Lumino は子を
     * 絶対配置（top/height を実測して書く）する。display だけ消しても下の dockPanel の
     * top オフセットは帯の高さぶん残り、空白の帯になるだけで詰まらない。`hide()` なら
     * BoxLayout の fit/update が非表示の子を飛ばして再計算するのでパネルが上まで詰まる。
     */
    protected reconcileSidePanelTitleBar(): void {
        const handler = this.leftPanelInternals();
        const toolBar = handler?.toolBar;
        if (!toolBar) {
            console.warn('[akari-shell-strip] leftPanelHandler.toolBar not found — Theia internal API may have changed.');
            return;
        }
        const currentId = handler?.tabBar?.currentTitle?.owner.id;
        const suppress = !!currentId && TITLE_BAR_SUPPRESSED_IDS.has(currentId);
        if (suppress === toolBar.isHidden) {
            return;
        }
        if (suppress) {
            toolBar.hide();
        } else {
            toolBar.show();
        }
    }

    /**
     * 素材（Explorer/ロールバケットの対）を developer mode で出し分ける。
     * その他の allowlist widget はここでは隠さない。
     */
    protected isHidden(id: string): boolean {
        if (id === 'search-view-container' || id === RAIL_DEVELOPER_OPENER_ID) { return !this.developerMode.isEnabled; }
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
