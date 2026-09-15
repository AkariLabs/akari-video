export const AKARI_WORLD_VIEW_SERVICE_PATH = '/services/akari-world-view';
export const AkariWorldViewService = Symbol('AkariWorldViewService');

export interface WorldOverviewDocument {
    html: string;
    error?: string;
    fallback?: boolean;
    atlas?: boolean;
}

export interface WorldStopMoveResult {
    ok: boolean;
    code?: string;
    reason?: string;
    stopId?: string;
    before?: number[];
    after?: number[];
    changed?: boolean;
}

export interface AkariWorldViewService {
    readWorldOverviewHtml(projectRootUri: string): Promise<WorldOverviewDocument>;
    moveCameraStop(projectRootUri: string, stopId: string, c: number[]): Promise<WorldStopMoveResult>;
}
