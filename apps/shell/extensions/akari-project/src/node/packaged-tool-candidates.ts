import { resolve } from 'path';

/**
 * asset-resolver（`packages/asset-resolver/src`）と edit-lint CLI
 * （`packages/edit-lint/bin/edit-lint.mjs`）の探索候補を列挙する純関数群。
 * 既存の「開発時 cwd 相対 / パッケージ時 __dirname 相対」の 4 候補はそのまま維持し、
 * `resourcesPath`（Electron の `process.resourcesPath` — `Contents/Resources` を指す）が
 * 渡されたときだけ、その基点の候補を先頭に足す。ffmpeg の `bundledMediaBinPath` と同じ
 * 規約（media-bin/ が `Contents/Resources/media-bin` に同梱される）に揃えたもの。
 * fs に触らないので、呼び出し側（akari-project-service.ts）が実際の存在判定を行う。
 */
export function assetResolverSrcCandidates(dirnameValue: string, cwd: string, resourcesPath?: string): string[] {
    const candidates: string[] = [];
    if (resourcesPath) {
        candidates.push(resolve(resourcesPath, 'packages/asset-resolver/src'));
    }
    candidates.push(
        resolve(dirnameValue, '../asset-resolver/src'),
        resolve(cwd, '../../packages/asset-resolver/src'),
        resolve(cwd, 'packages/asset-resolver/src'),
        resolve(dirnameValue, '../../../../../../../packages/asset-resolver/src')
    );
    return candidates;
}

export function editLintCliCandidates(dirnameValue: string, cwd: string, resourcesPath?: string): string[] {
    const candidates: string[] = [];
    if (resourcesPath) {
        candidates.push(resolve(resourcesPath, 'packages/edit-lint/bin/edit-lint.mjs'));
    }
    candidates.push(
        resolve(dirnameValue, '../edit-lint/bin/edit-lint.mjs'),
        resolve(cwd, '../../packages/edit-lint/bin/edit-lint.mjs'),
        resolve(cwd, 'packages/edit-lint/bin/edit-lint.mjs'),
        resolve(dirnameValue, '../../../../../../../packages/edit-lint/bin/edit-lint.mjs')
    );
    return candidates;
}
