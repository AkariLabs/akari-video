import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { bundledMediaBinCandidate } from './packaged-cli-candidates';

/**
 * Electron バックエンドから素の node スクリプトを子プロセス起動するときの
 * 環境変数の組み立て（quick-export と preview-server の共有部）。
 *
 * `AKARI_FFMPEG_BIN` / `AKARI_FFPROBE_BIN` を明示的に載せるのが要点。Finder / Dock から
 * 起動されたアプリの PATH は launchd 既定（`/usr/bin:/bin:/usr/sbin:/sbin`）で、
 * Homebrew 等の ffmpeg は載っていない。packages/media-bin の探索順は
 * 「明示指定 env → PATH → 同梱バイナリ」だが、同梱バイナリの置き場は
 * `packages/media-bin/vendor/`（npm install の postinstall が作る開発配置）であって
 * パッケージ版の `Contents/Resources/media-bin/` ではないため、env を渡さないと
 * どの段にも当たらず `ffmpeg が見つかりませんでした` で書き出しが落ちる。
 * 優先順位は media-bin / akari-partner-server の resolveMediaBinPath と同一。
 */

/** Electron が packaged 時のみ設定する `Contents/Resources`（開発起動では undefined）。 */
export function electronResourcesPath(): string | undefined {
    return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

export function canRunOnPath(command: string): boolean {
    try {
        return spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
    } catch {
        return false;
    }
}

export function resolveMediaBinPath(
    name: 'ffmpeg' | 'ffprobe',
    explicitEnvVariable: 'AKARI_FFMPEG_BIN' | 'AKARI_FFPROBE_BIN',
    resourcesPath: string | undefined
): string | undefined {
    const explicit = process.env[explicitEnvVariable];
    if (explicit) {
        return explicit;
    }
    if (canRunOnPath(name)) {
        return name;
    }
    const bundled = bundledMediaBinCandidate(name, resourcesPath);
    return bundled !== undefined && existsSync(bundled) ? bundled : undefined;
}

/** 子プロセス（edit-lint / render-cut / preview-server 等）へ渡す環境。 */
export function childNodeEnvironment(resourcesPath: string | undefined): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    for (const [name, variable] of [['ffmpeg', 'AKARI_FFMPEG_BIN'], ['ffprobe', 'AKARI_FFPROBE_BIN']] as const) {
        const resolved = resolveMediaBinPath(name, variable, resourcesPath);
        if (resolved !== undefined) {
            env[variable] = resolved;
        }
    }
    return env;
}
