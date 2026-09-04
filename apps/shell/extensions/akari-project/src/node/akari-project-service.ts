import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { execFile, spawn } from 'child_process';
import { createHash } from 'crypto';
import { constants, Dirent, existsSync, promises as fs, watch } from 'fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { promisify } from 'util';
import {
    AkariProjectService,
    AssetCatalogView,
    AssetCatalogViewItem,
    AssetEntitlementsStatus,
    AssetResolveOutcome,
    DiffPreparationResult,
    DiffResourcePair,
    DroppedAsset,
    DroppedAssetImportResult,
    DroppedAssetKind,
    DroppedVideo,
    DroppedVideoImportResult,
    EditLintOutcome,
    MaterialThumbnailOutcome,
    PresetShowcase,
    ProjectCardThumbnailsOutcome,
    ProjectGitEligibility,
    StoreConnectionStatus,
    StoreDevicePollOutcome,
    StoreDevicePollRequest,
    StoreDeviceStartOutcome
} from '../common/akari-project-protocol';
import { deriveThumbnailCacheKey, thumbnailCacheFileName } from './thumbnail-cache';
import {
    deriveEditTimelineSamples,
    deriveProjectCardTimestamps,
    EditTimelineSample,
    parseProjectCardFrameIndex,
    projectCardFrameFileName,
    projectCardFrameRelativePath,
    PROJECT_CARD_CACHE_DIRECTORY,
    PROJECT_CARD_FRAME_COUNT,
    PROJECT_CARD_SOURCE_EXTENSIONS,
    ProjectCardThumbnailOrigin,
    readContactSheetTimestamps,
    readPlannedDurationSeconds,
    RenderStateSummary,
    selectRenderedOutputPath
} from './project-card-thumbnails';
import { CATALOG_ROOT_UPWARD_MAX_DEPTH, resolveUpwardCatalogRoot } from './catalog-root-search';
import { assetResolverSrcCandidates, editLintCliCandidates, presetShowcaseIndexCandidates } from './packaged-tool-candidates';
import { CATALOG_CATEGORIES, parseCatalogItemMeta } from '../common/catalog-reader';
import { deriveAssetDistribution, mergeAssetCatalogViews, ResolverRawCatalogItem, selectResolverAudioFileRef, toResolverAssetCatalogViewItem } from '../common/asset-catalog-view';
import { CatalogPack, parseCatalogPacksFile } from '../common/catalog-packs';
import { resolveResolverPreviewUrl } from './resolver-preview-url';
import { parsePresetShowcaseJsonl } from '../common/preset-showcase';
import {
    pollDeviceConnection,
    readCredentials,
    removeCredentials,
    startDeviceConnection
} from 'akari-video/src/store-device-connect.mjs';

const execFileAsync = promisify(execFile);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function classifyDroppedAssetExtension(name: string): DroppedAssetKind | undefined {
    const ext = extname(name).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) {
        return 'video';
    }
    if (AUDIO_EXTENSIONS.has(ext)) {
        return 'audio';
    }
    if (IMAGE_EXTENSIONS.has(ext)) {
        return 'image';
    }
    return undefined;
}

function isPermissionDenied(error: unknown): boolean {
    return Boolean(error) && typeof error === 'object'
        && ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EACCES');
}

function isAlreadyExists(error: unknown): boolean {
    return Boolean(error) && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

const GATE_MESSAGES: Record<string, string> = {
    'report-generated': 'レポートを作成',
    'report-approved': 'レポートを承認',
    'edit-completed': '編集を完了',
    'export-completed': '動画を書き出し'
};

interface AkariEvent {
    version?: number;
    id?: string;
    type?: string;
    occurredAt?: string;
}

/** カードのコマ 1 枚を抜く指示（どのファイルの・何秒地点か）。 */
interface ProjectCardShot {
    absolutePath: string;
    seconds: number;
}

/**
 * カードの絵をどこから採るかの決定（{@link ProjectCardThumbnailOrigin} の 3 段）。
 * `keyAbsolutePath` はキャッシュ世代の基準になる正本ファイルで、これが変われば作り直る。
 */
type ProjectCardPlan =
    | {
        origin: 'export';
        keyPath: string;
        keyAbsolutePath: string;
        videoPath: string;
        renderState?: RenderStateSummary;
    }
    | {
        origin: 'edit';
        keyPath: string;
        keyAbsolutePath: string;
        samples: EditTimelineSample[];
    }
    | {
        origin: 'material';
        keyPath: string;
        keyAbsolutePath: string;
        videoPath: string;
    };

@injectable()
export class AkariProjectServiceImpl implements AkariProjectService {
    protected readonly watchers = new Map<string, { close(): void }>();
    protected readonly processedEvents = new Set<string>();
    protected readonly pendingEvents = new Map<string, ReturnType<typeof setTimeout>>();
    protected readonly thumbnailGenerationInFlight = new Map<string, Promise<MaterialThumbnailOutcome>>();
    protected readonly projectCardGenerationInFlight = new Map<string, Promise<ProjectCardThumbnailsOutcome>>();
    protected ffmpegPathPromise?: Promise<string | undefined>;
    protected ffprobePathPromise?: Promise<string | undefined>;
    /** Overridable for tests: lets the symlink/junction/copy fallback chain be exercised from mac. */
    protected readonly fsImpl: typeof fs = fs;
    /** Overridable for tests: lets the win32-only junction fallback be exercised from mac. */
    protected readonly platform: NodeJS.Platform = process.platform;

    async getStoreConnectionStatus(): Promise<StoreConnectionStatus> {
        return this.toStoreConnectionStatus(readCredentials());
    }

    async startStoreDeviceConnection(): Promise<StoreDeviceStartOutcome> {
        const result = await startDeviceConnection();
        if (result.status !== 'started') {
            return { status: result.status, error: result.error };
        }
        return {
            status: 'started',
            baseUrl: result.baseUrl,
            deviceCode: result.deviceCode,
            userCode: result.userCode,
            verificationUrl: result.verificationUrl,
            intervalMs: result.intervalMs,
            expiresAt: result.expiresAt
        };
    }

    async pollStoreDeviceConnection(request: StoreDevicePollRequest): Promise<StoreDevicePollOutcome> {
        const result = await pollDeviceConnection({
            baseUrl: request.baseUrl,
            deviceCode: request.deviceCode
        });
        if (result.status === 'approved') {
            return { status: 'approved', connection: this.toStoreConnectionStatus(result.credentials) };
        }
        if (result.status === 'network-error' || result.status === 'error') {
            return { status: result.status, error: result.error };
        }
        return { status: result.status };
    }

    async disconnectStoreAccount(): Promise<boolean> {
        return removeCredentials();
    }

    protected toStoreConnectionStatus(credentials: { email?: string; url?: string } | null): StoreConnectionStatus {
        if (!credentials?.url) {
            return { connected: false };
        }
        return {
            connected: true,
            identifier: credentials.email || credentials.url,
            email: credentials.email,
            url: credentials.url
        };
    }

    async createProject(destinationUri: string): Promise<void> {
        const root = this.fsPath(destinationUri);
        await fs.mkdir(root, { recursive: true });
        const existing = (await fs.readdir(root)).filter(name => name !== '.DS_Store');
        if (existing.length) {
            throw new Error('空のフォルダーを選んでください。既存のファイルは変更していません。');
        }
        const template = await this.findTemplate();
        if (template) {
            await this.copyTemplateTree(template, root);
            // electron-builder excludes .gitignore and .gitkeep from app.asar.
            // Fill only missing files; writeFallbackTemplate never overwrites copied entries.
            await this.writeFallbackTemplate(root);
        } else {
            await this.writeFallbackTemplate(root);
        }
        await this.installProjectSkills(root);
        await this.ensureRuntimeDirectories(root);
        try {
            await this.runGit(root, ['init']);
            await this.runGit(root, ['add', '-A', '--', '.']);
            await this.commitIfChanged(root, 'プロジェクトを作成');
        } catch (error) {
            console.warn('[akari-project] initial git init failed:', error);
        }
        await this.watchProject(destinationUri);
    }

    async isAkariProject(projectUri: string): Promise<boolean> {
        return this.looksLikeAkariProject(this.fsPath(projectUri));
    }

    async convertToProject(projectUri: string): Promise<void> {
        const root = this.fsPath(projectUri);
        await this.writeFallbackTemplate(root);
        await this.installProjectSkills(root);
        await this.ensureRuntimeDirectories(root);
    }

    async getGitEligibility(projectUri: string): Promise<ProjectGitEligibility> {
        return this.gitEligibility(this.fsPath(projectUri));
    }

    /**
     * preferenceRoot が設定されているときはそれだけを検証する（見つからなければ
     * 開発配置へフォールバックしない — ユーザーが明示的に指定した場所を無言で
     * 差し替えると、設定ミスに気づけなくなるため）。未設定のときだけ、
     * findTemplate()/findBundledSkills() と同じ「開発時 cwd 相対 / パッケージ時
     * __dirname 相対」の固定候補 → 見つからなければ __dirname/process.cwd() 起点の
     * 上方探索（最大 8 階層・catalog/INDEX.md の存在で判定）で catalog/ を探す。
     */
    async resolveCatalogRoot(preferenceRoot: string | undefined): Promise<string | undefined> {
        const trimmed = preferenceRoot?.trim();
        if (trimmed) {
            const candidate = trimmed.startsWith('file:') ? fileURLToPath(trimmed) : trimmed;
            return (await this.isDirectory(candidate)) ? pathToFileURL(candidate).toString() : undefined;
        }
        const bundled = await this.findBundledCatalog();
        return bundled ? pathToFileURL(bundled).toString() : undefined;
    }

    protected async findBundledCatalog(): Promise<string | undefined> {
        const candidates = [
            resolve(__dirname, '../catalog'),
            resolve(process.cwd(), '../../catalog'),
            resolve(process.cwd(), 'catalog'),
            resolve(__dirname, '../../../../../../../catalog')
        ];
        for (const candidate of candidates) {
            if (await this.isDirectory(candidate)) {
                return candidate;
            }
        }
        for (const start of [__dirname, process.cwd()]) {
            const match = await resolveUpwardCatalogRoot(
                start,
                CATALOG_ROOT_UPWARD_MAX_DEPTH,
                dir => this.isFile(join(dir, 'catalog', 'INDEX.md'))
            );
            if (match) {
                return join(match, 'catalog');
            }
        }
        return undefined;
    }

    protected async isDirectory(path: string): Promise<boolean> {
        try {
            return (await fs.stat(path)).isDirectory();
        } catch {
            return false;
        }
    }

    protected async isFile(path: string): Promise<boolean> {
        try {
            return (await fs.stat(path)).isFile();
        } catch {
            return false;
        }
    }

    // --- カタログ「1 ビュー」（resolver 合成 + ローカル catalog/ のマージ） ---------------

    /**
     * getAssetCatalogView の本体。resolver 合成分（packages/asset-resolver）と
     * ローカル catalog/ 分を並行取得し、`${category}/${id}` で重複排除する
     * （resolver 側優先。同じ id をローカル catalog/ と resolver 側の両方に置くのは
     * 移行期のみの想定だが、片方だけでも壊れないよう両方に対応する）。
     * resolver 側が到達不能でも例外にせず空配列へフォールバックする（fail-soft — ローカル
     * catalog/ の表示は resolver の可用性に引きずられない）。取得状態自体は `resolver`
     * フィールドで返す — フロントはこれを見て「未取得（オフライン等）」と
     * 「取得できたが 0 件」を区別する（catalog-account-first-ux task.md §1）。
     */
    async getAssetCatalogView(preferenceRoot: string | undefined): Promise<AssetCatalogView> {
        const [resolverResult, local] = await Promise.all([
            this.loadResolverCatalogItems(),
            this.loadLocalCatalogViewItems(preferenceRoot)
        ]);
        return {
            items: mergeAssetCatalogViews(local.items, resolverResult.items),
            packs: local.packs,
            resolver: {
                status: resolverResult.status,
                itemCount: resolverResult.items.length,
                error: resolverResult.error
            },
            entitlementsStatus: resolverResult.entitlementsStatus
        };
    }

    async getPresetShowcase(): Promise<PresetShowcase> {
        const [telop, lut] = await Promise.all([
            this.loadPresetShowcaseIndex('telop'),
            this.loadPresetShowcaseIndex('lut')
        ]);
        return { telop, lut };
    }

    protected async loadPresetShowcaseIndex(kind: 'telop' | 'lut'): Promise<PresetShowcase['telop']> {
        const directory = kind === 'telop' ? 'telop' : 'luts';
        const candidates = presetShowcaseIndexCandidates(__dirname, process.cwd(), directory, this.resourcesPath());
        for (const candidate of candidates) {
            try {
                const raw = await fs.readFile(candidate, 'utf8');
                return parsePresetShowcaseJsonl(raw, kind);
            } catch {
                // 読めない候補は次の開発配置 / パッケージ配置へ進む。
            }
        }
        return [];
    }

    /**
     * ローカル catalog/ の 1 ビュー変換（外部ソース系。「取り込む」「頼む」の対象）。
     * ルート解決は resolveCatalogRoot（既存・frontend の loadCatalog と同じ規約）を
     * そのまま再利用する。meta.json 欠落・壊れは例外にせず黙ってスキップする
     * （catalog-reader.ts の寛容リーダー流儀 — 詳細な欠落件数はこの 1 ビューでは追わない）。
     * installed 判定・分類バッジ導出・パック台帳の読み込みもここで行う（task.md §1）。
     */
    protected async loadLocalCatalogViewItems(preferenceRoot: string | undefined): Promise<{ items: AssetCatalogViewItem[]; packs: CatalogPack[] }> {
        const rootUriString = await this.resolveCatalogRoot(preferenceRoot);
        if (!rootUriString) {
            return { items: [], packs: [] };
        }
        const root = fileURLToPath(rootUriString);
        const [installedKeys, packs] = await Promise.all([
            this.loadInstalledCatalogKeys(root),
            this.loadCatalogPacks(root)
        ]);
        const items: AssetCatalogViewItem[] = [];
        for (const category of CATALOG_CATEGORIES) {
            let entries: string[];
            try {
                entries = await fs.readdir(join(root, category));
            } catch {
                continue;
            }
            for (const entry of entries) {
                const itemDir = join(root, category, entry);
                let raw: string;
                try {
                    raw = await fs.readFile(join(itemDir, 'meta.json'), 'utf8');
                } catch {
                    continue;
                }
                const parsed = parseCatalogItemMeta(raw);
                if (!parsed) {
                    continue;
                }
                const installed = installedKeys.has(`${parsed.category}/${parsed.id}`);
                const localPreviewUrl = await this.resolveLocalCatalogPreviewUrl(itemDir);
                items.push({
                    origin: 'local',
                    key: `${parsed.category}/${parsed.id}`,
                    id: parsed.id,
                    category: parsed.category,
                    title: parsed.title,
                    description: parsed.description,
                    tags: parsed.tags ?? [],
                    licenseSpdx: parsed.license?.spdx,
                    whenToUse: parsed.when_to_use,
                    sourceUrl: parsed.source?.url,
                    previewUrl: localPreviewUrl ?? parsed.source?.preview_url,
                    installed,
                    distribution: deriveAssetDistribution({
                        installed,
                        licenseScope: parsed.license?.scope,
                        remote: parsed.remote,
                        tags: parsed.tags
                    }),
                    sourceAcquisition: parsed.source?.acquisition
                });
            }
        }
        return { items, packs };
    }

    /**
     * `assets/<category>/<id>/` の実体有無（= 同梱済みかどうか）を、カタログルートの
     * 兄弟ディレクトリ `assets/` からカテゴリごとに一括で読み取る。catalog/ と assets/ は
     * リポ直下の兄弟ディレクトリ（公開リポの契約: catalog/ は参照メタデータのみ、
     * assets/ は実際に同梱するファイル）。存在しない・読めないカテゴリは黙ってスキップする
     * （fail-soft — 開発配置でも本番配置でも assets/ 不在は「何も同梱されていない」として扱う）。
     */
    protected async loadInstalledCatalogKeys(catalogRoot: string): Promise<Set<string>> {
        const assetsRoot = join(dirname(catalogRoot), 'assets');
        const installed = new Set<string>();
        for (const category of CATALOG_CATEGORIES) {
            let entries: Dirent[];
            try {
                entries = await fs.readdir(join(assetsRoot, category), { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    installed.add(`${category}/${entry.name}`);
                }
            }
        }
        return installed;
    }

    /**
     * `catalog/<category>/<id>/preview.png` の見本画像を webview がそのまま <img src> に
     * 使える file: URI へ変換する（AssetCatalogViewItem.previewUrl は既に resolver 側の
     * file: URI を受け付ける契約 — resolveResolverPreviewUrl 経由の既存カードで同じ形式が
     * 動作実績あり）。無ければ undefined（呼び出し側は meta.json の source.preview_url へ
     * フォールバックする）。
     */
    protected async resolveLocalCatalogPreviewUrl(itemDir: string): Promise<string | undefined> {
        const previewPath = join(itemDir, 'preview.png');
        return (await this.isFile(previewPath)) ? pathToFileURL(previewPath).toString() : undefined;
    }

    /**
     * `catalog/packs.json`（パック台帳）を読む。不在・壊れた JSON はどちらも例外にせず
     * 空配列（parseCatalogPacksFile 自体が寛容パーサー）。
     */
    protected async loadCatalogPacks(catalogRoot: string): Promise<CatalogPack[]> {
        let raw: string;
        try {
            raw = await fs.readFile(join(catalogRoot, 'packs.json'), 'utf8');
        } catch {
            return [];
        }
        return parseCatalogPacksFile(raw);
    }

    /**
     * resolver 合成カタログ（無料 + 購入済み + 取得状態）の 1 ビュー変換。
     * `packages/asset-resolver` は type:"module" の純 ESM パッケージで、この拡張の
     * バックエンドは tsc の module:"commonjs" でコンパイルされる。動的 import() は
     * commonjs ターゲットだと `require()` へ降格されるため（実測で確認済み — TS 5.4 は
     * dynamic import を Promise.resolve().then(() => require(...)) に変換する）、純
     * ESM ファイルの読み込みには使えない（ERR_REQUIRE_ESM 相当で失敗する）。
     * そのため resolver の関数は import せず、`node --input-type=module -e <script>`
     * で別プロセス（ネイティブ ESM ローダー）を起動して composeState() の生の戻り値
     * （base + items）だけを受け取る（子プロセス方式。task.md が明示したフォールバックを
     * 採用）。previewUrl の組み立てとフィールド正規化は TypeScript 側の純関数
     * （resolveResolverPreviewUrl / toResolverAssetCatalogViewItem）が担う —
     * 文字列テンプレートの中身をできるだけ薄くし、ロジックを単体テスト可能にするため。
     */
    /**
     * resolver 合成カタログの取得 + 取得状態。status='failed' になるのは
     * (a) 開発配置に asset-resolver が見つからない (b) 子プロセスが非 0 終了
     * （オフライン等 — composeState() 内の loadCatalog() がキャッシュも無ければ例外を投げ、
     * それが未捕捉のままプロセスを非 0 終了させる） (c) 応答 JSON が解釈できない、の 3 パターン。
     * いずれも fail-soft（ローカル catalog/ の表示は継続）だが、原因（error）は
     * 開発者向け折りたたみでの手がかりに残す。
     */
    protected async loadResolverCatalogItems(): Promise<{
        items: AssetCatalogViewItem[];
        status: 'ok' | 'failed';
        entitlementsStatus: AssetEntitlementsStatus;
        error?: string;
    }> {
        const srcDir = await this.findAssetResolverSrcDir();
        if (!srcDir) {
            return {
                items: [],
                status: 'failed',
                entitlementsStatus: 'error',
                error: 'アセット resolver が見つかりません（開発配置を確認してください）'
            };
        }
        const stateModuleUrl = pathToFileURL(join(srcDir, 'state.mjs')).toString();
        const script = `
import { composeState } from ${JSON.stringify(stateModuleUrl)};
const { base, items, entitlementsStatus } = await composeState();
process.stdout.write(JSON.stringify({ base, items, entitlementsStatus }));
`;
        const { code, stdout, stderr } = await this.runResolverScript(script);
        if (code !== 0) {
            const message = (stderr || stdout).trim();
            console.warn('[akari-project] resolver カタログの取得に失敗（ローカル catalog/ のみで継続）:', message);
            return { items: [], status: 'failed', entitlementsStatus: 'error', error: message || undefined };
        }
        let parsed: {
            base: string;
            items: Array<ResolverRawCatalogItem & { preview?: string }>;
            entitlementsStatus?: AssetEntitlementsStatus;
        };
        try {
            parsed = JSON.parse(stdout);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[akari-project] resolver カタログの応答を解釈できませんでした:', error);
            return { items: [], status: 'failed', entitlementsStatus: 'error', error: message };
        }
        const items = parsed.items.map(item => {
            const previewUrl = resolveResolverPreviewUrl(item.preview, parsed.base);
            // mediaUrl（試聴用の実体 URL）は previewUrl と同じ解決規則（絶対 URL はそのまま／
            // base 相対キーは base 側の規約で解決）を適用する。選定元は files[] の音声ファイル
            // （selectResolverAudioFileRef — audio カテゴリのみ・拡張子一致のみ）であり、
            // preview（サムネ）と混同しない。resolveResolverPreviewUrl は「絶対 URL か
            // base 相対キーかを解決して URL 文字列にする」汎用ロジックなのでそのまま再利用する。
            const mediaUrl = resolveResolverPreviewUrl(selectResolverAudioFileRef(item), parsed.base);
            return toResolverAssetCatalogViewItem(item, previewUrl, mediaUrl);
        });
        const entitlementsStatus = parsed.entitlementsStatus;
        const validEntitlementsStatuses: AssetEntitlementsStatus[] = ['ok', 'no_credentials', 'unauthorized', 'error'];
        return {
            items,
            status: 'ok',
            entitlementsStatus: entitlementsStatus && validEntitlementsStatuses.includes(entitlementsStatus)
                ? entitlementsStatus
                : 'error'
        };
    }

    /**
     * resolver 直行の取得 + プロジェクト配置。resolve.mjs の resolve() をそのまま呼ぶ
     * （fail-closed・sha256 検証・validate-asset・entitlements 判定は resolver 側の
     * 実装をそのまま透過する — ここでは再実装しない）。
     */
    async resolveAsset(id: string, projectUri: string): Promise<AssetResolveOutcome> {
        const srcDir = await this.findAssetResolverSrcDir();
        if (!srcDir) {
            return { success: false, error: 'アセット resolver が見つかりません（開発配置を確認してください）' };
        }
        const projectPath = this.fsPath(projectUri);
        const resolveModuleUrl = pathToFileURL(join(srcDir, 'resolve.mjs')).toString();
        const script = `
import { resolve } from ${JSON.stringify(resolveModuleUrl)};
try {
  const result = await resolve(${JSON.stringify(id)}, { project: ${JSON.stringify(projectPath)} });
  process.stdout.write(JSON.stringify({ success: true, projectDir: result.projectDir ?? null }));
} catch (error) {
  process.stdout.write(JSON.stringify({ success: false, error: error && error.message ? error.message : String(error) }));
}
`;
        const { code, stdout, stderr } = await this.runResolverScript(script);
        if (code !== 0) {
            return { success: false, error: (stderr || stdout || `resolver スクリプトが異常終了しました (exit ${code})`).trim() };
        }
        let parsed: { success: boolean; projectDir?: string | null; error?: string };
        try {
            parsed = JSON.parse(stdout);
        } catch {
            return { success: false, error: `resolver の応答を解釈できませんでした: ${stdout.slice(0, 300)}` };
        }
        if (parsed.success && parsed.projectDir) {
            return { success: true, projectAssetPath: parsed.projectDir };
        }
        if (parsed.success) {
            return { success: false, error: '素材をライブラリへ取得しましたが、プロジェクトへの配置結果を確認できませんでした' };
        }
        return { success: false, error: parsed.error ?? '不明なエラーです' };
    }

    /**
     * findEditLintCli と同じ「開発時 cwd 相対 / パッケージ時 __dirname 相対 /
     * パッケージ時 resourcesPath 基点」の候補列挙規約（packaged-tool-candidates.ts の
     * assetResolverSrcCandidates が純関数として切り出し済み）。state.mjs の存在で
     * asset-resolver の src/ を特定する。
     */
    protected async findAssetResolverSrcDir(): Promise<string | undefined> {
        const candidates = assetResolverSrcCandidates(__dirname, process.cwd(), this.resourcesPath());
        for (const candidate of candidates) {
            if (await this.isFile(join(candidate, 'state.mjs'))) {
                return candidate;
            }
        }
        return undefined;
    }

    /**
     * ネイティブ ESM ローダーで inline スクリプトを走らせる（`--input-type=module -e`）。
     * runNodeScript と同じ ELECTRON_RUN_AS_NODE 対応（Electron パッケージ版で
     * process.execPath が Electron 実行体を指す場合に必要）。spawn 自体が失敗した
     * 場合も例外を投げず code=2 として返す（呼び出し側の fail-soft 処理を単純にする）。
     */
    protected async runResolverScript(script: string): Promise<{ code: number; stdout: string; stderr: string }> {
        return new Promise(resolvePromise => {
            const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', chunk => stdout += chunk.toString());
            child.stderr.on('data', chunk => stderr += chunk.toString());
            child.on('error', error => resolvePromise({ code: 2, stdout, stderr: String(error) }));
            child.on('exit', code => resolvePromise({ code: code ?? 2, stdout, stderr }));
        });
    }

    async watchProject(projectUri: string): Promise<void> {
        const root = this.fsPath(projectUri);
        if (this.watchers.has(root)) {
            return;
        }
        if (!(await this.looksLikeAkariProject(root))) {
            return;
        }
        await this.ensureRuntimeDirectories(root);
        await this.ensureGitInitialized(root);
        const eventsDirectory = join(root, '.akari', 'events');
        try {
            const watcher = watch(eventsDirectory, (_event, fileName) => {
                if (fileName?.toString().endsWith('.json')) {
                    this.queueEvent(root, join(eventsDirectory, fileName.toString()));
                }
            });
            watcher.on('error', error => {
                console.warn('[akari-project] native event watcher unavailable; using polling:', error.message);
                watcher.close();
                this.installPollingWatcher(root, eventsDirectory);
            });
            this.watchers.set(root, watcher);
        } catch (error) {
            console.warn('[akari-project] native event watcher unavailable; using polling:', error);
            this.installPollingWatcher(root, eventsDirectory);
        }
        for (const name of await fs.readdir(eventsDirectory)) {
            if (name.endsWith('.json')) {
                await this.handleEvent(root, join(eventsDirectory, name));
            }
        }
    }

    protected queueEvent(root: string, eventPath: string): void {
        if (this.processedEvents.has(eventPath)) {
            return;
        }
        const oldTimer = this.pendingEvents.get(eventPath);
        if (oldTimer) {
            clearTimeout(oldTimer);
        }
        this.pendingEvents.set(eventPath, setTimeout(() => {
            this.pendingEvents.delete(eventPath);
            void this.handleEvent(root, eventPath);
        }, 150));
    }

    protected installPollingWatcher(root: string, eventsDirectory: string): void {
        const current = this.watchers.get(root);
        current?.close();
        const timer = setInterval(() => {
            void fs.readdir(eventsDirectory).then(names => {
                for (const name of names) {
                    if (name.endsWith('.json')) {
                        this.queueEvent(root, join(eventsDirectory, name));
                    }
                }
            }, error => console.error('[akari-project] event polling failed:', error));
        }, 500);
        this.watchers.set(root, { close: () => clearInterval(timer) });
    }

    async recordDroppedVideos(projectUri: string, videos: DroppedVideo[]): Promise<DroppedVideoImportResult[]> {
        const root = this.fsPath(projectUri);
        await this.ensureRuntimeDirectories(root);
        const results: DroppedVideoImportResult[] = [];
        for (const video of videos) {
            if (!VIDEO_EXTENSIONS.has(extname(video.name).toLowerCase())) {
                results.push({ name: video.name, success: false, reason: 'unsupported-video' });
                continue;
            }
            if (!video.sourcePath) {
                results.push({ name: video.name, success: false, reason: 'source-path-unavailable' });
                continue;
            }

            const assetName = await this.availableName(join(root, 'assets'), this.safeFileName(video.name));
            const assetPath = join(root, 'assets', assetName);
            try {
                await fs.copyFile(video.sourcePath, assetPath, constants.COPYFILE_FICLONE);
            } catch {
                await fs.rm(assetPath, { force: true }).catch(() => undefined);
                results.push({ name: video.name, success: false, reason: 'copy-failed' });
                continue;
            }

            const sizesMatch = await Promise.all([
                fs.stat(video.sourcePath),
                fs.stat(assetPath)
            ]).then(([source, destination]) => source.size === destination.size, () => false);
            if (!sizesMatch) {
                await fs.rm(assetPath, { force: true }).catch(() => undefined);
                results.push({ name: video.name, success: false, reason: 'size-mismatch' });
                continue;
            }

            const event = {
                version: 1,
                id: this.eventId('video-added'),
                type: 'video-added',
                occurredAt: new Date().toISOString(),
                asset: `assets/${assetName}`,
                source: video.sourcePath,
                copied: true
            };
            const eventPath = join(root, '.akari', 'events', `${event.id}.json`);
            try {
                await this.writeJsonAtomic(eventPath, event);
                results.push({ name: video.name, success: true, eventUri: pathToFileURL(eventPath).toString() });
            } catch {
                await fs.rm(assetPath, { force: true }).catch(() => undefined);
                results.push({ name: video.name, success: false, reason: 'event-write-failed' });
            }
        }
        return results;
    }

    /**
     * 左パネルの素材タブが持つ汎用ドロップゾーン向け（動画/音声/画像）。
     * recordDroppedVideos と同じ「検証 → assets/ へ FICLONE 複製 → サイズ照合 →
     * .akari/events/ へ atomic write」の流儀を種類非依存に一般化したもの。
     * recordDroppedVideos 自体はウィンドウ全体のグローバルドロップ（video のみ）が
     * 引き続き使うため変更しない。
     */
    async recordDroppedAssets(projectUri: string, assets: DroppedAsset[]): Promise<DroppedAssetImportResult[]> {
        const root = this.fsPath(projectUri);
        await this.ensureRuntimeDirectories(root);
        const results: DroppedAssetImportResult[] = [];
        for (const asset of assets) {
            const kind = classifyDroppedAssetExtension(asset.name);
            if (!kind) {
                results.push({ name: asset.name, success: false, reason: 'unsupported-type' });
                continue;
            }
            if (!asset.sourcePath) {
                results.push({ name: asset.name, success: false, reason: 'source-path-unavailable' });
                continue;
            }

            const assetName = await this.availableName(join(root, 'assets'), this.safeFileName(asset.name));
            const assetPath = join(root, 'assets', assetName);
            try {
                await fs.copyFile(asset.sourcePath, assetPath, constants.COPYFILE_FICLONE);
            } catch {
                await fs.rm(assetPath, { force: true }).catch(() => undefined);
                results.push({ name: asset.name, success: false, reason: 'copy-failed' });
                continue;
            }

            const sizesMatch = await Promise.all([
                fs.stat(asset.sourcePath),
                fs.stat(assetPath)
            ]).then(([source, destination]) => source.size === destination.size, () => false);
            if (!sizesMatch) {
                await fs.rm(assetPath, { force: true }).catch(() => undefined);
                results.push({ name: asset.name, success: false, reason: 'size-mismatch' });
                continue;
            }

            const event = {
                version: 1,
                id: this.eventId(`${kind}-added`),
                type: `${kind}-added`,
                occurredAt: new Date().toISOString(),
                asset: `assets/${assetName}`,
                source: asset.sourcePath,
                copied: true
            };
            const eventPath = join(root, '.akari', 'events', `${event.id}.json`);
            try {
                await this.writeJsonAtomic(eventPath, event);
                results.push({
                    name: asset.name,
                    success: true,
                    kind,
                    assetPath: `assets/${assetName}`,
                    eventUri: pathToFileURL(eventPath).toString()
                });
            } catch {
                await fs.rm(assetPath, { force: true }).catch(() => undefined);
                results.push({ name: asset.name, success: false, reason: 'event-write-failed' });
            }
        }
        return results;
    }

    /**
     * packages/edit-lint の既存 CLI を子プロセスで呼ぶだけ（読み取り専用・再実装しない）。
     * edit.json が無いプロジェクトは呼び出し自体を省略し、バッジを非表示にできるよう
     * available=false を返す。CLI 自身の exit code は 0=pass/1=fail のどちらも
     * 有効な --json 出力を stdout に返すため、exit code では成否を判定しない。
     */
    async runEditLint(projectUri: string): Promise<EditLintOutcome> {
        const root = this.fsPath(projectUri);
        try {
            await fs.stat(join(root, 'edit.json'));
        } catch {
            return { available: false };
        }
        const cli = await this.findEditLintCli();
        if (!cli) {
            return { available: false };
        }
        try {
            const { code, stdout } = await this.runNodeScript(cli, [root, '--json']);
            if (code === 2) {
                return { available: false };
            }
            const parsed = JSON.parse(stdout) as { findings?: unknown[] };
            return { available: true, issueCount: Array.isArray(parsed.findings) ? parsed.findings.length : 0 };
        } catch {
            return { available: false };
        }
    }

    protected async findEditLintCli(): Promise<string | undefined> {
        const candidates = editLintCliCandidates(__dirname, process.cwd(), this.resourcesPath());
        for (const candidate of candidates) {
            try {
                if ((await fs.stat(candidate)).isFile()) {
                    return candidate;
                }
            } catch {
                // Try the next development or packaged-app location.
            }
        }
        return undefined;
    }

    /**
     * Electron の `process.resourcesPath`（`Contents/Resources` を指す）。純 node の
     * テスト実行など Electron 外では undefined — bundledMediaBinPath と同じ取得規約。
     */
    protected resourcesPath(): string | undefined {
        return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    }

    /**
     * Electron のバックエンドプロセスから素の node スクリプトを起動する。
     * ELECTRON_RUN_AS_NODE はパッケージ版で process.execPath が Electron 実行体を
     * 指す場合に必要（akari-partner-server.ts の bootstrap と同じ流儀）。
     * 開発時の素の node プロセスでは無害に無視される。
     */
    protected async runNodeScript(scriptPath: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
        return new Promise((resolvePromise, reject) => {
            const child = spawn(process.execPath, [scriptPath, ...args], {
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', chunk => stdout += chunk.toString());
            child.stderr.on('data', chunk => stderr += chunk.toString());
            child.on('error', reject);
            child.on('exit', code => resolvePromise({ code: code ?? 2, stdout, stderr }));
        });
    }

    /**
     * `.akari/cache/thumbnails/` に既存キャッシュがあればそれを返し、なければ ffmpeg
     * （PATH から解決）で生成する。ffmpeg 不在・生成失敗はどちらも例外を投げず
     * available=false（プレースホルダ運用）にフォールバックする（task.md 指定）。
     * `.akari/cache/` 以外へは書かない。
     */
    async resolveMaterialThumbnail(projectUri: string, relativePath: string, kind: 'video' | 'image'): Promise<MaterialThumbnailOutcome> {
        const root = this.fsPath(projectUri);
        const sourcePath = join(root, relativePath);
        let stat: { size: number; mtimeMs: number };
        try {
            stat = await fs.stat(sourcePath);
        } catch {
            return { available: false };
        }
        const key = deriveThumbnailCacheKey(relativePath, stat.size, stat.mtimeMs);
        const extension = kind === 'video' ? '.jpg' : (extname(sourcePath).toLowerCase() || '.jpg');
        const cacheFileName = thumbnailCacheFileName(key, extension);
        const cacheDirectory = join(root, '.akari', 'cache', 'thumbnails');
        const cachePath = join(cacheDirectory, cacheFileName);
        const cacheRelativePath = `.akari/cache/thumbnails/${cacheFileName}`;
        if (await fs.stat(cachePath).then(() => true, () => false)) {
            return { available: true, cacheRelativePath };
        }
        const inFlight = this.thumbnailGenerationInFlight.get(cachePath);
        if (inFlight) {
            return inFlight;
        }
        const generation = this.generateThumbnail(kind, sourcePath, cacheDirectory, cachePath, cacheFileName, cacheRelativePath)
            .finally(() => this.thumbnailGenerationInFlight.delete(cachePath));
        this.thumbnailGenerationInFlight.set(cachePath, generation);
        return generation;
    }

    protected async generateThumbnail(
        kind: 'video' | 'image',
        sourcePath: string,
        cacheDirectory: string,
        cachePath: string,
        cacheFileName: string,
        cacheRelativePath: string
    ): Promise<MaterialThumbnailOutcome> {
        const ffmpeg = await this.resolveFfmpegPath();
        if (!ffmpeg) {
            return { available: false };
        }
        await fs.mkdir(cacheDirectory, { recursive: true });
        const temporaryPath = join(cacheDirectory, `.tmp-${process.pid}-${cacheFileName}`);
        const scaleFilter = "scale='min(320,iw)':-2";
        const args = kind === 'video'
            ? ['-y', '-ss', '00:00:00.5', '-i', sourcePath, '-frames:v', '1', '-vf', scaleFilter, temporaryPath]
            : ['-y', '-i', sourcePath, '-vf', scaleFilter, temporaryPath];
        try {
            await execFileAsync(ffmpeg, args);
            await fs.rename(temporaryPath, cachePath);
            return { available: true, cacheRelativePath };
        } catch (error) {
            await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
            console.warn('[akari-project] thumbnail generation failed; falling back to placeholder:', error);
            return { available: false };
        }
    }

    /**
     * プロジェクト選択画面のカード用サムネを解決する。既存キャッシュがあればそれを返し、
     * なければ元動画から ffmpeg で最大 5 コマ抜いて `.akari/cache/project-card/<key>/` に貯める。
     *
     * 元の選び方はプロジェクトの進み具合そのままの 3 段（{@link ProjectCardThumbnailOrigin}）で、
     * キャッシュキーはその段の「正本ファイル」の path+size+mtime 由来。つまり
     * **書き出し直せば・編集し直せばキーが変わって自動で作り直る** — オーナーの言う
     * 「出力完了のタイミングで反映」を、render-cut にも preview にも手を入れずに実現している。
     * 同時に、既に書き出し済み／編集済みの過去プロジェクトへも遡って絵が付く。
     * ffmpeg 不在・元動画不在・生成失敗はすべて available=false（プレースホルダ運用）。
     */
    async resolveProjectCardThumbnails(projectUri: string): Promise<ProjectCardThumbnailsOutcome> {
        const root = this.fsPath(projectUri);
        const plan = await this.locateProjectCardPlan(root);
        if (!plan) {
            return { available: false };
        }
        let stat: { size: number; mtimeMs: number };
        try {
            stat = await fs.stat(plan.keyAbsolutePath);
        } catch {
            return { available: false };
        }
        const key = deriveThumbnailCacheKey(`${plan.origin}:${plan.keyPath}`, stat.size, stat.mtimeMs);
        const cacheRoot = join(root, ...PROJECT_CARD_CACHE_DIRECTORY.split('/'));
        const cacheDirectory = join(cacheRoot, key);
        const cached = await this.readProjectCardCache(cacheDirectory, key, plan.origin);
        if (cached) {
            return cached;
        }
        const inFlight = this.projectCardGenerationInFlight.get(cacheDirectory);
        if (inFlight) {
            return inFlight;
        }
        const generation = this.generateProjectCardFrames(root, cacheRoot, plan, key, cacheDirectory)
            .finally(() => this.projectCardGenerationInFlight.delete(cacheDirectory));
        this.projectCardGenerationInFlight.set(cacheDirectory, generation);
        return generation;
    }

    /**
     * カードの絵をどこから採るかを決める。良いほうから順に:
     *
     * 1. `export`   — `.akari/render.json` が記録した検収済み出力、無ければ `exports/` の最新動画
     * 2. `edit`     — `edit.json` に実際に組まれたカットがある。タイムラインを引いて各カットの該当秒
     * 3. `material` — まだ素材だけ。`assets/` の最新動画
     *
     * キャッシュキーの基準（`keyAbsolutePath`）はその段の正本ファイル: 1 は出力動画、
     * 2 は `edit.json`（編集を直したら作り直る）、3 は素材そのもの。
     */
    protected async locateProjectCardPlan(root: string): Promise<ProjectCardPlan | undefined> {
        const renderState = await this.readRenderState(root);
        const recorded = selectRenderedOutputPath(renderState);
        if (recorded) {
            const absolutePath = isAbsolute(recorded) ? recorded : join(root, recorded);
            if (await this.isReadableFile(absolutePath)) {
                return {
                    origin: 'export',
                    keyPath: this.projectRelativeOrAbsolute(root, absolutePath),
                    keyAbsolutePath: absolutePath,
                    videoPath: absolutePath,
                    renderState
                };
            }
        }
        const exported = await this.newestVideoIn(join(root, 'exports'), 1);
        if (exported) {
            return {
                origin: 'export',
                keyPath: this.projectRelativeOrAbsolute(root, exported),
                keyAbsolutePath: exported,
                videoPath: exported
            };
        }
        const editPath = join(root, 'edit.json');
        const edit = await this.readJsonFile(editPath);
        const samples = deriveEditTimelineSamples(edit, PROJECT_CARD_FRAME_COUNT);
        if (samples.length > 0) {
            return {
                origin: 'edit',
                keyPath: 'edit.json',
                keyAbsolutePath: editPath,
                samples
            };
        }
        const material = await this.newestVideoIn(join(root, 'assets'), 2);
        if (material) {
            return {
                origin: 'material',
                keyPath: this.projectRelativeOrAbsolute(root, material),
                keyAbsolutePath: material,
                videoPath: material
            };
        }
        return undefined;
    }

    /** 実際に抜く「どのファイルの・何秒地点か」の列へ落とす（存在しないファイルは落とす）。 */
    protected async resolveProjectCardShots(root: string, plan: ProjectCardPlan): Promise<ProjectCardShot[]> {
        if (plan.origin === 'edit') {
            const shots: ProjectCardShot[] = [];
            const stillsSeen = new Set<string>();
            for (const sample of plan.samples) {
                const absolutePath = isAbsolute(sample.sourcePath) ? sample.sourcePath : join(root, sample.sourcePath);
                // 静止画ソースは時刻が違っても同じ絵になる。同じ 1 枚を 5 コマ並べると
                // ループが止まって見えるので、静止画は 1 回だけ採る。
                if (IMAGE_EXTENSIONS.has(extname(absolutePath).toLowerCase())) {
                    if (stillsSeen.has(absolutePath)) {
                        continue;
                    }
                    stillsSeen.add(absolutePath);
                }
                if (await this.isReadableFile(absolutePath)) {
                    shots.push({ absolutePath, seconds: sample.sourceSeconds });
                }
            }
            return shots;
        }
        const contactSheetTimestamps = plan.origin === 'export' ? readContactSheetTimestamps(plan.renderState) : [];
        const timestamps = deriveProjectCardTimestamps({
            contactSheetTimestamps,
            durationSeconds: contactSheetTimestamps.length > 0
                ? undefined
                : await this.probeDurationSeconds(plan.videoPath)
                    ?? (plan.origin === 'export' ? readPlannedDurationSeconds(plan.renderState) : undefined)
        });
        return timestamps.map(seconds => ({ absolutePath: plan.videoPath, seconds }));
    }

    /** `.akari/render.json` を防御的に読む（無い・壊れているときは undefined）。 */
    protected async readRenderState(root: string): Promise<RenderStateSummary | undefined> {
        const parsed = await this.readJsonFile(join(root, '.akari', 'render.json'));
        return parsed && typeof parsed === 'object' ? parsed as RenderStateSummary : undefined;
    }

    /** JSON を防御的に読む（無い・壊れているときは undefined）。 */
    protected async readJsonFile(absolutePath: string): Promise<unknown> {
        try {
            return JSON.parse(await fs.readFile(absolutePath, 'utf8'));
        } catch {
            return undefined;
        }
    }

    protected async isReadableFile(absolutePath: string): Promise<boolean> {
        return fs.stat(absolutePath).then(entry => entry.isFile(), () => false);
    }

    /** ディレクトリ配下（深さ maxDepth まで）で mtime が最も新しい動画。ドット項目は見ない。 */
    protected async newestVideoIn(directory: string, maxDepth: number): Promise<string | undefined> {
        let best: { path: string; mtimeMs: number } | undefined;
        const visit = async (current: string, depth: number): Promise<void> => {
            let entries: Dirent[];
            try {
                entries = await fs.readdir(current, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                if (entry.name.startsWith('.')) {
                    continue;
                }
                const candidate = join(current, entry.name);
                if (entry.isDirectory()) {
                    if (depth < maxDepth) {
                        await visit(candidate, depth + 1);
                    }
                    continue;
                }
                if (!entry.isFile() || !PROJECT_CARD_SOURCE_EXTENSIONS.includes(extname(entry.name).toLowerCase())) {
                    continue;
                }
                try {
                    const stat = await fs.stat(candidate);
                    if (!best || stat.mtimeMs > best.mtimeMs) {
                        best = { path: candidate, mtimeMs: stat.mtimeMs };
                    }
                } catch {
                    // 読めない項目は候補から外すだけ（列挙全体は続ける）。
                }
            }
        };
        await visit(directory, 1);
        return best?.path;
    }

    /** キャッシュ済みのコマを番号順に読み直す。1 枚も無ければ undefined（生成へ進む）。 */
    protected async readProjectCardCache(
        cacheDirectory: string,
        key: string,
        origin: ProjectCardThumbnailOrigin
    ): Promise<ProjectCardThumbnailsOutcome | undefined> {
        let names: string[];
        try {
            names = await fs.readdir(cacheDirectory);
        } catch {
            return undefined;
        }
        const frames = names
            .map(name => ({ name, index: parseProjectCardFrameIndex(name) }))
            .filter((entry): entry is { name: string; index: number } => entry.index !== undefined)
            .sort((left, right) => left.index - right.index)
            .map(entry => `${PROJECT_CARD_CACHE_DIRECTORY}/${key}/${entry.name}`);
        return frames.length > 0 ? { available: true, origin, frames } : undefined;
    }

    /**
     * コマを抜いて JPEG で貯める。1 コマ抜きに失敗しても残りは続行し、取れたぶんだけ返す
     * （fail-soft — ポスター 1 枚でもカードは成立する）。1 枚も取れなければ空のキャッシュ
     * ディレクトリを残さずに消して available=false。
     */
    protected async generateProjectCardFrames(
        root: string,
        cacheRoot: string,
        plan: ProjectCardPlan,
        key: string,
        cacheDirectory: string
    ): Promise<ProjectCardThumbnailsOutcome> {
        const ffmpeg = await this.resolveFfmpegPath();
        if (!ffmpeg) {
            return { available: false };
        }
        const shots = await this.resolveProjectCardShots(root, plan);
        if (shots.length === 0) {
            return { available: false };
        }
        await fs.mkdir(cacheDirectory, { recursive: true });
        const frames: string[] = [];
        for (let index = 0; index < shots.length; index += 1) {
            const fileName = projectCardFrameFileName(frames.length);
            const temporaryPath = join(cacheDirectory, `.tmp-${process.pid}-${fileName}`);
            try {
                await execFileAsync(ffmpeg, this.projectCardFrameArgs(shots[index], temporaryPath));
                await fs.rename(temporaryPath, join(cacheDirectory, fileName));
                frames.push(projectCardFrameRelativePath(key, frames.length));
            } catch (error) {
                await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
                console.warn('[akari-project] project card frame extraction failed; continuing with the remaining frames:', error);
            }
        }
        if (frames.length === 0) {
            await fs.rm(cacheDirectory, { recursive: true, force: true }).catch(() => undefined);
            return { available: false };
        }
        await this.pruneProjectCardCache(cacheRoot, key);
        return { available: true, origin: plan.origin, frames };
    }

    /**
     * 1 コマ抜きの ffmpeg 引数。`-ss` を `-i` の前に置く入力シークで、全デコードを避ける。
     * 静止画ソース（v1 の still image cut source）にはシークが効かないので付けない。
     */
    protected projectCardFrameArgs(shot: ProjectCardShot, temporaryPath: string): string[] {
        const still = IMAGE_EXTENSIONS.has(extname(shot.absolutePath).toLowerCase());
        return [
            '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
            ...(still ? [] : ['-ss', shot.seconds.toFixed(3)]),
            '-i', shot.absolutePath,
            '-frames:v', '1',
            '-vf', "scale='min(480,iw)':-2",
            '-q:v', '4',
            temporaryPath
        ];
    }

    /** 世代が変わって使われなくなったキー配下を捨てる（再書き出し・再編集のたびに溜まるのを防ぐ）。 */
    protected async pruneProjectCardCache(cacheRoot: string, keepKey: string): Promise<void> {
        let entries: Dirent[];
        try {
            entries = await fs.readdir(cacheRoot, { withFileTypes: true });
        } catch {
            return;
        }
        await Promise.all(entries
            .filter(entry => entry.isDirectory() && entry.name !== keepKey)
            .map(entry => fs.rm(join(cacheRoot, entry.name), { recursive: true, force: true }).catch(() => undefined)));
    }

    /** 動画の尺（秒）。ffprobe が無い・読めないときは undefined（呼び出し側が既定へ落とす）。 */
    protected async probeDurationSeconds(videoPath: string): Promise<number | undefined> {
        const ffprobe = await this.resolveFfprobePath();
        if (!ffprobe) {
            return undefined;
        }
        try {
            const { stdout } = await execFileAsync(ffprobe, [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                videoPath
            ]);
            const parsed = Number(stdout.trim());
            return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    /** プロジェクト内なら POSIX 区切りの相対パス、外なら絶対パス（キャッシュキーの安定化用）。 */
    protected projectRelativeOrAbsolute(root: string, absolutePath: string): string {
        const relativePath = relative(root, absolutePath);
        if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
            return absolutePath;
        }
        return relativePath.split(sep).join('/');
    }

    protected async resolveFfmpegPath(): Promise<string | undefined> {
        if (!this.ffmpegPathPromise) {
            this.ffmpegPathPromise = this.locateFfmpeg();
        }
        return this.ffmpegPathPromise;
    }

    protected async resolveFfprobePath(): Promise<string | undefined> {
        if (!this.ffprobePathPromise) {
            this.ffprobePathPromise = this.locateFfprobe();
        }
        return this.ffprobePathPromise;
    }

    /** ffprobe の解決。3 段（明示指定 env → PATH → 同梱）は {@link locateFfmpeg} と同じ。 */
    protected async locateFfprobe(): Promise<string | undefined> {
        if (process.env.AKARI_FFPROBE_BIN) {
            return process.env.AKARI_FFPROBE_BIN;
        }
        const onPath = await this.locateMediaBinOnPath('ffprobe');
        return onPath ?? this.bundledMediaBinPath('ffprobe');
    }

    /**
     * ffmpeg を解決する。優先順位は packages/media-bin の resolveFfmpeg と揃える
     * （明示指定 env → PATH → アプリ同梱バイナリ）— akari-preview/hevc-proxy.ts と
     * akari-annotations/media-cache.ts が既に同じ 3 段を実装しており、ここだけ PATH のみを
     * 見ていたため、brew 未導入の PC では同梱 ffmpeg があるのにサムネが全部
     * プレースホルダに落ちていた。見つからなければ静かに undefined（プレースホルダ運用）。
     */
    protected async locateFfmpeg(): Promise<string | undefined> {
        if (process.env.AKARI_FFMPEG_BIN) {
            return process.env.AKARI_FFMPEG_BIN;
        }
        const onPath = await this.locateFfmpegOnPath();
        return onPath ?? this.bundledMediaBinPath('ffmpeg');
    }

    /** ffmpeg を PATH から解決する。見つからなければ undefined（呼び出し側が同梱へ落とす）。 */
    protected async locateFfmpegOnPath(): Promise<string | undefined> {
        return this.locateMediaBinOnPath('ffmpeg');
    }

    /** ffmpeg / ffprobe を PATH から解決する共通実装（which / where）。 */
    protected async locateMediaBinOnPath(name: 'ffmpeg' | 'ffprobe'): Promise<string | undefined> {
        const finder = this.platform === 'win32' ? 'where' : 'which';
        try {
            const { stdout } = await execFileAsync(finder, [name]);
            return stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
        } catch {
            return undefined;
        }
    }

    /**
     * アプリ同梱バイナリの実体パス。apps/shell/package.json の extraResources
     * （resources/vendor-ffmpeg → Resources/media-bin、prepackage の
     * bundle-ffmpeg-binaries.mjs が生成）。開発時は resourcesPath が Electron 自身の
     * Resources を指すため候補は存在せず、undefined になる。
     */
    protected bundledMediaBinPath(name: 'ffmpeg' | 'ffprobe'): string | undefined {
        const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        if (!resourcesPath) {
            return undefined;
        }
        const exe = this.platform === 'win32' ? `${name}.exe` : name;
        const candidate = join(resourcesPath, 'media-bin', exe);
        return existsSync(candidate) ? candidate : undefined;
    }

    async prepareDiffs(projectUri: string): Promise<DiffPreparationResult> {
        const root = this.fsPath(projectUri);
        if ((await this.gitEligibility(root)) !== 'own-root') {
            return { capable: false, pairs: [] };
        }
        let paths = await this.gitPaths(root, ['diff', '--name-only', '-z', 'HEAD', '--']);
        let baseRef = 'HEAD';
        if (!paths.length) {
            paths = await this.gitPaths(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD']);
            baseRef = await this.hasGitRef(root, 'HEAD^') ? 'HEAD^' : EMPTY_TREE;
        }
        const snapshotRoot = join(root, '.akari', 'diffs', `${Date.now()}`);
        const pairs: DiffResourcePair[] = [];
        for (const relativePath of paths.slice(0, 20)) {
            if (this.isInternalOrBinaryPath(relativePath)) {
                continue;
            }
            const left = join(snapshotRoot, 'before', relativePath);
            const current = join(root, relativePath);
            const before = await this.gitShow(root, baseRef, relativePath);
            if (before === undefined || before.includes('\0')) {
                continue;
            }
            await fs.mkdir(dirname(left), { recursive: true });
            await fs.writeFile(left, before, 'utf8');
            let right = current;
            try {
                const content = await fs.readFile(current);
                if (content.includes(0)) {
                    continue;
                }
            } catch {
                right = join(snapshotRoot, 'after', relativePath);
                await fs.mkdir(dirname(right), { recursive: true });
                await fs.writeFile(right, '', 'utf8');
            }
            pairs.push({
                leftUri: pathToFileURL(left).toString(),
                rightUri: pathToFileURL(right).toString(),
                label: `変更を見る: ${relativePath}`
            });
        }
        return { capable: true, pairs };
    }

    protected async handleEvent(root: string, eventPath: string): Promise<void> {
        if (this.processedEvents.has(eventPath)) {
            return;
        }
        let event: AkariEvent;
        try {
            event = JSON.parse(await fs.readFile(eventPath, 'utf8')) as AkariEvent;
        } catch {
            return;
        }
        this.processedEvents.add(eventPath);
        const message = event.type && GATE_MESSAGES[event.type];
        if (!message || (await this.gitEligibility(root)) !== 'own-root') {
            return;
        }
        try {
            await this.runGit(root, ['add', '-A', '--', '.']);
            await this.commitIfChanged(root, message);
        } catch (error) {
            console.error('[akari-project] automatic snapshot failed:', error);
        }
    }

    protected async commitIfChanged(root: string, message: string): Promise<void> {
        const { stdout } = await this.runGit(root, ['status', '--porcelain']);
        if (!stdout.trim()) {
            return;
        }
        await this.runGit(root, [
            '-c', 'user.name=AKARI Video',
            '-c', 'user.email=local@akari.video',
            'commit', '-m', message
        ]);
    }

    protected async runGit(root: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
        return execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    }

    protected async gitPaths(root: string, args: string[]): Promise<string[]> {
        try {
            const { stdout } = await this.runGit(root, args);
            return stdout.split('\0').filter(Boolean);
        } catch {
            return [];
        }
    }

    protected async gitShow(root: string, ref: string, file: string): Promise<string | undefined> {
        try {
            const { stdout } = await this.runGit(root, ['show', `${ref}:${file}`]);
            return stdout;
        } catch {
            return '';
        }
    }

    protected async hasGitRef(root: string, ref: string): Promise<boolean> {
        try {
            await this.runGit(root, ['rev-parse', '--verify', ref]);
            return true;
        } catch {
            return false;
        }
    }

    protected async isGitRepository(root: string): Promise<boolean> {
        try {
            const { stdout } = await this.runGit(root, ['rev-parse', '--is-inside-work-tree']);
            return stdout.trim() === 'true';
        } catch {
            return false;
        }
    }

    protected async isProjectGitRoot(root: string): Promise<boolean> {
        try {
            const { stdout } = await this.runGit(root, ['rev-parse', '--show-toplevel']);
            const [toplevel, target] = await Promise.all([
                fs.realpath(stdout.trim()),
                fs.realpath(root)
            ]);
            return toplevel === target;
        } catch {
            return false;
        }
    }

    protected async gitEligibility(root: string): Promise<ProjectGitEligibility> {
        if (!(await this.isGitRepository(root))) {
            return 'none';
        }
        return (await this.isProjectGitRoot(root)) ? 'own-root' : 'inside-parent-repository';
    }

    protected async looksLikeAkariProject(root: string): Promise<boolean> {
        for (const candidate of [join(root, '.akari'), join(root, '.akari', 'workflow.json')]) {
            try {
                await fs.stat(candidate);
                return true;
            } catch {
                // keep checking the next candidate
            }
        }
        return false;
    }

    protected async ensureGitInitialized(root: string): Promise<void> {
        if ((await this.gitEligibility(root)) !== 'none') {
            return;
        }
        try {
            await this.runGit(root, ['init']);
            await this.runGit(root, ['add', '-A', '--', '.']);
            await this.commitIfChanged(root, 'プロジェクトを開始');
        } catch (error) {
            console.warn('[akari-project] deferred git init failed:', error);
        }
    }

    protected isInternalOrBinaryPath(file: string): boolean {
        if (file.startsWith('.akari/diffs/')) {
            return true;
        }
        return new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.png', '.jpg', '.jpeg', '.gif', '.wav', '.mp3']).has(extname(file).toLowerCase());
    }

    protected async ensureRuntimeDirectories(root: string): Promise<void> {
        for (const directory of ['assets', 'planning', 'exports', '.akari/events', '.akari/sidecars', '.akari/diffs']) {
            await fs.mkdir(join(root, directory), { recursive: true });
        }
    }

    protected async findTemplate(): Promise<string | undefined> {
        const candidates = [
            // Packaged app location: prepackage copies the template to lib/templates/project-default,
            // and the bundled backend's __dirname resolves to lib/backend at runtime.
            resolve(__dirname, '../templates/project-default'),
            resolve(process.cwd(), '../../templates/project-default'),
            resolve(process.cwd(), 'templates/project-default'),
            resolve(__dirname, '../../../../../../../templates/project-default')
        ];
        for (const candidate of candidates) {
            try {
                if ((await fs.stat(candidate)).isDirectory()) {
                    return candidate;
                }
            } catch {
                // Try the next development or packaged-app location.
            }
        }
        return undefined;
    }

    /**
     * Locate the canonical skills tree. Packaged builds copy it to `lib/skills`;
     * development runs read the repository-root `skills/` tree directly.
     */
    protected async findBundledSkills(): Promise<string | undefined> {
        const candidates = [
            resolve(__dirname, '../skills'),
            resolve(process.cwd(), '../../skills'),
            resolve(process.cwd(), 'skills'),
            resolve(__dirname, '../../../../../../../skills')
        ];
        for (const candidate of candidates) {
            try {
                if ((await fs.stat(join(candidate, 'analyze-footage', 'SKILL.md'))).isFile()) {
                    return candidate;
                }
            } catch {
                // Try the next development or packaged-app location.
            }
        }
        return undefined;
    }

    protected async findBundledSchemas(): Promise<string | undefined> {
        const candidates = [
            resolve(__dirname, '../schemas'),
            resolve(process.cwd(), '../../packages/schemas'),
            resolve(process.cwd(), 'packages/schemas'),
            resolve(__dirname, '../../../../../../../packages/schemas')
        ];
        for (const candidate of candidates) {
            try {
                if ((await fs.stat(join(candidate, 'analysis.schema.json'))).isFile()) {
                    return candidate;
                }
            } catch {
                // Try the next development or packaged-app location.
            }
        }
        return undefined;
    }

    protected async installProjectSkills(root: string): Promise<void> {
        const source = await this.findBundledSkills();
        if (!source) {
            throw new Error('プロジェクト用の編集スキルを見つけられませんでした。');
        }
        const destination = join(root, '.claude', 'skills');
        await this.copySkillsTree(source, destination);
        await fs.writeFile(
            join(destination, 'AKARI-SKILLS-VERSION'),
            `${await this.skillsSignature(source)}\n`,
            'utf8'
        );

        const schemasSource = await this.findBundledSchemas();
        if (!schemasSource) {
            throw new Error('プロジェクト用のスキーマを見つけられませんでした。');
        }
        const schema = JSON.parse(
            await fs.readFile(join(schemasSource, 'analysis.schema.json'), 'utf8')
        ) as { $comment?: unknown };
        const provenance = '（この analysis.schema.json は packages/schemas/analysis.schema.json からプロジェクト作成時に installProjectSkills() が機械コピーしたものです。手編集しないでください。再生成するにはプロジェクトを作り直すか、スキルの再インストールを行ってください。）';
        schema.$comment = typeof schema.$comment === 'string'
            ? `${schema.$comment} ${provenance}`
            : provenance;
        const schemaDestination = join(destination, 'analyze-footage', 'references', 'analysis.schema.json');
        await fs.mkdir(dirname(schemaDestination), { recursive: true });
        await fs.writeFile(schemaDestination, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');

        await this.installSkillAdapters(root);
    }

    /**
     * Codex など Claude Code 以外のハーネスは `.claude/skills` を探索しないため、
     * それぞれの探索位置（`.agents/skills` = agentskills.io 標準 / `.codex/skills` = Codex CLI）へ
     * プロジェクト内相対 symlink を張る。相対リンクなのでプロジェクトをフォルダーごと
     * 複製しても壊れない（自己完結原則を維持）。
     */
    protected async installSkillAdapters(root: string): Promise<void> {
        const skillsDir = join(root, '.claude', 'skills');
        const skillNames = (await this.fsImpl.readdir(skillsDir, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
        for (const adapter of ['.agents', '.codex']) {
            const adapterDir = join(root, adapter, 'skills');
            await this.fsImpl.mkdir(adapterDir, { recursive: true });
            for (const name of skillNames) {
                try {
                    await this.createSkillAdapterLink(`../../.claude/skills/${name}`, join(adapterDir, name));
                } catch (error) {
                    if (!isAlreadyExists(error)) {
                        throw error;
                    }
                }
            }
        }
    }

    /**
     * Creates `linkPath` as a directory symlink pointing at `target` (a path relative to
     * `linkPath`'s own directory). Windows without admin rights / developer mode denies plain
     * symlink creation (EPERM); junctions are the privilege-free NTFS alternative but require
     * an absolute target and only work within the same volume. If junction creation also fails
     * (e.g. cross-volume), falls back to a recursive copy so project creation still succeeds —
     * degraded (the adapter stops tracking future skill updates) but functional.
     */
    protected async createSkillAdapterLink(target: string, linkPath: string): Promise<{ method: 'symlink' | 'junction' | 'copy' }> {
        try {
            await this.fsImpl.symlink(target, linkPath, 'dir');
            return { method: 'symlink' };
        } catch (error) {
            if (isAlreadyExists(error)) {
                throw error;
            }
            if (this.platform !== 'win32' || !isPermissionDenied(error)) {
                throw error;
            }
            const absoluteTarget = resolve(dirname(linkPath), target);
            try {
                await this.fsImpl.symlink(absoluteTarget, linkPath, 'junction');
                return { method: 'junction' };
            } catch (junctionError) {
                if (isAlreadyExists(junctionError)) {
                    throw junctionError;
                }
                await this.copyDirectoryRecursive(absoluteTarget, linkPath);
                console.warn(`[akari-project] symlink and junction both failed for ${linkPath}; copied the skill directory instead (it will not reflect future skill updates)`);
                return { method: 'copy' };
            }
        }
    }

    /** Used by createSkillAdapterLink's last-resort fallback when neither symlink nor junction succeed. */
    protected async copyDirectoryRecursive(source: string, destination: string): Promise<void> {
        await this.fsImpl.mkdir(destination, { recursive: true });
        for (const entry of await this.fsImpl.readdir(source, { withFileTypes: true })) {
            const from = join(source, entry.name);
            const to = join(destination, entry.name);
            if (entry.isDirectory()) {
                await this.copyDirectoryRecursive(from, to);
            } else if (entry.isSymbolicLink()) {
                console.warn(`[akari-project] skipping nested symbolic link during fallback copy: ${from}`);
            } else if (entry.isFile()) {
                await this.fsImpl.writeFile(to, await this.fsImpl.readFile(from));
            }
        }
    }

    /** Manual recursion is required for sources inside app.asar. */
    protected async copySkillsTree(source: string, destination: string): Promise<void> {
        await fs.mkdir(destination, { recursive: true });
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
            if (entry.name === '.gitkeep' || entry.name === '.DS_Store') {
                continue;
            }
            const from = join(source, entry.name);
            const to = join(destination, entry.name);
            if (entry.isDirectory()) {
                await this.copySkillsTree(from, to);
            } else if (entry.isSymbolicLink()) {
                console.warn(`[akari-project] skipping skill symbolic link: ${entry.name}`);
            } else if (entry.isFile()) {
                await fs.writeFile(to, await fs.readFile(from));
            }
        }
    }

    protected async skillsSignature(source: string): Promise<string> {
        const hash = createHash('sha256');
        const walk = async (directory: string, relative: string): Promise<void> => {
            const entries = (await fs.readdir(directory, { withFileTypes: true }))
                .sort((left, right) => left.name.localeCompare(right.name));
            for (const entry of entries) {
                if (entry.name === '.gitkeep' || entry.name === '.DS_Store') {
                    continue;
                }
                const absolute = join(directory, entry.name);
                const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    await walk(absolute, relativePath);
                } else if (entry.isFile()) {
                    hash.update(relativePath);
                    hash.update(await fs.readFile(absolute));
                }
            }
        };
        await walk(source, '');
        return hash.digest('hex').slice(0, 16);
    }

    /**
     * Copy a template explicitly because Electron's asar support does not cover
     * the recursive copy API. readdir and readFile can read directories and files from
     * inside app.asar, so walking the tree also preserves dotfiles.
     */
    protected async copyTemplateTree(source: string, destination: string): Promise<void> {
        await fs.mkdir(destination, { recursive: true });
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
            const from = join(source, entry.name);
            const to = join(destination, entry.name);
            if (entry.isDirectory()) {
                await this.copyTemplateTree(from, to);
            } else if (entry.isSymbolicLink()) {
                console.warn(`[akari-project] skipping template symbolic link: ${entry.name}`);
            } else if (entry.isFile()) {
                await fs.writeFile(to, await fs.readFile(from));
            }
        }
    }

    protected async writeFallbackTemplate(root: string): Promise<void> {
        const files: Record<string, string> = {
            '.gitignore': PROJECT_GITIGNORE,
            'CLAUDE.md': FALLBACK_CLAUDE_GUIDANCE,
            'AGENTS.md': FALLBACK_AGENT_GUIDANCE,
            '.claude/settings.json': JSON.stringify({
                permissions: {
                    allow: ['Read(./**)', 'Edit(./planning/**)', 'Edit(./exports/**)', 'Edit(./.akari/sidecars/**)', 'Edit(./.akari/events/**)'],
                    deny: ['Edit(/assets/**)']
                }
            }, null, 2) + '\n',
            '.claude/skills/README.md': FALLBACK_SKILLS_GUIDANCE,
            '.akari/workflow.json': JSON.stringify(FALLBACK_WORKFLOW, null, 2) + '\n',
            'assets/.gitkeep': '',
            'planning/.gitkeep': '',
            'exports/.gitkeep': '',
            '.akari/events/.gitkeep': '',
            '.akari/sidecars/.gitkeep': '',
            '.akari/diffs/.gitkeep': ''
        };
        for (const [name, content] of Object.entries(files)) {
            const destination = join(root, name);
            await fs.mkdir(dirname(destination), { recursive: true });
            await fs.writeFile(destination, content, { encoding: 'utf8', flag: 'wx' }).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                    throw error;
                }
            });
        }
    }

    protected fsPath(uri: string): string {
        return new URI(uri).path.fsPath();
    }

    protected safeFileName(name: string): string {
        return basename(name).replace(/[^\p{L}\p{N}._ -]/gu, '_');
    }

    protected async availableName(directory: string, requested: string): Promise<string> {
        const extension = extname(requested);
        const stem = basename(requested, extension);
        let candidate = requested;
        let index = 2;
        while (await fs.stat(join(directory, candidate)).then(() => true, () => false)) {
            candidate = `${stem}-${index++}${extension}`;
        }
        return candidate;
    }

    protected eventId(type: string): string {
        return `${new Date().toISOString().replace(/[:.]/g, '-')}-${type}-${Math.random().toString(36).slice(2, 8)}`;
    }

    protected async writeJsonAtomic(destination: string, value: unknown): Promise<void> {
        await fs.mkdir(dirname(destination), { recursive: true });
        const temporary = `${destination}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
        await fs.rename(temporary, destination);
    }
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const PROJECT_GITIGNORE = [
    '# Source video and audio are intentionally kept outside the project history.',
    'assets/**',
    '!assets/.gitkeep',
    '',
    '# Temporary files used by the friendly "変更を見る" view.',
    '.akari/diffs/**',
    '!.akari/diffs/.gitkeep',
    '',
    '# Regenerable caches (thumbnails, proxies). project-structure-v0 contract 2-2 defines',
    '# .akari/cache/ as safe to delete -- it is rebuilt from assets/ or the rendered output.',
    '.akari/cache/**',
    '',
    '# Local operating-system files.',
    '.DS_Store',
    'Thumbs.db',
    ''
].join('\n');
const FALLBACK_CLAUDE_GUIDANCE = [
    '# AKARI Video プロジェクト',
    '',
    '- `assets/` は元動画と音声を置く素材の場所です。原本は書き換えたり削除したりしません。',
    '- `planning/` は企画やレポート、`exports/` は完成した動画を置く場所です。',
    '- `.akari/sidecars/` は分析結果、`.akari/events/` は作業の節目の記録を置く場所です。',
    '- 節目の記録は 1 件ずつ新しく追加し、すでにある記録は変更しません。',
    '- 編集スキルは `.claude/skills/` にあり、`/analyze-footage` などの素の名前で使えます。',
    '- 利用者へは日本語で、内部の仕組みではなく「変更履歴」「企画メモ」「素材」などの言葉で説明します。',
    '',
    'このファイルはあなたのプロジェクトのものです。自由に書き換えて構いません。',
    ''
].join('\n');
const FALLBACK_AGENT_GUIDANCE = [
    '# AKARI Video プロジェクトの進め方',
    '',
    '`assets/` の原本を保ち、成果物は `planning/` と `exports/`、分析結果と節目の記録は `.akari/` に置く。',
    '節目の記録は `.akari/events/` に 1 件ずつ追加し、すでにある記録は変更しない。',
    '',
    'スキルは `/analyze-footage`、`/edit-plan`、`/overlay-authoring`、`/setup-library`、',
    '`/harvest-asset`、`/bake-3d` の素の名前で使う。手順を直接読む場合は',
    '`.claude/skills/<スキル名>/SKILL.md` を開く。',
    '',
    '利用者へは日本語で、内部の仕組みではなく役割が伝わる言葉を使う。',
    'この案内はこのプロジェクトのものです。自由に書き換えて構いません。',
    ''
].join('\n');
const FALLBACK_SKILLS_GUIDANCE = [
    '# このプロジェクトのスキル',
    '',
    '6 本の編集スキルはこのフォルダーに実体で入り、素の名前で使えます。',
    '各手順は `.claude/skills/<スキル名>/SKILL.md` から直接読めます。',
    '`AKARI-SKILLS-VERSION` はプロジェクト作成時のスキル内容を示します。',
    'この案内と各スキルは、運用に合わせて自由に書き換えて構いません。',
    ''
].join('\n');
const FALLBACK_WORKFLOW = {
    version: 1,
    roles: [
        { path: 'assets', label: '素材', kind: 'assets' },
        { path: 'planning', label: '企画', kind: 'planning' },
        { path: 'exports', label: '書き出し', kind: 'exports' }
    ],
    tree: {
        hidden: ['.claude', '.agents', '.codex', '.akari', 'CLAUDE.md', 'AGENTS.md', '.gitignore', '.gitkeep'],
        sidecarSuffixes: ['.meta.json', '.decisions.json', '.analysis.json'],
        developerModePreference: 'akari.developerMode'
    },
    events: {
        directory: '.akari/events',
        gateTypes: ['report-generated', 'report-approved', 'edit-completed', 'export-completed']
    }
};
