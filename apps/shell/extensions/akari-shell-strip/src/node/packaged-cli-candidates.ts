import { dirname, resolve } from 'path';

/**
 * 同梱 CLI（`packages/<pkg>/bin/<cli>.mjs`）と同梱 ffmpeg/ffprobe の探索候補を列挙する純関数群。
 * fs に触らないので、実在判定は呼び出し側（akari-quick-export-service.ts）が行う。
 *
 * **`process.cwd()` は使わない**。パッケージ版（Finder / Dock 起動）のバックエンドの cwd は
 * `/` になる（実測: `lsof -a -p <backend pid> -d cwd` が `/`）ため、cwd 起点の候補は
 * どれも当たらない。開発起動（`npm start`）では cwd がたまたま `apps/shell` になるだけで、
 * 起動方法が変われば黙って壊れる — 起点にしてよい情報ではない。
 *
 * 代わりに次の 3 段で解決する。いずれも起動方法に依存しない。
 *
 * 1. `process.resourcesPath`（Electron が packaged 時のみ設定する `Contents/Resources`）。
 *    extraResources が `packages/<pkg>` をここへ配るので、これが packaged の正規解。
 * 2. `__dirname` の祖先を遡って `packages/<pkg>/…` を探す。`theia build` はバックエンドを
 *    単一バンドルへ固めるため実行時の `__dirname` は常に `<shell>/lib/backend` になり、
 *    開発配置ではリポルートが 4 階層上の祖先として当たる。パッケージ版でも
 *    `…/Resources/app.asar/lib/backend` の祖先に `…/Resources` が含まれるので、
 *    万一 1 が使えなくてもここで当たる（多重防御）。
 * 3. `<__dirname>/../<pkg>/…`。CLI を `lib/` の隣へコピーする配置向けの後方互換候補。
 */

/** `__dirname` の祖先を遡る深さ。`lib/backend` からリポルート / Resources まで十分に届く。 */
const ANCESTOR_SEARCH_MAX_DEPTH = 10;

/**
 * `packages/<packageName>/bin/<entryName>` の探索候補（先頭が最優先）。
 * packagedPackageEntryCandidates への委譲（期待配列はバイト同一のまま —
 * test/packaged-cli-candidates.test.mjs が固定する）。
 * @param packageName モノレポの `packages/` 直下の名前（例 `render-cut`）
 * @param entryName `bin/` 配下の実行エントリ名（例 `render-cut.mjs`）
 */
export function packagedCliCandidates(
    packageName: string,
    entryName: string,
    dirnameValue: string,
    resourcesPath?: string
): string[] {
    return packagedPackageEntryCandidates(packageName, `bin/${entryName}`, dirnameValue, resourcesPath);
}

/**
 * `packages/<packageName>/<relativeEntry>` の探索候補（先頭が最優先）。
 * preview-server のように入口が `bin/` に無いパッケージ（`src/server.mjs`）向けの一般形。
 * @param packageName モノレポの `packages/` 直下の名前（例 `preview-server`）
 * @param relativeEntry パッケージ相対の入口（例 `src/server.mjs`・`bin/render-cut.mjs`）
 */
export function packagedPackageEntryCandidates(
    packageName: string,
    relativeEntry: string,
    dirnameValue: string,
    resourcesPath?: string
): string[] {
    const relativePath = `packages/${packageName}/${relativeEntry}`;
    const candidates: string[] = [];
    if (resourcesPath) {
        candidates.push(resolve(resourcesPath, relativePath));
    }
    for (const ancestor of ancestorDirectories(dirnameValue)) {
        candidates.push(resolve(ancestor, relativePath));
    }
    candidates.push(resolve(dirnameValue, '..', packageName, relativeEntry));
    return dedupe(candidates);
}

/**
 * アプリ同梱 ffmpeg/ffprobe（`Contents/Resources/media-bin/<name>`）の候補。
 * 配置規約は akari-partner の `bundledMediaBinPath` と同一
 * （extraResources の `resources/vendor-ffmpeg` → `media-bin`）。
 */
export function bundledMediaBinCandidate(
    name: 'ffmpeg' | 'ffprobe',
    resourcesPath?: string,
    platform: NodeJS.Platform = process.platform
): string | undefined {
    if (!resourcesPath) {
        return undefined;
    }
    return resolve(resourcesPath, 'media-bin', platform === 'win32' ? `${name}.exe` : name);
}

function ancestorDirectories(startDirectory: string): string[] {
    const directories: string[] = [];
    let current = resolve(startDirectory);
    for (let depth = 0; depth < ANCESTOR_SEARCH_MAX_DEPTH; depth++) {
        directories.push(current);
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return directories;
}

function dedupe(values: readonly string[]): string[] {
    return [...new Set(values)];
}
