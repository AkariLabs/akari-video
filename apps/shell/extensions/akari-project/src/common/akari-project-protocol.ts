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

export interface AkariProjectService {
    createProject(destinationUri: string): Promise<void>;
    watchProject(projectUri: string): Promise<void>;
    recordDroppedVideos(projectUri: string, videos: DroppedVideo[]): Promise<DroppedVideoImportResult[]>;
    prepareDiffs(projectUri: string): Promise<DiffPreparationResult>;
    isAkariProject(projectUri: string): Promise<boolean>;
    convertToProject(projectUri: string): Promise<void>;
    getGitEligibility(projectUri: string): Promise<ProjectGitEligibility>;
}
