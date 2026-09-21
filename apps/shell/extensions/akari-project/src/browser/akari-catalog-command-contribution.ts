import type { MaterialSwapRequest } from '../common/material-swap-candidates';
import { RESOLVE_LIBRARY_MATERIAL_COMMAND_ID } from '../common/library-asset-placement';
import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AkariCatalogCategorySummary, AkariCatalogFocusOptions, AkariRoleBucketsWidget } from './akari-role-buckets-widget';
import { AkariProjectModeService } from './akari-project-mode-service';
import { AkariWorkflowService } from './akari-workflow-service';
import { AkariProjectService } from '../common/akari-project-protocol';
import {
    AssetCatalogImportRequest,
    AssetCatalogImportResult,
    createAssetCatalogImporter
} from '../common/asset-catalog-import';

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
    } as Command,
    LIST_CATEGORIES: {
        id: 'akari.catalog.listCategories'
    } as Command,
    IMPORT_ASSET: {
        id: 'akari.catalog.importAsset'
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

    @inject(AkariWorkflowService)
    protected readonly workflow!: AkariWorkflowService;

    @inject(AkariProjectService)
    protected readonly projectService!: AkariProjectService;

    @inject(FileService)
    protected readonly files!: FileService;

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    protected readonly importAsset = createAssetCatalogImporter({
        getWorkspaceRoot: () => this.workflow.workspaceRoot?.toString(),
        getCatalogItems: async () => {
            const preferenceRoot = this.preferences.get<string>('akari.catalog.root', '');
            return (await this.projectService.getAssetCatalogView(preferenceRoot)).items;
        },
        resolveAsset: (id, projectRoot) => this.projectService.resolveAsset(id, projectRoot),
        fileExists: (projectRoot, relativePath) => this.files.exists(new URI(projectRoot).resolve(relativePath)),
        readDirectory: async (projectRoot, relativePath) => {
            const stat = await this.files.resolve(new URI(projectRoot).resolve(relativePath));
            return (stat.children ?? []).map(child => ({
                name: child.resource.path.base,
                isFile: !child.isDirectory
            }));
        }
    });

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: 'akari.catalog.openSwap' }, {
            execute: async (request: MaterialSwapRequest) => {
                const target = await registry.executeCommand<MaterialSwapRequest | false>('akari.timeline.beginMaterialSwap', request);
                if (!target) return false;
                await registry.executeCommand(AkariCatalogCommands.OPEN_CATALOG.id);
                const widget = await this.widgetManager.getOrCreateWidget<AkariRoleBucketsWidget>(AkariRoleBucketsWidget.ID);
                return widget.openMaterialSwap(target);
            }
        });
        registry.registerCommand({ id: 'akari.catalog.closeSwap' }, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariRoleBucketsWidget>(AkariRoleBucketsWidget.ID);
                widget.clearMaterialSwap();
            }
        });
        registry.registerCommand({ id: RESOLVE_LIBRARY_MATERIAL_COMMAND_ID }, {
            execute: async (key: string) => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariRoleBucketsWidget>(AkariRoleBucketsWidget.ID);
                return widget.resolveCatalogMaterial(key);
            }
        });
        registry.registerCommand(AkariCatalogCommands.OPEN_CATALOG, {
            execute: async (options?: AkariCatalogFocusOptions): Promise<boolean> => {
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
                return widget.openCatalogView(options);
            }
        });
        registry.registerCommand(AkariCatalogCommands.LIST_CATEGORIES, {
            execute: async (): Promise<AkariCatalogCategorySummary[]> => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariRoleBucketsWidget>(AkariRoleBucketsWidget.ID);
                await widget.loadAssetCatalogView();
                return widget.catalogCategorySummaries();
            }
        });
        registry.registerCommand(AkariCatalogCommands.IMPORT_ASSET, {
            execute: async (request?: AssetCatalogImportRequest): Promise<AssetCatalogImportResult> => {
                const result = await this.importAsset(request);
                if (result.ok === true) {
                    const widget = await this.widgetManager.getOrCreateWidget<AkariRoleBucketsWidget>(AkariRoleBucketsWidget.ID);
                    widget.refreshAfterAssetCatalogImport(`${result.category}/${result.id}`);
                }
                return result;
            }
        });
    }
}
