import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { QuickInputService } from '@theia/core/lib/browser';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { CATALOG_CATEGORIES, CatalogItemMeta, CatalogViewMode, catalogItemCategoryChipKey } from '../common/catalog-reader';
import { AkariProjectService, AssetCatalogResolverStatus, AssetCatalogViewItem, AssetEntitlementsStatus, PresetShowcaseKind, PresetShowcaseItem } from '../common/akari-project-protocol';
import { composeCatalogAskAgentPrompt, composeCatalogImportPrompt, composeCatalogPackImportPrompt } from '../common/catalog-context-packet';
import { CatalogPackGroup, deriveCatalogEmptyStateKind, deriveCatalogResolverNotice, formatCatalogPackBreakdown, summarizeCatalogPackDistribution } from '../common/asset-catalog-view';
import { rankRecentLibraryItems } from '../common/library-source-view';
import { TRANSITION_VOCABULARY, TransitionType } from '@akari-video/edit-store';
import { TransitionStrip } from './library-shelf-visuals-view';
import { LibraryDotsCorner } from './library-card-view';
import { libraryAssetInfoCard, libraryPresetInfoCard, libraryMenuTargetKey, LibraryInfoCardModel, LibraryMenuTarget } from '../common/library-card-menu';
import { libraryRemovalWarning } from '../common/library-card-context-menu-items';
import { LIBRARY_GROUPS, LibraryGroupDefinition, LibraryCategoryKey, LibraryCategoryDefinition } from '../common/library-home-view';
import { myStylePartLabel, type MyStyle } from '../common/my-style';
import { textAnimationSampleKeyframes } from '../common/text-animation-sample';
import { AKARI_BORDER, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';
import { LIBRARY_HOVER_DESCRIPTION_ID, libraryHoverPreview } from '../common/library-hover-preview';

export const AKARI_CATALOG_ROOT_PREFERENCE = 'akari.catalog.root';
const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';
const LIBRARY_DRAG_MIME = 'application/x-akari-library-item';
const LIBRARY_DRAG_START_EVENT = 'akari.library.dragStart';

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
    readonly files: Pick<FileService, 'resolve' | 'delete'>;
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
    readonly catalogQuery: string;
    readonly libraryFavorites: Set<string>;
    readonly transitionPreviewUrls: Record<string, { preview: string; strip: string }>;
    readonly presetPassesLibraryFilter: (key: string, source?: 'lab' | 'own') => boolean;
    readonly openLibraryMenuAt: (event: React.MouseEvent<HTMLElement>, target: LibraryMenuTarget) => void;
    readonly openLibraryInfo: (target: LibraryMenuTarget, anchor: HTMLElement) => void;
    readonly handleLibraryTransitionDragEnd: () => void;
    readonly renderMyStyles: () => React.ReactNode;
    readonly renderPresetShowcase: (kind: PresetShowcaseKind) => React.ReactNode;
    readonly projectService: Pick<AkariProjectService, 'getLibraryUsage'>;
    readonly messages: Pick<MessageService, 'info' | 'error'>;
    readonly libraryMenuTargetItem: (target: LibraryMenuTarget) => { preset?: PresetShowcaseItem; style?: MyStyle };
    readonly libraryCategoryDefinition: (key: LibraryCategoryKey) => LibraryCategoryDefinition;
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

    protected handleLibraryTransitionDragStart(
        event: React.DragEvent<HTMLElement>,
        transition: { readonly id: TransitionType; readonly labelJa: string }
    ): void {
        const payload: { kind: 'transition'; id: TransitionType; name: string } = {
            kind: 'transition',
            id: transition.id,
            name: transition.labelJa
        };
        event.dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copy';
        window.dispatchEvent(new CustomEvent(LIBRARY_DRAG_START_EVENT, { detail: payload }));
    }

    public renderTransitionLibrary(): React.ReactNode {
        const normalizedQuery = this.host.catalogQuery.trim().toLowerCase();
        const filtered = TRANSITION_VOCABULARY.filter(transition => this.host.presetPassesLibraryFilter(`transition/${transition.id}`) && (!normalizedQuery
            || [transition.labelJa, transition.id, transition.category].join(' ').toLowerCase().includes(normalizedQuery)));
        const categories = Array.from(new Set(TRANSITION_VOCABULARY.map(transition => transition.category)));
        return (
            <div
                data-akari-transition-count={TRANSITION_VOCABULARY.length}
                data-akari-transition-visible-count={filtered.length}
                data-akari-transition-category-count={categories.length}
                style={{ padding: '2px 10px 12px' }}
            >
                {categories.map(category => {
                    const transitions = filtered.filter(transition => transition.category === category);
                    if (!transitions.length) {
                        return undefined;
                    }
                    return (
                        <section key={category} style={{ marginTop: '10px' }}>
                            <div style={{ padding: '4px 0 6px', fontSize: '0.74em', fontWeight: 700, letterSpacing: '0.05em', opacity: 0.7 }}>
                                {category}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: CATALOG_GRID_COLUMNS, gap: CATALOG_GRID_GAP }}>
                                {transitions.map(transition => (
                                    <div
                                        key={transition.id}
                                        role='button'
                                        tabIndex={0}
                                        draggable
                                        data-akari-library-transition={transition.id}
                                        data-akari-hover-preview-src={libraryHoverPreview('transition', undefined, this.host.transitionPreviewUrls[transition.id]?.strip)?.src}
                                        data-akari-hover-preview-kind='transition'
                                        data-akari-hover-preview-strip={this.host.transitionPreviewUrls[transition.id]?.strip}
                                        data-akari-hover-preview-label={transition.labelJa}
                                        aria-describedby={this.host.transitionPreviewUrls[transition.id]?.strip ? LIBRARY_HOVER_DESCRIPTION_ID : undefined}
                                        data-akari-library-category='transition'
                                        data-akari-library-card='grid'
                                        data-akari-favorite={this.host.libraryFavorites.has(`transition/${transition.id}`) ? 'true' : undefined}
                                        title={`${transition.labelJa} — カット境界へドラッグ`}
                                        onDragStart={event => this.handleLibraryTransitionDragStart(event, transition)}
                                        onDragEnd={() => this.host.handleLibraryTransitionDragEnd()}
                                        onContextMenu={event => this.host.openLibraryMenuAt(event, { kind: 'transition', key: `transition/${transition.id}` })}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter' && event.target === event.currentTarget) {
                                                event.preventDefault();
                                                this.host.openLibraryInfo({ kind: 'transition', key: `transition/${transition.id}` }, event.currentTarget);
                                            }
                                        }}
                                        style={{
                                            position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', minWidth: 0,
                                            padding: '9px 5px 7px', cursor: 'grab', borderRadius: `${AKARI_RADIUS.panel}px`,
                                            background: AKARI_SURFACE.raised, border: AKARI_BORDER.ghost
                                        }}
                                    >
                                        <LibraryDotsCorner label={transition.labelJa}
                                            onOpen={anchor => this.host.openLibraryInfo({ kind: 'transition', key: `transition/${transition.id}` }, anchor)} />
                                        <span aria-hidden='true' style={{ display: 'block', width: '100%', aspectRatio: '16 / 9',
                                            overflow: 'hidden', borderRadius: `${AKARI_RADIUS.chip}px` }}>
                                            <TransitionStrip url={this.host.transitionPreviewUrls[transition.id]?.preview}
                                                stripUrl={this.host.transitionPreviewUrls[transition.id]?.strip} />
                                        </span>
                                        <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.69em' }}>
                                            {transition.labelJa}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    );
                })}
                {!filtered.length && <p style={{ opacity: 0.7, padding: '16px 6px' }}>条件に一致するトランジションがありません。</p>}
            </div>
        );
    }

    public renderPresetLibraryBody(kinds: readonly PresetShowcaseKind[]): React.ReactNode {
        if (this.host.catalogLoading) {
            return <p style={{ opacity: 0.7, padding: '16px' }}>読み込み中…</p>;
        }
        const labels: Readonly<Record<PresetShowcaseKind, string>> = {
            lut: 'LUT',
            textanim: 'テキストアニメ',
            textstyle: 'テキストスタイル'
        };
        return (
            <div data-akari-library-preset-sections={kinds.length}>
                {kinds.includes('textstyle') && this.host.renderMyStyles()}
                {kinds.map((kind, index) => (
                    <section key={kind} data-akari-library-preset-section={kind}>
                        {(kinds.length > 1 || index > 0) && (
                            <div style={{
                                position: 'sticky', top: '62px', zIndex: 4, padding: '7px 10px 5px',
                                background: AKARI_SURFACE.card, borderBottom: AKARI_BORDER.hairline,
                                fontSize: '0.76em', fontWeight: 700, letterSpacing: '0.04em'
                            }}>
                                {labels[kind]}
                            </div>
                        )}
                        {this.host.renderPresetShowcase(kind)}
                    </section>
                ))}
                <div style={{ padding: '0 10px 10px' }}>{this.renderCatalogDeveloperLinkRow()}</div>
            </div>
        );
    }

    public playMyStyleSample(container: HTMLDivElement, style: MyStyle): void {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const animation = style.parts.find(part => part.kind === 'motion')?.animation as Record<string, unknown> | undefined;
        const slot = (animation?.in ?? animation?.loop ?? animation?.out) as Record<string, unknown> | undefined;
        const target = container.querySelector<HTMLElement>('[data-akari-my-style-preview]');
        if (!slot || !target) return;
        target.getAnimations().forEach(item => item.cancel());
        const id = typeof slot.id === 'string' ? slot.id : '';
        const sample = textAnimationSampleKeyframes(id, animation?.in ? 'in' : animation?.loop ? 'loop' : 'out',
            typeof slot.amp === 'number' ? slot.amp : undefined,
            typeof slot.duration_sec === 'number' ? slot.duration_sec : undefined);
        target.animate(sample.keyframes, { duration: sample.durationMs, iterations: 1, easing: 'ease-out' });
    }

    public presetShowcaseTitle(item: PresetShowcaseItem): string {
        if (item.kind === 'lut') {
            return [item.description, item.whenToUse].filter(Boolean).join('\n');
        }
        return [item.name, item.category, item.description, item.sampleText].filter(Boolean).join('\n');
    }

    public presetShowcaseIcon(item: PresetShowcaseItem): string {
        if (item.kind === 'lut') {
            return 'codicon codicon-color-mode';
        }
        if (item.kind === 'textanim') {
            return 'codicon codicon-play';
        }
        return 'codicon codicon-symbol-text';
    }

    public libraryInfoModel(target: LibraryMenuTarget): LibraryInfoCardModel | undefined {
        const favorite = this.host.libraryFavorites.has(libraryMenuTargetKey(target));
        if (target.kind === 'asset') {
            const chip = catalogItemCategoryChipKey(target.item);
            const category = (LIBRARY_GROUPS as readonly LibraryGroupDefinition[]).flatMap(group => group.categories)
                .find(candidate => candidate.chipKey === chip);
            const item = this.host.assetCatalogItems.find(entry => entry.key === target.item.key) ?? target.item;
            return libraryAssetInfoCard(item, category?.label ?? item.category, favorite);
        }
        if (target.kind === 'transition') {
            const transition = TRANSITION_VOCABULARY.find(entry => `transition/${entry.id}` === target.key);
            return transition && libraryPresetInfoCard({ key: target.key, kind: 'transition', name: transition.labelJa,
                categoryLabel: 'トランジション', tags: [transition.category] }, favorite);
        }
        const { preset, style } = this.host.libraryMenuTargetItem(target);
        if (preset) {
            return libraryPresetInfoCard({ key: target.key, kind: preset.kind, name: preset.name,
                categoryLabel: this.host.libraryCategoryDefinition(preset.kind).label, tags: [preset.category, ...preset.tags].filter(Boolean) as string[] }, favorite);
        }
        if (style) {
            return libraryPresetInfoCard({ key: target.key, kind: 'mystyle', name: style.name, categoryLabel: 'マイスタイル',
                tags: [style.when_to_use, ...style.parts.map(part => myStylePartLabel(part.kind))], author: style.author }, favorite);
        }
        return undefined;
    }

    public async copyLibraryCredit(text: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
            this.host.messages.info('クレジットをコピーしました');
        } catch (error) {
            this.host.messages.error(`クレジットをコピーできませんでした: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public async removeLibraryItem(item: AssetCatalogViewItem): Promise<void> {
        if (!item.libraryDir) return;
        try {
            const usage = await this.host.projectService.getLibraryUsage();
            const warning = libraryRemovalWarning(item, usage[item.key]?.projects ?? []);
            const confirmed = await new ConfirmDialog({
                title: `${item.title} をライブラリから消しますか？`, msg: warning,
                ok: 'ゴミ箱へ移す', cancel: 'キャンセル'
            }).open();
            if (!confirmed) return;
            await this.host.files.delete(URI.fromFilePath(item.libraryDir), { recursive: true, useTrash: true });
            await this.host.loadAssetCatalogView('user');
        } catch (error) { this.host.messages.error(`ライブラリから消せませんでした: ${String(error)}`); }
    }
}
