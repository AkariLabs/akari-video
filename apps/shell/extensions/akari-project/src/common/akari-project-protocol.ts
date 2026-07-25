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
     * （アプリ相対で catalog/ を探す）にフォールバックする。どちらも
     * 見つからなければ undefined（呼び出し側は空状態文言を出す）。
     */
    resolveCatalogRoot(preferenceRoot: string | undefined): Promise<string | undefined>;
    /**
     * 未分析の動画/画像素材のサムネイルキャッシュを解決する。`.akari/cache/thumbnails/` に
     * 既存キャッシュ（path+size+mtime 由来のキー）があればそれを返し、なければ ffmpeg
     * （PATH から解決）で非同期生成する。ffmpeg が見つからない・生成に失敗した場合も例外を
     * 投げず available=false を返す（呼び出し側はプレースホルダ表示へ黙ってフォールバックする）。
     */
    resolveMaterialThumbnail(projectUri: string, relativePath: string, kind: 'video' | 'image'): Promise<MaterialThumbnailOutcome>;
}
