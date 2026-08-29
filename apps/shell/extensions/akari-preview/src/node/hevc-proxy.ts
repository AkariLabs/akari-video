import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, promises as fs, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { promisify } from 'util';

// Mirrors the shape of apps/shell/extensions/akari-annotations/src/node/media-cache.ts
// (hasFfmpeg / cacheHash / ensureCacheDirectory / atomic temp-then-rename write), per the design
// in the internal repo's win portability audit §HEVC プレビュー 4節. Kept
// in its own cache/media-proxy/ directory (not cache/timeline/ where media-cache writes) because
// proxy output is orders of magnitude larger and slower to produce than thumbnails/waveforms.
//
// task/2026-08-09-drop-hevc-proxy: getH264Proxy() is NOT on the default preview-open path
// anymore. Measurement showed <video> hardware-decodes HEVC fine on the platforms tested, so
// probing/transcoding proactively was pure added latency (it's what caused the 10s open timeout,
// not a safeguard against it). The only caller left is
// AkariPreviewOpenHandler.handleHevcFallbackRequest in the browser extension, which invokes this
// only after a <video> element has already actually failed to decode a source
// (MEDIA_ERR_DECODE / MEDIA_ERR_SRC_NOT_SUPPORTED) — i.e. this module is a fallback, exercised
// only on the exceptional path, never on ordinary open.

const execFileAsync = promisify(execFile);

interface ProxyRecipe {
    version: string;
    defaultFps: number;
    defaultPixFmt: string;
    codecArgs: string[];
    keyintFlags: [string, string];
    constantGopArgs: string[];
}

let proxyRecipe: ProxyRecipe | undefined;

function loadProxyRecipe(): ProxyRecipe {
    if (proxyRecipe) {
        return proxyRecipe;
    }
    const candidates: string[] = [];
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
        candidates.push(join(resourcesPath, 'packages', 'media-bin', 'src', 'proxy-recipe.json'));
    }
    for (let cursor = __dirname; ;) {
        candidates.push(join(cursor, 'packages', 'media-bin', 'src', 'proxy-recipe.json'));
        const parent = dirname(cursor);
        if (parent === cursor) {
            break;
        }
        cursor = parent;
    }
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as ProxyRecipe;
            if (typeof parsed.version !== 'string'
                || !Number.isFinite(parsed.defaultFps)
                || typeof parsed.defaultPixFmt !== 'string'
                || !Array.isArray(parsed.codecArgs)
                || !Array.isArray(parsed.keyintFlags)
                || parsed.keyintFlags.length !== 2
                || !Array.isArray(parsed.constantGopArgs)) {
                throw new Error(`invalid proxy recipe: ${candidate}`);
            }
            proxyRecipe = parsed;
            return parsed;
        } catch {
            // Try the next development, asar, or packaged-resource location.
        }
    }
    console.warn('[akari-preview] proxy recipe could not be loaded', candidates);
    throw new Error('proxy recipe could not be loaded');
}

function parseFrameRate(value: unknown): number | undefined {
    if (typeof value !== 'string' || value.trim() === '') {
        return undefined;
    }
    const parts = value.trim().split('/');
    const parsed = parts.length === 2
        ? Number(parts[0]) / Number(parts[1])
        : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function proxyGopArgs(recipe: ProxyRecipe, fps: number | undefined): string[] {
    const resolvedFps = typeof fps === 'number' && Number.isFinite(fps) && fps > 0
        ? fps : recipe.defaultFps;
    const frames = String(Math.max(1, Math.round(resolvedFps)));
    return [
        recipe.keyintFlags[0], frames,
        recipe.keyintFlags[1], frames,
        ...recipe.constantGopArgs
    ];
}

function proxyVideoArgs(
    recipe: ProxyRecipe,
    options: { fps: number | undefined; pixFmt?: string; preset: string; crf: string }
): string[] {
    return [
        ...recipe.codecArgs,
        '-preset', String(options.preset),
        '-crf', String(options.crf),
        '-pix_fmt', String(options.pixFmt ?? recipe.defaultPixFmt),
        ...proxyGopArgs(recipe, options.fps)
    ];
}

// task/2026-07-31-shell-ffmpeg-bundle: PATH に ffmpeg/ffprobe が無い環境向けのフォールバック。
// 優先順位は packages/media-bin の resolveFfmpeg/resolveFfprobe と揃える（明示指定 env → PATH →
// アプリ同梱バイナリ）。media-bin をそのまま import しないのは、この extension の tsconfig が
// rootDir: src で閉じており（他 extension も含め本リポにクロス extension の TS import 例が無い）、
// media-bin 側の同梱バイナリ解決（require('ffmpeg-static') 経由）が asar 化されたバックエンドから
// 実行時に解決できる保証がないため。同梱バイナリの実体は apps/shell/package.json の
// extraResources（resources/vendor-ffmpeg → Resources/media-bin、prepackage の
// bundle-ffmpeg-binaries.mjs が生成）。
function bundledMediaBinPath(name: 'ffmpeg' | 'ffprobe'): string | undefined {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (!resourcesPath) {
        return undefined;
    }
    const exe = process.platform === 'win32' ? `${name}.exe` : name;
    const candidate = join(resourcesPath, 'media-bin', exe);
    return existsSync(candidate) ? candidate : undefined;
}

let ffmpegPathPromise: Promise<string | undefined> | undefined;
let ffprobePathPromise: Promise<string | undefined> | undefined;

export async function resolveFfmpegPath(): Promise<string | undefined> {
    if (!ffmpegPathPromise) {
        ffmpegPathPromise = (async () => {
            if (process.env.AKARI_FFMPEG_BIN) {
                return process.env.AKARI_FFMPEG_BIN;
            }
            const onPath = await execFileAsync('ffmpeg', ['-version']).then(() => true).catch(() => false);
            return onPath ? 'ffmpeg' : bundledMediaBinPath('ffmpeg');
        })();
    }
    return ffmpegPathPromise;
}

async function resolveFfprobePath(): Promise<string | undefined> {
    if (!ffprobePathPromise) {
        ffprobePathPromise = (async () => {
            if (process.env.AKARI_FFPROBE_BIN) {
                return process.env.AKARI_FFPROBE_BIN;
            }
            const onPath = await execFileAsync('ffprobe', ['-version']).then(() => true).catch(() => false);
            return onPath ? 'ffprobe' : bundledMediaBinPath('ffprobe');
        })();
    }
    return ffprobePathPromise;
}

export async function hasFfmpeg(): Promise<boolean> {
    return (await resolveFfmpegPath()) !== undefined;
}

export async function hasFfprobe(): Promise<boolean> {
    return (await resolveFfprobePath()) !== undefined;
}

function cacheHash(parts: readonly (string | number)[]): string {
    return createHash('sha1').update(parts.join('|')).digest('hex');
}

async function ensureCacheDirectory(directory: string, projectRoot: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
    const gitignore = join(projectRoot, 'cache', '.gitignore');
    try {
        await fs.writeFile(gitignore, '*\n', { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }
    }
}

interface FfprobeStreamsResult {
    streams?: Array<{ codec_name?: string; pix_fmt?: string; r_frame_rate?: string }>;
}

/**
 * Same shape of ffprobe invocation as packages/render-cut/src/render-cut.mjs's probeMedia()
 * (all-platform-common: -v error, JSON output), narrowed to just the first video stream's
 * codec_name since that's the only field this fallback needs.
 */
export async function probeVideoCodecName(videoPath: string): Promise<string | undefined> {
    const ffprobePath = await resolveFfprobePath() ?? 'ffprobe';
    const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'json',
        videoPath
    ]);
    const parsed = JSON.parse(stdout) as FfprobeStreamsResult;
    return parsed.streams?.[0]?.codec_name;
}

/** Returns the first video stream's decoded pixel format (for example yuva444p10le). */
export async function probeVideoPixelFormat(videoPath: string): Promise<string | undefined> {
    const ffprobePath = await resolveFfprobePath() ?? 'ffprobe';
    const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=pix_fmt',
        '-of', 'json',
        videoPath
    ]);
    const parsed = JSON.parse(stdout) as FfprobeStreamsResult;
    return parsed.streams?.[0]?.pix_fmt;
}

/** Returns the first video stream's frame rate as a positive finite number. */
export async function probeVideoFrameRate(videoPath: string): Promise<number | undefined> {
    try {
        const ffprobePath = await resolveFfprobePath() ?? 'ffprobe';
        const { stdout } = await execFileAsync(ffprobePath, [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=r_frame_rate',
            '-of', 'json',
            videoPath
        ]);
        const parsed = JSON.parse(stdout) as FfprobeStreamsResult;
        return parseFrameRate(parsed.streams?.[0]?.r_frame_rate);
    } catch {
        return undefined;
    }
}

// task/2026-08-10-preview-bug-sweep (B1): <video>.webkitAudioDecodedByteCount stays 0 for the
// entire playback of a real, audible source on the Electron/Chromium build this app ships
// (measured: Electron 39.8.7 / Chromium 142 — the counter is a stubbed no-op in current
// Chromium, not a signal of actual silence). Ground truth instead comes from ffprobe: does the
// source file itself declare an audio stream at all. This can't catch "file has an audio stream
// but the browser's decoder rejects that specific codec" (a narrower case than the byte-count
// heuristic aimed for), but it fixes the false positive that fires on every audible source and
// still correctly flags genuinely silent sources.
export async function probeHasAudioStream(videoPath: string): Promise<boolean | undefined> {
    const ffprobePath = await resolveFfprobePath();
    if (!ffprobePath) {
        return undefined;
    }
    try {
        const { stdout } = await execFileAsync(ffprobePath, [
            '-v', 'error',
            '-select_streams', 'a',
            '-show_entries', 'stream=codec_type',
            '-of', 'json',
            videoPath
        ]);
        const parsed = JSON.parse(stdout) as FfprobeStreamsResult;
        return (parsed.streams?.length ?? 0) > 0;
    } catch (error) {
        console.warn('[akari-preview] probeHasAudioStream failed', videoPath, error);
        return undefined;
    }
}

export type GetH264ProxyResult =
    | { status: 'not-hevc' }
    | { status: 'ready'; proxyPath: string }
    | {
        status: 'unavailable';
        reason: 'ffprobe-not-found' | 'ffmpeg-not-found' | 'probe-failed' | 'source-missing' | 'proxy-generation-failed';
    };

interface ProxyMeta {
    sourceCodec: string;
    sourcePixelFormat?: string;
    // The 2026-08-26 orphan-cache investigation could not reconstruct the inputs used at
    // generation time. Persisting them makes future cache-key mismatches directly diagnosable.
    cacheKey: string;
    sourcePath: string;
    sourceSize: number;
    sourceMtimeMs: number;
    proxyCodec: string;
    proxyPixelFormat?: string;
    recipeVersion: string;
    generatedAt: string;
}

/**
 * Lazily produces (and caches) a Chromium-compatible playback proxy after an actual <video>
 * decode failure. Sources whose pixel format begins with yuva use VP9/yuva420p in WebM so their
 * alpha plane survives; opaque HEVC keeps the established H.264/MP4 fallback. Other opaque
 * codecs return not-hevc without invoking ffmpeg.
 */
export async function getH264Proxy(projectRoot: string, videoPath: string): Promise<GetH264ProxyResult> {
    let stat;
    try {
        stat = await fs.stat(videoPath);
    } catch {
        return { status: 'unavailable', reason: 'source-missing' };
    }
    if (!(await hasFfprobe())) {
        return { status: 'unavailable', reason: 'ffprobe-not-found' };
    }
    let codecName: string | undefined;
    let pixelFormat: string | undefined;
    let frameRate: number | undefined;
    try {
        [codecName, pixelFormat, frameRate] = await Promise.all([
            probeVideoCodecName(videoPath),
            probeVideoPixelFormat(videoPath),
            probeVideoFrameRate(videoPath)
        ]);
    } catch {
        return { status: 'unavailable', reason: 'probe-failed' };
    }
    const hasAlpha = typeof pixelFormat === 'string' && /^yuva/i.test(pixelFormat);
    if (!hasAlpha && codecName !== 'hevc') {
        return { status: 'not-hevc' };
    }
    if (!(await hasFfmpeg())) {
        return { status: 'unavailable', reason: 'ffmpeg-not-found' };
    }

    let recipe: ProxyRecipe;
    try {
        recipe = loadProxyRecipe();
    } catch {
        return { status: 'unavailable', reason: 'proxy-generation-failed' };
    }

    const directory = join(projectRoot, 'cache', 'media-proxy');
    const proxyKind = hasAlpha ? 'vp9-alpha-proxy' : 'h264-proxy';
    const hash = cacheHash([videoPath, stat.size, stat.mtimeMs, proxyKind, recipe.version]);
    const destination = join(directory, `${hash}.${hasAlpha ? 'webm' : 'mp4'}`);
    const metaDestination = join(directory, `${hash}.json`);

    try {
        await ensureCacheDirectory(directory, projectRoot);
        try {
            await fs.access(destination);
            return { status: 'ready', proxyPath: destination };
        } catch {
            // Cache miss falls through to generation below.
        }
        const temporary = `${destination}.${process.pid}.tmp`;
        try {
            const ffmpegPath = await resolveFfmpegPath() ?? 'ffmpeg';
            const encodeArgs = hasAlpha ? [
                '-c:v', 'libvpx-vp9',
                '-pix_fmt', 'yuva420p',
                '-deadline', 'realtime',
                '-cpu-used', '8',
                ...proxyGopArgs(recipe, frameRate),
                '-c:a', 'libopus',
                '-f', 'webm'
            ] : [
                // Preserving yuv420p10le would produce H.264 High 10, which Chromium does not
                // guarantee it can decode. The opaque fallback must always be 8-bit yuv420p.
                ...proxyVideoArgs(recipe, {
                    fps: frameRate,
                    pixFmt: 'yuv420p',
                    preset: 'veryfast',
                    crf: '20'
                }),
                '-c:a', 'aac',
                '-movflags', '+faststart',
                '-f', 'mp4'
            ];
            // The atomic-write temp file ends in .tmp, so ffmpeg cannot infer the muxer from the
            // destination extension. Both branches force their container explicitly.
            await execFileAsync(ffmpegPath, [
                '-y',
                '-i', videoPath,
                ...encodeArgs,
                temporary
            ], { maxBuffer: 64 * 1024 * 1024 });
            await fs.rename(temporary, destination);
        } catch (error) {
            await fs.unlink(temporary).catch(() => undefined);
            console.warn(`[akari-preview] ${hasAlpha ? 'alpha -> VP9' : 'HEVC -> H.264'} proxy generation failed`, error);
            return { status: 'unavailable', reason: 'proxy-generation-failed' };
        }
        const meta: ProxyMeta = {
            sourceCodec: codecName ?? 'unknown',
            ...(pixelFormat ? { sourcePixelFormat: pixelFormat } : {}),
            cacheKey: hash,
            sourcePath: videoPath,
            sourceSize: stat.size,
            sourceMtimeMs: stat.mtimeMs,
            proxyCodec: hasAlpha ? 'vp9' : 'h264',
            proxyPixelFormat: hasAlpha ? 'yuva420p' : 'yuv420p',
            recipeVersion: recipe.version,
            generatedAt: new Date().toISOString()
        };
        await writeAtomicJson(metaDestination, meta);
        return { status: 'ready', proxyPath: destination };
    } catch {
        return { status: 'unavailable', reason: 'proxy-generation-failed' };
    }
}

async function writeAtomicJson(destination: string, value: unknown): Promise<void> {
    await fs.mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, destination);
}
