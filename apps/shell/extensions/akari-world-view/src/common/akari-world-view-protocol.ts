export const AKARI_WORLD_VIEW_SERVICE_PATH = '/services/akari-world-view';
export const AkariWorldViewService = Symbol('AkariWorldViewService');

export interface WorldOverviewSources {
    runtimeSource: string;
    cameraSource: string;
    worldMapJson: string;
    error?: string;
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
    readWorldOverviewSources(projectRootUri: string): Promise<WorldOverviewSources>;
    moveCameraStop(projectRootUri: string, stopId: string, c: number[]): Promise<WorldStopMoveResult>;
}
