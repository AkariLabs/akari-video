import { promises as fs, statSync } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import { resolveFfmpegPath, resolveFfprobePath } from './hevc-proxy';

// task/2026-09-02-shell-frame-engine-alpha-intake: frame-engine 面の .webm（VP9 alpha）/ .mov
// （ProRes 4444）層を、Web UI（packages/preview-server の prepareAlphaLayers）と同じ media-bin
// alpha-intake で「色 mp4 + マスク mp4」へ取り込む。取り込みの実体・派生物の場所・冪等性
// （<name>.color.mp4 / <name>.mask.mp4 を入力の隣へ、mtime で skip・同時要求は in-flight 合流・
// ロック付き）は media-bin 側に一本化されているので、ここは所在解決と結果の型付けだけを担う。
//
// media-bin は ESM（.mjs）で、この extension の tsconfig は module: commonjs。tsc が import() を
// require() に落とすのを避けるため、loadSpeechAtempoModule と同じく Function 経由の動的 import
// で読む。所在の候補列は hevc-proxy.ts の loadProxyRecipe() と同じ（process.resourcesPath 配下の
// 同梱コピー → 祖先ディレクトリ走査）。

export interface AlphaIntakeOutcome {
    ok: boolean;
    alpha: boolean | null;
    skipped: boolean;
    input: string;
    colorPath: string;
    maskPath: string | null;
    maskFormat?: string;
    reason: string | null;
    elapsedMs: number;
}

export interface AlphaIntakeModule {
    ensureAlphaIntake(
        inputPath: string,
        options?: { ffmpeg?: string; ffprobe?: string; force?: boolean }
    ): Promise<AlphaIntakeOutcome>;
}

export type PrepareAlphaIntakeOutcome =
    | {
        status: 'alpha';
        colorPath: string;
        maskPath: string;
        maskFormat: string;
        /** 派生物が既に新しく、ffmpeg を起動しなかった（media-bin の mtime skip）。 */
        skipped: boolean;
        elapsedMs: number;
    }
    | { status: 'opaque'; elapsedMs: number }
    | { status: 'unavailable'; reason: string };

const ALPHA_INTAKE_MODULE_RELATIVE_PATH = ['packages', 'media-bin', 'src', 'alpha-intake.mjs'] as const;

function isFile(candidate: string): boolean {
    try {
        return statSync(candidate).isFile();
    } catch {
        return false;
    }
}

/** media-bin alpha-intake.mjs の探索候補（先頭から順に最初に存在するものを使う）。 */
export function alphaIntakeModuleCandidates(): string[] {
    const candidates: string[] = [];
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (typeof resourcesPath === 'string' && resourcesPath) {
        candidates.push(join(resourcesPath, ...ALPHA_INTAKE_MODULE_RELATIVE_PATH));
    }
    for (let cursor = __dirname; ;) {
        candidates.push(join(cursor, ...ALPHA_INTAKE_MODULE_RELATIVE_PATH));
        const parent = dirname(cursor);
        if (parent === cursor) {
            break;
        }
        cursor = parent;
    }
    return candidates;
}

let alphaIntakeModulePromise: Promise<AlphaIntakeModule> | undefined;

export function loadAlphaIntakeModule(): Promise<AlphaIntakeModule> {
    if (!alphaIntakeModulePromise) {
        const pending = (async () => {
            const candidates = alphaIntakeModuleCandidates();
            const candidate = candidates.find(isFile);
            if (!candidate) {
                throw new Error(`alpha intake helper could not be found (tried: ${candidates.join(', ')})`);
            }
            const importModule = Function('specifier', 'return import(specifier)') as
                (specifier: string) => Promise<AlphaIntakeModule>;
            const module = await importModule(pathToFileURL(candidate).toString());
            if (typeof module?.ensureAlphaIntake !== 'function') {
                throw new Error(`alpha intake helper does not export ensureAlphaIntake: ${candidate}`);
            }
            return module;
        })();
        alphaIntakeModulePromise = pending.catch(error => {
            if (alphaIntakeModulePromise === pending) {
                alphaIntakeModulePromise = undefined;
            }
            throw error;
        });
    }
    return alphaIntakeModulePromise;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * RPC prepareAlphaIntake の実体。media-bin ensureAlphaIntake の結果を
 * alpha（色 + マスクの mp4 ペア）/ opaque（アルファ無し・従来経路へ）/ unavailable（この層だけ
 * engine に渡さない）の 3 状態へ畳む。例外は投げず、常に unavailable として理由を返す。
 */
export async function prepareAlphaIntake(
    videoPath: string,
    options: { ffmpeg?: string; ffprobe?: string } = {}
): Promise<PrepareAlphaIntakeOutcome> {
    try {
        if (!(await fs.stat(videoPath)).isFile()) {
            return { status: 'unavailable', reason: 'source-missing' };
        }
    } catch {
        return { status: 'unavailable', reason: 'source-missing' };
    }
    const ffmpeg = options.ffmpeg ?? await resolveFfmpegPath();
    if (!ffmpeg) {
        return { status: 'unavailable', reason: 'ffmpeg-not-found' };
    }
    const ffprobe = options.ffprobe ?? await resolveFfprobePath();
    if (!ffprobe) {
        return { status: 'unavailable', reason: 'ffprobe-not-found' };
    }
    let module: AlphaIntakeModule;
    try {
        module = await loadAlphaIntakeModule();
    } catch (error) {
        return { status: 'unavailable', reason: `intake-helper-missing: ${describe(error)}` };
    }
    let outcome: AlphaIntakeOutcome;
    try {
        outcome = await module.ensureAlphaIntake(videoPath, { ffmpeg, ffprobe });
    } catch (error) {
        return { status: 'unavailable', reason: `intake-failed: ${describe(error)}` };
    }
    if (!outcome || outcome.ok !== true) {
        return { status: 'unavailable', reason: outcome?.reason || 'intake-failed' };
    }
    if (!outcome.alpha) {
        return { status: 'opaque', elapsedMs: outcome.elapsedMs };
    }
    if (typeof outcome.colorPath !== 'string' || typeof outcome.maskPath !== 'string') {
        return { status: 'unavailable', reason: 'intake-failed: color/mask path missing' };
    }
    return {
        status: 'alpha',
        colorPath: outcome.colorPath,
        maskPath: outcome.maskPath,
        maskFormat: typeof outcome.maskFormat === 'string' && outcome.maskFormat
            ? outcome.maskFormat : 'gray-h264-fullrange',
        skipped: outcome.skipped === true,
        elapsedMs: outcome.elapsedMs
    };
}
