import { CatalogPack } from './catalog-packs';

export const AKARI_PROJECT_SERVICE_PATH = '/services/akari-project';
export const AkariProjectService = Symbol('AkariProjectService');

export interface DroppedVideo {
    name: string;
    sourcePath?: string;
}

export type DroppedVideoFailureReason =
    | 'source-path-unavailable'
    | 'unsupported-video'
    | 'copy-failed'
    | 'size-mismatch'
    | 'event-write-failed';

export type DroppedVideoImportResult =
    | { name: string; success: true; eventUri: string }
    | { name: string; success: false; reason: DroppedVideoFailureReason };

export interface DiffResourcePair {
    leftUri: string;
    rightUri: string;
    label: string;
}

export interface DiffPreparationResult {
    capable: boolean;
    pairs: DiffResourcePair[];
}

export type ProjectGitEligibility = 'own-root' | 'inside-parent-repository' | 'none';

/** 左パネルの素材タブが持つ「どこへドロップしても取り込める」ドロップゾーン向け。 */
export interface DroppedAsset {
    name: string;
    sourcePath?: string;
}

export type DroppedAssetKind = 'video' | 'audio' | 'image';

export type DroppedAssetFailureReason =
    | 'source-path-unavailable'
    | 'unsupported-type'
    | 'copy-failed'
    | 'size-mismatch'
    | 'event-write-failed';

export type DroppedAssetImportResult =
    | { name: string; success: true; kind: DroppedAssetKind; assetPath: string; eventUri: string }
    | { name: string; success: false; reason: DroppedAssetFailureReason };

/** edit-lint CLI 単体実行の結果を要約したもの。available=false は edit.json 不在（バッジ非表示）。 */
export interface EditLintOutcome {
    available: boolean;
    issueCount?: number;
}

/**
 * 未分析サムネキャッシュ解決の結果。available=false は「プレースホルダのまま運用する」の意で、
 * ffmpeg 不在・生成失敗のどちらでも例外を投げず常にこの形で返す。
 */
export interface MaterialThumbnailOutcome {
    available: boolean;
    /** `.akari/cache/thumbnails/` 配下のプロジェクト相対パス（available=true のときのみ）。 */
    cacheRelativePath?: string;
}

/** カタログカードの由来。resolver 系だけが取得状態バッジ + 「使う」を持つ。 */
export type AssetCatalogItemOrigin = 'resolver' | 'local';

/**
 * resolver 系アイテムのアカウント視点の取得状態（設計契約 §8）。
 * cached=ローカルに実体あり / available=無料 or 未取得だが取得可 / locked=有料未購入。
 * ローカル catalog/ 由来（origin='local'）のアイテムはこの概念を持たず undefined。
 */
export type AssetCatalogItemState = 'cached' | 'available' | 'locked';

/**
 * カタログ面「1 ビュー」の 1 行。resolver 合成カタログ（無料 + 購入済み）と
 * ローカル catalog/（外部ソース系の参照カタログ）を同じ形へ正規化したもの。
 * origin='resolver' のみ price/state/prompt を持つ。origin='local' のみ
 * description/whenToUse/sourceUrl を持つ（catalog-context-packet.ts の
 * 「取り込む」「頼む」が要る語彙）。previewUrl はどちらの origin でも
 * <img src> に直接渡せる形（http(s) URL または file: URI）に正規化済み。
 */
export interface AssetCatalogViewItem {
    origin: AssetCatalogItemOrigin;
    /** `${category}/${id}`。一覧の React key・カード DOM の data 属性に使う。 */
    key: string;
    id: string;
    category: string;
    title: string;
    tags: string[];
    licenseSpdx?: string;
    previewUrl?: string;
    /**
     * origin='resolver' の audio カテゴリのみ。試聴用の実体 URL（http(s) URL または file: URI）。
     * previewUrl（サムネ画像）とは別物 — files[] の音声ファイルから解決規則を previewUrl と
     * 揃えて組み立てる（src/node/resolver-preview-url.ts）。state（locked 含む）に関わらず
     * 試聴自体は独立して行える（「使う」= resolveAsset とは無関係）。
     */
    mediaUrl?: string;
    /** origin='resolver' のみ。円建て価格（0 = 無料）。 */
    price?: number;
    /** origin='resolver' のみ。 */
    state?: AssetCatalogItemState;
    /** origin='resolver' のみ。provenance.prompt（生成プロンプト）。 */
    prompt?: string;
    /** origin='local' のみ。 */
    description?: string;
    /** origin='local' のみ。meta.json の when_to_use。 */
    whenToUse?: string;
    /** origin='local' のみ。meta.json の source.url。 */
    sourceUrl?: string;
    /** origin='local' のみ。`assets/<category>/<id>/` の実体有無。true なら「取り込む」ボタンを出さない。 */
    installed?: boolean;
    /**
     * origin='local' のみ。分類バッジの表示区分（asset-catalog-view.ts の
     * deriveAssetDistribution が導出。カテゴリ非依存）。
     * bundled=同梱済み / subscription=サブスク / paid=各自入手（有料） / free=無料 DL。
     */
    distribution?: 'bundled' | 'subscription' | 'paid' | 'free';
    /** origin='local' のみ。meta.json の source.acquisition。distribution='free' の「要登録」表示に使う。 */
    sourceAcquisition?: string;
}

/**
 * resolver（アカウントの素材 = 無料 + 購入済み）取得状態。フロントはこれを見て
 * 「未取得（オフライン初回等）」と「取得できたが 0 件」を区別する
 * （catalog-account-first-ux task.md §1）。ローカル catalog/ 未設定はここに含まれない
 * （一般ユーザーの正常系であり resolver の取得失敗とは別の概念のため）。
 */
export interface AssetCatalogResolverStatus {
    status: 'ok' | 'failed';
    /** status='ok' のとき resolver 合成分の件数。'failed' のときは常に 0。 */
    itemCount: number;
    /** status='failed' のときのみ。開発者向け折りたたみでの手がかり用（通常表示には出さない）。 */
    error?: string;
}

/**
 * カタログ面「1 ビュー」の応答本体。items は従来どおりの 1 ビュー配列、packs は
 * `catalog/packs.json`（無ければ空配列）。パック棚のグループ化・内訳集計は
 * asset-catalog-view.ts の groupCatalogItemsByPack / summarizeCatalogPackDistribution が
 * フロント側の純関数として担う（バックエンドはグルーピングしない — 検索/カテゴリ絞り込みの
 * 結果内でグループ化する必要があるため、フロント側の状態を見ないと組めない）。
 * resolver は取得状態（成功/失敗 + リモート由来の件数）— 空状態の原因分岐に使う。
 */
export interface AssetCatalogView {
    items: AssetCatalogViewItem[];
    packs: CatalogPack[];
    resolver: AssetCatalogResolverStatus;
}

export type AssetResolveOutcome =
    | { success: true; projectAssetPath: string }
    | { success: false; error: string };

export interface StoreConnectionStatus {
    connected: boolean;
    identifier?: string;
    email?: string;
    url?: string;
}

export type StoreDeviceStartOutcome =
    | {
        status: 'started';
        baseUrl: string;
        deviceCode: string;
        userCode: string;
        verificationUrl: string;
        intervalMs: number;
        expiresAt: number;
    }
    | { status: 'network-error' | 'error'; error: string };

export interface StoreDevicePollRequest {
    baseUrl: string;
    deviceCode: string;
}

export type StoreDevicePollOutcome =
    | { status: 'pending' }
    | { status: 'approved'; connection: StoreConnectionStatus }
    | { status: 'expired' }
    | { status: 'network-error' | 'error'; error: string };

export interface AkariProjectService {
    createProject(destinationUri: string): Promise<void>;
    watchProject(projectUri: string): Promise<void>;
    recordDroppedVideos(projectUri: string, videos: DroppedVideo[]): Promise<DroppedVideoImportResult[]>;
    recordDroppedAssets(projectUri: string, assets: DroppedAsset[]): Promise<DroppedAssetImportResult[]>;
    runEditLint(projectUri: string): Promise<EditLintOutcome>;
    prepareDiffs(projectUri: string): Promise<DiffPreparationResult>;
    isAkariProject(projectUri: string): Promise<boolean>;
    convertToProject(projectUri: string): Promise<void>;
    getGitEligibility(projectUri: string): Promise<ProjectGitEligibility>;
    /**
     * カタログタブのデータ源解決。preferenceRoot（akari.catalog.root）が
     * 設定されていればそのディレクトリを検証し、未設定ならリポ開発配置
     * （アプリ相対の固定候補 → 見つからなければ上方探索）にフォールバックする。
     * どちらも見つからなければ undefined（呼び出し側は空状態文言を出す）。
     */
    resolveCatalogRoot(preferenceRoot: string | undefined): Promise<string | undefined>;
    /**
     * 未分析の動画/画像素材のサムネイルキャッシュを解決する。`.akari/cache/thumbnails/` に
     * 既存キャッシュ（path+size+mtime 由来のキー）があればそれを返し、なければ ffmpeg
     * （PATH から解決）で非同期生成する。ffmpeg が見つからない・生成に失敗した場合も例外を
     * 投げず available=false を返す（呼び出し側はプレースホルダ表示へ黙ってフォールバックする）。
     */
    resolveMaterialThumbnail(projectUri: string, relativePath: string, kind: 'video' | 'image'): Promise<MaterialThumbnailOutcome>;
    /**
     * カタログ面「1 ビュー」。resolver の合成カタログ（packages/asset-resolver。
     * 無料 + 購入済み + 取得状態）と、ローカル catalog/（外部ソース系。preferenceRoot /
     * 開発配置フォールバックの解決規約は resolveCatalogRoot と同じ）をマージして返す。
     * id 重複（`${category}/${id}`）時は resolver 側を優先する。resolver 側が
     * 到達不能（未デプロイ・開発配置なし等）でもローカル分は表示を継続する（fail-soft）。
     */
    getAssetCatalogView(preferenceRoot: string | undefined): Promise<AssetCatalogView>;
    /**
     * resolver 直行（エージェント非経由）で素材を解決し、指定プロジェクトの assets/ 配下へ
     * 配置する。無料 or 購入済み（entitlements 保有）のみ成功する。未購入は
     * success=false + 購入案内メッセージで返る（resolver 自体の fail-closed をそのまま透過）。
     */
    resolveAsset(id: string, projectUri: string): Promise<AssetResolveOutcome>;
    getStoreConnectionStatus(): Promise<StoreConnectionStatus>;
    startStoreDeviceConnection(): Promise<StoreDeviceStartOutcome>;
    pollStoreDeviceConnection(request: StoreDevicePollRequest): Promise<StoreDevicePollOutcome>;
    disconnectStoreAccount(): Promise<boolean>;
}
