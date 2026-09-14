import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { injectable } from '@theia/core/shared/inversify';
import { AkariWorldViewService, WorldOverviewSources, WorldStopMoveResult } from '../common/akari-world-view-protocol';
import { findOverlayRuntimeDirectory } from './overlay-runtime-dir';
import { WorldCliRunner } from './world-cli';

@injectable()
export class AkariWorldViewServiceImpl implements AkariWorldViewService {
    protected readonly worldCli = new WorldCliRunner();

    async readWorldOverviewSources(projectRootUri: string): Promise<WorldOverviewSources> {
        const empty = { runtimeSource: '', cameraSource: '', worldMapJson: '' };
        try {
            const root = fileURLToPath(projectRootUri);
            const runtimeDir = findOverlayRuntimeDirectory(__dirname);
            const [runtimeSource, cameraSource, worldMapJson] = await Promise.all([
                readFile(resolve(runtimeDir, 'world-runtime.js'), 'utf8'),
                readFile(resolve(runtimeDir, 'vendor/world-camera.js'), 'utf8'),
                readFile(resolve(root, 'planning/world-map.json'), 'utf8')
            ]);
            return { runtimeSource, cameraSource, worldMapJson };
        } catch (error) {
            return { ...empty, error: error instanceof Error ? error.message : String(error) };
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
