import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { CommandService } from '@theia/core/lib/common';
import { QuickInputService } from '@theia/core/lib/browser';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { CATALOG_CATEGORIES, CatalogItemMeta, CatalogViewMode } from '../common/catalog-reader';
import { AssetCatalogResolverStatus, AssetCatalogViewItem, AssetEntitlementsStatus } from '../common/akari-project-protocol';
import { composeCatalogAskAgentPrompt, composeCatalogImportPrompt, composeCatalogPackImportPrompt } from '../common/catalog-context-packet';
import { CatalogPackGroup, deriveCatalogEmptyStateKind, deriveCatalogResolverNotice, formatCatalogPackBreakdown, summarizeCatalogPackDistribution } from '../common/asset-catalog-view';
import { rankRecentLibraryItems } from '../common/library-source-view';
import { AKARI_BORDER } from '../common/akari-surface-tokens';

export const AKARI_CATALOG_ROOT_PREFERENCE = 'akari.catalog.root';
const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';

// 一般ユーザー向けの空状態文言（原因別。catalog-account-first-ux task.md §2）。
// どちらも `akari.catalog.root` という preference 名・「カタログの場所」という内部語を含まない
// — それらは開発者向け折りたたみ（renderDeveloperCatalogPanel）の中でのみ表記する。
const CATALOG_FETCH_FAILED_MESSAGE = '素材カタログを取得できませんでした。接続を確認して再試行してください。';
const CATALOG_EMPTY_MESSAGE = 'カタログに素材がまだありません。';

// 320px 前後のパネルでも左右 padding 20px を差し引いた幅へ 3 列を保証する。
export const CATALOG_GRID_GAP = '8px';
export const CATALOG_GRID_COLUMNS =
    'repeat(auto-fill, minmax(min(96px, calc(33.333% - 6px)), 1fr))';

export interface LibraryPaneHost {
    readonly dialogs: Pick<FileDialogService, 'showOpenDialog'>;
    readonly preferences: Pick<PreferenceService, 'get' | 'set'>;
    readonly files: Pick<FileService, 'resolve'>;
    readonly update: () => void;
    readonly loadAssetCatalogView: (intent?: 'automatic' | 'user') => Promise<void>;
    readonly commandService: Pick<CommandService, 'executeCommand'>;
    readonly quickInputService: Pick<QuickInputService, 'input'>;
    readonly catalogResolver: AssetCatalogResolverStatus | undefined;
    readonly catalogEntitlementsStatus: AssetEntitlementsStatus;
    readonly catalogLoading: boolean;
    readonly catalogViewMode: CatalogViewMode;
    readonly assetCatalogItems: AssetCatalogViewItem[];
    readonly renderCatalogItem: (item: AssetCatalogViewItem) => React.ReactNode;
}

export class AkariLibraryPane {
    public catalogPickError?: string;
    protected catalogPicking = false;
    /**
     * 「開発者向け: ローカルカタログを追加」折りたたみの開閉状態。空状態内の `<details>` と
     * 一覧表示中のヘッダ小リンク（renderCatalogDeveloperLinkRow）が同じ状態を共有する
     * （task.md 指示3「同じ導線に到達できる」）。既定は閉。
     */
    protected developerCatalogOpen = false;

    constructor(protected readonly host: LibraryPaneHost) {}

    /**
     * 空状態の「フォルダを選ぶ」ボタン。ネイティブフォルダ選択 → 妥当性検証 →
     * 合格なら preference（akari.catalog.root）を User スコープへ書き込む
     * （再起動後も効くように — ワークスペース依存にしない）。書き込み後は
     * onPreferenceChanged 経由でも loadAssetCatalogView() が走るが、体感を待たせないよう
     * ここでも明示的に再読込する。不合格・キャンセル時は preference を書き換えない。
     */
    protected async pickCatalogFolder(): Promise<void> {
        const destination = await this.host.dialogs.showOpenDialog({
            title: 'カタログの場所を選ぶ',
            canSelectFiles: false,
            canSelectFolders: true
        });
        if (!destination) {
            return;
        }
        this.catalogPicking = true;
        this.catalogPickError = undefined;
        this.host.update();
        const validation = await this.validateCatalogFolder(destination);
        if (validation.valid === false) {
            this.catalogPicking = false;
            this.catalogPickError = validation.reason;
            this.host.update();
            return;
        }
        await this.host.preferences.set(AKARI_CATALOG_ROOT_PREFERENCE, destination.path.fsPath(), PreferenceScope.User);
        this.catalogPicking = false;
        void this.host.loadAssetCatalogView('user');
    }

    /**
     * 直下に task.md 指定のカテゴリディレクトリ（3d/telop/audio/broll/font/luts）が
     * 1 つでもある、または INDEX.md があれば合格とする。どちらもなければ日本語の
     * 理由を返す（呼び出し側がそのまま画面に出す）。
     */
    protected async validateCatalogFolder(uri: URI): Promise<{ valid: true } | { valid: false; reason: string }> {
        let stat: FileStat;
        try {
            stat = await this.host.files.resolve(uri);
        } catch {
            return { valid: false, reason: '選んだフォルダーを読み込めませんでした。もう一度お試しください。' };
        }
        const children = stat.children ?? [];
        const hasIndex = children.some(child => !child.isDirectory && child.resource.path.base === 'INDEX.md');
        const hasCategoryDirectory = children.some(
            child => child.isDirectory && (CATALOG_CATEGORIES as readonly string[]).includes(child.resource.path.base)
        );
        if (hasIndex || hasCategoryDirectory) {
            return { valid: true };
        }
        return {
            valid: false,
            reason: '選んだフォルダーにカタログの内容が見つかりません'
                + '（scene3d・overlay・still・audio・broll・font・textstyle のいずれかのフォルダー、または INDEX.md が必要です）。'
        };
    }

    /**
     * ローカルカタログ追加パネルの中身（フォルダ選択ボタン + 現在の設定値 + 妥当性エラー）。
     * 折りたたみ内のみで使う語彙なので `akari.catalog.root` の表記可（task.md 指示3）。
     * pickCatalogFolder() / validateCatalogFolder() 自体は無変更（2026-07-25-catalog-root-fix
     * の既存挙動をそのまま流用）。
     */
    protected renderDeveloperCatalogPanelBody(): React.ReactNode {
        const currentValue = this.host.preferences.get<string>(AKARI_CATALOG_ROOT_PREFERENCE, '');
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px' }}>
                <p data-akari-catalog-root-value style={{ margin: 0, fontSize: '0.8em', opacity: 0.7 }}>
                    現在の設定（{AKARI_CATALOG_ROOT_PREFERENCE}）: {currentValue || '未設定'}
                </p>
                <button
                    type='button'
                    className='theia-button secondary'
                    disabled={this.catalogPicking}
                    onClick={() => void this.pickCatalogFolder()}
                >
                    フォルダを選ぶ
                </button>
                {this.catalogPickError && (
                    <p
                        data-akari-catalog-pick-error
                        style={{ margin: 0, color: 'var(--theia-errorForeground)', fontSize: '0.85em' }}
                    >
                        {this.catalogPickError}
                    </p>
                )}
            </div>
        );
    }

    /**
     * 一覧表示中（=空状態が出ない）でもローカルカタログ追加へ到達できる、控えめな開発者向け行
     * （task.md 指示3「目立たせない」）。developerCatalogOpen を空状態側と共有し、開いていれば
     * 同じパネル本体をこの行の下に展開する。
     */
    public renderCatalogDeveloperLinkRow(): React.ReactNode {
        return (
            <div style={{ paddingTop: '2px' }}>
                <button
                    type='button'
                    data-akari-developer-catalog-toggle
                    onClick={() => this.toggleDeveloperCatalogSection()}
                    style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'var(--theia-descriptionForeground, var(--theia-sideBar-foreground))',
                        opacity: 0.6,
                        fontSize: '0.75em',
                        cursor: 'pointer',
                        textDecoration: 'underline'
                    }}
                >
                    開発者向け: ローカルカタログ…
                </button>
                {this.developerCatalogOpen && this.renderDeveloperCatalogPanelBody()}
            </div>
        );
    }

    protected toggleDeveloperCatalogSection(): void {
        this.developerCatalogOpen = !this.developerCatalogOpen;
        this.host.update();
    }

    public catalogPlaceholderIcon(category: string): string {
        switch (category) {
            case 'scene3d': return 'codicon codicon-package';
            case 'overlay': return 'codicon codicon-text-size';
            case 'still': return 'codicon codicon-file-media';
            case 'audio': return 'codicon codicon-unmute';
            case 'broll': return 'codicon codicon-device-camera-video';
            case 'font': return 'codicon codicon-symbol-key';
            default: return 'codicon codicon-file';
        }
    }

    /**
     * origin='local'（ローカル catalog/ 由来。resolver 合成分には無い項目）専用の
     * 「取り込む」「頼む」が要る CatalogItemMeta 形へ戻すアダプタ。catalog-context-packet.ts
     * は既存パケット文言をそのまま維持するため変更しない（フィールド名の対応だけをここで吸収する）。
     */
    public toLocalCatalogItemMeta(item: AssetCatalogViewItem): CatalogItemMeta {
        return {
            id: item.id,
            category: item.category,
            title: item.title,
            description: item.description,
            tags: item.tags,
            when_to_use: item.whenToUse,
            license: item.licenseSpdx ? { spdx: item.licenseSpdx } : undefined,
            source: (item.sourceUrl || item.previewUrl) ? { url: item.sourceUrl, preview_url: item.previewUrl } : undefined
        };
    }

    /** 「取り込む」— 固定パケット。取得・配置は setup-library 系スキルの領分（origin='local' 専用）。 */
    public async importCatalogItem(item: AssetCatalogViewItem): Promise<void> {
        await this.host.commandService.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID, composeCatalogImportPrompt(this.toLocalCatalogItemMeta(item)));
    }

    /** 「頼む」— quick-input 1 行 → 同要素 + when_to_use 先頭 1 文 + 入力文（origin='local' 専用）。 */
    public async askAgentAboutCatalogItem(item: AssetCatalogViewItem): Promise<void> {
        const request = await this.host.quickInputService.input({
            placeHolder: 'この素材で何をしますか'
        });
        if (!request || !request.trim()) {
            return;
        }
        await this.host.commandService.executeCommand(
            PARTNER_INJECT_PROMPT_COMMAND_ID,
            composeCatalogAskAgentPrompt(this.toLocalCatalogItemMeta(item), request)
        );
    }

    /** パック棚ヘッダ「まとめて取り込む」の対象 = パック内の未 installed の free 品目。 */
    protected packImportCandidates(group: CatalogPackGroup): AssetCatalogViewItem[] {
        return group.items.filter(item => !item.installed && item.distribution === 'free');
    }

    /**
     * パック棚ヘッダ「まとめて取り込む」— 個別カードの「取り込む」と同じ思想
     * （アプリ自身は DL しない。定型プロンプトをエージェントへ投げるだけ）。
     * 対象 0 件（全品目が同梱済み or 無料 DL 以外）のときは何もしない
     * （呼び出し側のボタンも disabled にする）。
     */
    protected async importCatalogPack(group: CatalogPackGroup): Promise<void> {
        const candidates = this.packImportCandidates(group);
        if (!candidates.length) {
            return;
        }
        await this.host.commandService.executeCommand(
            PARTNER_INJECT_PROMPT_COMMAND_ID,
            composeCatalogPackImportPrompt(group.pack.title, candidates.map(item => this.toLocalCatalogItemMeta(item)))
        );
    }

    public renderCatalogResolverRetry(): React.ReactNode {
        const notice = deriveCatalogResolverNotice(
            this.host.catalogResolver?.status ?? 'ok',
            this.host.catalogEntitlementsStatus
        );
        if (!notice) {
            return undefined;
        }
        return (
            <div
                data-akari-catalog-retry-row
                data-akari-catalog-entitlements-status={this.host.catalogEntitlementsStatus}
                data-akari-catalog-entitlements-unauthorized={notice.kind === 'unauthorized' ? 'true' : undefined}
                style={{ padding: '6px 10px 0', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78em', opacity: 0.8 }}
            >
                <span>{notice.message}</span>
                {notice.retry && (
                    <button
                        type='button'
                        className='theia-button secondary'
                        data-akari-catalog-retry
                        data-akari-catalog-retry-inline
                        disabled={this.host.catalogLoading}
                        style={{ padding: '1px 8px', fontSize: 'inherit' }}
                        onClick={() => void this.host.loadAssetCatalogView('user')}
                    >
                        再試行
                    </button>
                )}
            </div>
        );
    }

    /**
     * パック棚 1 件分（ヘッダ = タイトル + 内訳 + まとめて取り込む + summary、下にカード群）。
     * data-akari-catalog-pack-* は目視検収・E2E 用のフック。
     */
    public renderCatalogPackSection(group: CatalogPackGroup): React.ReactNode {
        const candidates = this.packImportCandidates(group);
        return (
            <div
                key={`pack:${group.pack.id}`}
                data-akari-catalog-pack={group.pack.id}
                style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 10px 10px', borderBottom: AKARI_BORDER.hairline }}
            >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700 }}>{group.pack.title}</span>
                        <span data-akari-catalog-pack-breakdown style={{ fontSize: '0.78em', opacity: 0.75 }}>
                            {formatCatalogPackBreakdown(summarizeCatalogPackDistribution(group.items))}
                        </span>
                    </div>
                    <button
                        type='button'
                        className='theia-button secondary'
                        disabled={!candidates.length}
                        data-akari-catalog-pack-import
                        title={candidates.length
                            ? `未取得の無料素材 ${candidates.length} 件をまとめてエージェントに取り込ませる`
                            : 'まとめて取り込める未取得の無料素材はありません'}
                        style={{ fontSize: '0.78em', padding: '2px 8px', opacity: candidates.length ? 1 : 0.6 }}
                        onClick={() => void this.importCatalogPack(group)}
                    >
                        まとめて取り込む
                    </button>
                </div>
                {group.pack.summary && (
                    <p style={{ margin: 0, fontSize: '0.78em', opacity: 0.75 }}>{group.pack.summary}</p>
                )}
                <div style={this.host.catalogViewMode === 'grid'
                    ? { display: 'grid', gridTemplateColumns: CATALOG_GRID_COLUMNS, gap: CATALOG_GRID_GAP }
                    : { display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {rankRecentLibraryItems(group.items).map(item => this.host.renderCatalogItem(item))}
                </div>
            </div>
        );
    }

    /**
     * カタログ 0 件の空状態。原因（resolver 取得失敗 / 取得できたが 0 件）で文言を分ける
     * （deriveCatalogEmptyStateKind — task.md 指示2）。resolverStatus が未読み込み（undefined）
     * のときは 'empty' 相当の素直な文言にフォールバックする（catalogLoading=true の間は
     * renderCatalogBody が先に「読み込み中…」を返すため、実際にここへ来るのは
     * 読み込み完了後のみ）。どちらの分岐も `akari.catalog.root` / 「カタログの場所」を
     * 含まない — その 2 語は renderDeveloperCatalogPanelBody の折りたたみ内だけに置く。
     */
    public renderCatalogEmptyState(): React.ReactNode {
        const kind = deriveCatalogEmptyStateKind(this.host.assetCatalogItems.length, this.host.catalogResolver?.status ?? 'ok');
        const resolverFailed = kind === 'resolver-failed';
        return (
            <div
                data-akari-catalog-empty-kind={kind}
                style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}
            >
                <p style={{ margin: 0, opacity: 0.7 }}>
                    {resolverFailed ? CATALOG_FETCH_FAILED_MESSAGE : CATALOG_EMPTY_MESSAGE}
                </p>
            </div>
        );
    }
}
