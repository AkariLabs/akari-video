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
}
