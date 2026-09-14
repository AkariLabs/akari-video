import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { injectable } from '@theia/core/shared/inversify';
import { AkariWorldViewService, WorldOverviewSources } from '../common/akari-world-view-protocol';
import { findOverlayRuntimeDirectory } from './overlay-runtime-dir';

@injectable()
export class AkariWorldViewServiceImpl implements AkariWorldViewService {
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
}
