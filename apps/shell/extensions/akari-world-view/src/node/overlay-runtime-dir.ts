import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function overlayRuntimeCandidates(startDirectory: string, cwd = process.cwd()): string[] {
    const candidates = [resolve(startDirectory, '../overlay-runtime')];
    let ancestor = resolve(startDirectory);
    for (let depth = 0; depth < 10; depth += 1) {
        candidates.push(resolve(ancestor, 'packages/overlay-runtime/src'));
        const parent = dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
    }
    candidates.push(resolve(cwd, '../../packages/overlay-runtime/src'), resolve(cwd, 'packages/overlay-runtime/src'), resolve(cwd, '../packages/overlay-runtime/src'));
    return [...new Set(candidates)];
}

export function findOverlayRuntimeDirectory(startDirectory: string, cwd = process.cwd()): string {
    const candidates = overlayRuntimeCandidates(startDirectory, cwd);
    const found = candidates.find(candidate => existsSync(resolve(candidate, 'world-runtime.js'))
        && existsSync(resolve(candidate, 'vendor/world-camera.js')));
    if (found) return found;
    throw new Error(`overlay-runtime assets were not found (tried: ${candidates.join(', ')})`);
}
