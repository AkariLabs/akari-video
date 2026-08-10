import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, promises as fs } from 'fs';
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
    streams?: Array<{ codec_name?: string }>;
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
    proxyCodec: string;
    generatedAt: string;
}

/**
 * Lazily produces (and caches) an H.264 proxy for an HEVC source, keyed on
 * sha1(path|size|mtimeMs|'h264-proxy') so a re-encode or file replacement invalidates the cache
 * (same key shape as media-cache.ts's getClipThumbnail/getClipWaveform). Returns 'not-hevc'
 * immediately (no ffmpeg call) when the source is already H.264/other, so this is a no-op cost-
 * wise for the common case.
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
    try {
        codecName = await probeVideoCodecName(videoPath);
    } catch {
        return { status: 'unavailable', reason: 'probe-failed' };
    }
    if (codecName !== 'hevc') {
        return { status: 'not-hevc' };
    }
    if (!(await hasFfmpeg())) {
        return { status: 'unavailable', reason: 'ffmpeg-not-found' };
    }

    const directory = join(projectRoot, 'cache', 'media-proxy');
    const hash = cacheHash([videoPath, stat.size, stat.mtimeMs, 'h264-proxy']);
    const destination = join(directory, `${hash}.mp4`);
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
            await execFileAsync(ffmpegPath, [
                '-y',
                '-i', videoPath,
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-crf', '20',
                '-c:a', 'aac',
                '-movflags', '+faststart',
                // The atomic-write temp file ends in .tmp (not .mp4), so ffmpeg can't infer the
                // muxer from the filename extension the way it normally would — force it.
                '-f', 'mp4',
                temporary
            ], { maxBuffer: 64 * 1024 * 1024 });
            await fs.rename(temporary, destination);
        } catch (error) {
            await fs.unlink(temporary).catch(() => undefined);
            console.warn('[akari-preview] HEVC -> H.264 proxy generation failed', error);
            return { status: 'unavailable', reason: 'proxy-generation-failed' };
        }
        const meta: ProxyMeta = {
            sourceCodec: 'hevc',
            proxyCodec: 'h264',
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
