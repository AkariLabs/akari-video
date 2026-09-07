import { resolve } from 'path';

export function mediaCliCandidates(dirnameValue: string, cwd: string, resourcesPath?: string): string[] {
    return akariToolsCliCandidates('media', dirnameValue, cwd, resourcesPath);
}

export function captionsCliCandidates(dirnameValue: string, cwd: string, resourcesPath?: string): string[] {
    return akariToolsCliCandidates('captions', dirnameValue, cwd, resourcesPath);
}

function akariToolsCliCandidates(tool: string, dirnameValue: string, cwd: string, resourcesPath?: string): string[] {
    const path = `akari-tools/bin/${tool}.mjs`;
    return [
        ...(resourcesPath ? [resolve(resourcesPath, 'packages', path)] : []),
        resolve(dirnameValue, '..', path),
        resolve(cwd, '../../packages', path),
        resolve(cwd, 'packages', path),
        resolve(dirnameValue, '../../../../../../../packages', path)
    ];
}
