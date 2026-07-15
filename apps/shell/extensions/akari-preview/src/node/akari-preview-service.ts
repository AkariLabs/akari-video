import { injectable } from '@theia/core/shared/inversify';
import { readFileSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import { AkariPreviewService, OverlayRuntimeAssets } from '../common/akari-preview-protocol';

@injectable()
export class AkariPreviewServiceImpl implements AkariPreviewService {
    protected assets: OverlayRuntimeAssets | undefined;

    async getOverlayRuntimeAssets(): Promise<OverlayRuntimeAssets> {
        if (this.assets) {
            return this.assets;
        }
        const directory = this.findOverlayRuntimeDirectory();
        this.assets = {
            runtimeJavaScript: readFileSync(resolve(directory, 'overlay-runtime.js'), 'utf8'),
            interactionJavaScript: readFileSync(resolve(directory, 'interaction.js'), 'utf8'),
            interactionCss: readFileSync(resolve(directory, 'interaction.css'), 'utf8')
        };
        return this.assets;
    }

    protected findOverlayRuntimeDirectory(): string {
        const candidates: string[] = [];
        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            const candidate = resolve(ancestor, 'packages/overlay-runtime/src');
            candidates.push(candidate);
            if (this.isOverlayRuntimeDirectory(candidate)) {
                return candidate;
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) {
                break;
            }
            ancestor = parent;
        }

        // Keep cwd-based locations only as a last-resort development fallback.
        const cwdCandidates = [
            resolve(process.cwd(), '../../packages/overlay-runtime/src'),
            resolve(process.cwd(), 'packages/overlay-runtime/src'),
            resolve(process.cwd(), '../packages/overlay-runtime/src')
        ];
        for (const candidate of cwdCandidates) {
            if (candidates.includes(candidate)) {
                continue;
            }
            candidates.push(candidate);
            if (this.isOverlayRuntimeDirectory(candidate)) {
                return candidate;
            }
        }
        throw new Error(`overlay-runtime assets were not found (tried: ${candidates.join(', ')})`);
    }

    protected isOverlayRuntimeDirectory(candidate: string): boolean {
        try {
            return statSync(resolve(candidate, 'overlay-runtime.js')).isFile()
                && statSync(resolve(candidate, 'interaction.js')).isFile()
                && statSync(resolve(candidate, 'interaction.css')).isFile();
        } catch {
            return false;
        }
    }
}
