import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication, ApplicationShell } from '@theia/core/lib/browser';
import { Widget } from '@theia/core/shared/@lumino/widgets';

/**
 * AKARI Video shell — S15 動的 activity bar curation.
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
 */

interface CurationEntry {
    /** 実測した widget id（PoC 2026-07-15, Theia 1.73.1 で確定）。 */
    id: string;
    /** 表示ラベルの上書き（null なら変更しない） */
    label: string | null;
}

// 既定 4 アイコン = 素材 / 検索 / パートナー・拡張 / 設定（task.md スコープ2）。
// PoC の pass 1 診断ログ（`evidence/theia-start-pass*.log`）で確定済みの実測 id を流用。
// akari-settings-widget は本レーンの AkariSettingsContribution.onStart で追加される
// 自前 widget（4番目のアイコン枠）。
const ALLOWLIST: CurationEntry[] = [
    { id: 'explorer-view-container', label: '素材' },
    { id: 'search-view-container', label: '検索' },
    { id: 'vsx-extensions-view-container', label: 'パートナー / 拡張' },
    { id: 'akari-settings-widget', label: null }
];

const ALLOW_IDS = new Set(ALLOWLIST.map(e => e.id));
const LABEL_OVERRIDE = new Map(ALLOWLIST.map(e => [e.id, e.label]));

@injectable()
export class AkariActivityBarCuration implements FrontendApplicationContribution {

    protected shell?: ApplicationShell;
    protected loggedIds = new Set<string>();

    onDidInitializeLayout(app: FrontendApplication): void {
        this.shell = app.shell;
        // 起動時一括フィルタ（PoC 由来、pass 1）。
        this.reconcileLeftPanel('onDidInitializeLayout');

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
    }

    protected reconcileLeftPanel(trigger: string): void {
        const shell = this.shell as unknown as {
            leftPanelHandler?: {
                tabBar?: {
                    titles: Iterable<{ owner: { id: string; dispose(): void; isDisposed: boolean }; label: string }>;
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
}
