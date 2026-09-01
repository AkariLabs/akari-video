import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import { Worker } from 'worker_threads';
import type {
    MeasureAudioForLevelRequest,
    MeasureAudioForLevelResult
} from '../common/akari-annotations-protocol';

const execFileAsync = promisify(execFile);
const AUDIO_MEASURE_RELATIVE_PATH = ['packages', 'media-bin', 'src', 'audio-measure.mjs'] as const;
const INSERT_LEVEL_RELATIVE_PATH = ['packages', 'audio-library-setup', 'shared', 'insert-level.mjs'] as const;
const DEFAULT_TIMEOUT_MS = 10_000;

type UnknownRecord = Record<string, unknown>;

interface InsertLevelModule {
    roleForClip(options: {
        role?: string;
        collection?: string;
        path?: string;
        durationSec?: number;
    }): string;
    computeInsertLevel(options: { role: string; measured: UnknownRecord }): {
        gain_db: number;
        fade_in: number;
        fade_out: number;
        basis: string;
    };
}

export interface AudioLevelResolverOptions {
    resourcesPath?: string;
    startDirectory?: string;
    maxDepth?: number;
    fileExists?: (candidate: string) => boolean;
    importModule?: (specifier: string) => Promise<unknown>;
    resolveFfmpeg?: () => Promise<string | undefined>;
    measure?: (moduleUrl: string, options: {
        ffmpegPath: string;
        filePath: string;
        cacheDir: string;
    }, timeoutMs: number) => Promise<UnknownRecord>;
    timeoutMs?: number;
}

export function buildPackageModuleCandidates(
    relativeSegments: readonly string[],
    options: { resourcesPath?: string; startDirectory: string; maxDepth?: number }
): string[] {
    const candidates: string[] = [];
    if (options.resourcesPath) {
        candidates.push(resolve(options.resourcesPath, ...relativeSegments));
    }
    let ancestor = resolve(options.startDirectory);
    const maxDepth = Math.max(0, options.maxDepth ?? 10);
    for (let depth = 0; depth < maxDepth; depth += 1) {
        candidates.push(resolve(ancestor, ...relativeSegments));
        const parent = dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
    }
    return [...new Set(candidates)];
}

export function buildAudioMeasureCacheDir(projectRoot: string): string {
    return join(resolve(projectRoot), '.akari', 'cache', 'audio-measure');
}

export function oneLineReason(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error ?? 'unknown error');
    return raw.replace(/\s+/gu, ' ').trim().slice(0, 1000) || 'unknown error';
}

// media-bin の resolveFfmpeg は import しない。asar 化された backend から ffmpeg-static の
// 実体を解決できる保証がないため、hevc-proxy と同じ env → PATH → extraResources の順を閉じ込める。
export async function resolveAudioLevelFfmpeg(resourcesPath?: string): Promise<string | undefined> {
    if (process.env.AKARI_FFMPEG_BIN) return process.env.AKARI_FFMPEG_BIN;
    const onPath = await execFileAsync('ffmpeg', ['-version']).then(() => true).catch(() => false);
    if (onPath) return 'ffmpeg';
    if (!resourcesPath) return undefined;
    const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const bundled = join(resourcesPath, 'media-bin', executable);
    return existsSync(bundled) ? bundled : undefined;
}

const MEASURE_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  try {
    const importModule = Function('specifier', 'return import(specifier)');
    const module = await importModule(workerData.moduleUrl);
    const measured = module.measureAudioLevels(workerData.options);
    parentPort.postMessage({ ok: true, measured });
  } catch (error) {
    parentPort.postMessage({ ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
})();
`;

export function measureAudioModuleInWorker(
    moduleUrl: string,
    options: { ffmpegPath: string; filePath: string; cacheDir: string },
    timeoutMs: number
): Promise<UnknownRecord> {
    return new Promise((resolveMeasured, reject) => {
        const worker = new Worker(MEASURE_WORKER_SOURCE, {
            eval: true,
            workerData: { moduleUrl, options }
        });
        let settled = false;
        const finish = (error?: Error, measured?: UnknownRecord): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            void worker.terminate();
            if (error) reject(error);
            else resolveMeasured(measured ?? {});
        };
        const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
        worker.once('message', (message: { ok: boolean; measured?: UnknownRecord; reason?: string }) => {
            if (message.ok) finish(undefined, message.measured);
            else finish(new Error(message.reason ?? '音声レベル計測に失敗しました'));
        });
        worker.once('error', error => finish(error instanceof Error ? error : new Error(String(error))));
        worker.once('exit', code => {
            if (!settled && code !== 0) finish(new Error(`音声レベル計測 worker が終了しました (${code})`));
        });
    });
}

export async function measureAudioForLevel(
    request: MeasureAudioForLevelRequest,
    options: AudioLevelResolverOptions = {}
): Promise<MeasureAudioForLevelResult> {
    try {
        if (!request || typeof request.projectRoot !== 'string' || !request.projectRoot.trim()
            || typeof request.audioPath !== 'string' || !request.audioPath.trim()) {
            return { ok: false, reason: 'projectRoot と audioPath が必要です' };
        }
        const resourcesPath = options.resourcesPath
            ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        const candidateOptions = {
            ...(resourcesPath ? { resourcesPath } : {}),
            startDirectory: options.startDirectory ?? __dirname,
            maxDepth: options.maxDepth
        };
        const fileExists = options.fileExists ?? existsSync;
        const measurePath = buildPackageModuleCandidates(AUDIO_MEASURE_RELATIVE_PATH, candidateOptions)
            .find(fileExists);
        const insertLevelPath = buildPackageModuleCandidates(INSERT_LEVEL_RELATIVE_PATH, candidateOptions)
            .find(fileExists);
        if (!measurePath || !insertLevelPath) {
            return { ok: false, reason: '音声レベル計測モジュールを解決できませんでした' };
        }
        const ffmpegPath = await (options.resolveFfmpeg
            ? options.resolveFfmpeg() : resolveAudioLevelFfmpeg(resourcesPath));
        if (!ffmpegPath) return { ok: false, reason: 'ffmpeg が見つかりませんでした' };
        const audioPath = isAbsolute(request.audioPath)
            ? request.audioPath : resolve(request.projectRoot, request.audioPath);
        const measure = options.measure ?? measureAudioModuleInWorker;
        const measured = await measure(
            pathToFileURL(measurePath).toString(),
            {
                ffmpegPath,
                filePath: audioPath,
                cacheDir: buildAudioMeasureCacheDir(request.projectRoot)
            },
            options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        );
        const importModule = options.importModule ?? (Function('specifier', 'return import(specifier)') as
            (specifier: string) => Promise<unknown>);
        const insertLevel = await importModule(pathToFileURL(insertLevelPath).toString()) as InsertLevelModule;
        if (typeof insertLevel.roleForClip !== 'function' || typeof insertLevel.computeInsertLevel !== 'function') {
            return { ok: false, reason: '自動レベル計算モジュールが不正です' };
        }
        const durationSec = Number.isFinite(request.durationSec)
            ? request.durationSec : typeof measured.duration_sec === 'number' ? measured.duration_sec : undefined;
        const role = insertLevel.roleForClip({
            role: request.role,
            collection: request.collection,
            path: audioPath,
            durationSec
        });
        const level = insertLevel.computeInsertLevel({ role, measured });
        return {
            ok: true,
            measured,
            role,
            gain_db: level.gain_db,
            fade_in: level.fade_in,
            fade_out: level.fade_out,
            basis: level.basis
        };
    } catch (error) {
        const reason = oneLineReason(error);
        return { ok: false, reason: reason === 'timeout' ? 'timeout' : reason };
    }
}
