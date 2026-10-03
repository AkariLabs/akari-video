import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { CATALOG_CATEGORIES } from '../common/catalog-reader';

export const AKARI_CATALOG_ROOT_PREFERENCE = 'akari.catalog.root';

export interface LibraryPaneHost {
    readonly dialogs: Pick<FileDialogService, 'showOpenDialog'>;
    readonly preferences: Pick<PreferenceService, 'get' | 'set'>;
    readonly files: Pick<FileService, 'resolve'>;
    readonly update: () => void;
    readonly loadAssetCatalogView: (intent?: 'automatic' | 'user') => Promise<void>;
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
}
