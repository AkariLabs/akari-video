import { fileURLToPath } from 'node:url';
import { injectable } from '@theia/core/shared/inversify';
import { AkariWorldViewService, WorldOverviewDocument, WorldStopMoveResult } from '../common/akari-world-view-protocol';
import { WorldCliRunner } from './world-cli';

@injectable()
export class AkariWorldViewServiceImpl implements AkariWorldViewService {
    protected readonly worldCli = new WorldCliRunner();

    async readWorldOverviewHtml(projectRootUri: string): Promise<WorldOverviewDocument> {
        try {
            return await this.worldCli.overview(fileURLToPath(projectRootUri));
        } catch (error) {
            return { html: '', error: error instanceof Error ? error.message : String(error) };
        }
    }

    async moveCameraStop(projectRootUri: string, stopId: string, c: number[]): Promise<WorldStopMoveResult> {
        try {
            return await this.worldCli.moveStop(fileURLToPath(projectRootUri), stopId, c);
        } catch (error) {
            return { ok: false, code: 'IO', reason: error instanceof Error ? error.message : String(error) };
        }
    }
}
