import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { promisify } from 'util';

// Mirrors the shape of apps/shell/extensions/akari-annotations/src/node/media-cache.ts
// (hasFfmpeg / cacheHash / ensureCacheDirectory / atomic temp-then-rename write), per the design
// in tasks/2026-07-23-win-portability-audit/report.md §HEVC プレビュー 4節 (internal repo). Kept
// in its own cache/media-proxy/ directory (not cache/timeline/ where media-cache writes) because
// proxy output is orders of magnitude larger and slower to produce than thumbnails/waveforms.

const execFileAsync = promisify(execFile);

let ffmpegAvailable: Promise<boolean> | undefined;
let ffprobeAvailable: Promise<boolean> | undefined;

async function hasFfmpeg(): Promise<boolean> {
    if (!ffmpegAvailable) {
        ffmpegAvailable = execFileAsync('ffmpeg', ['-version']).then(() => true).catch(() => false);
    }
    return ffmpegAvailable;
}

async function hasFfprobe(): Promise<boolean> {
    if (!ffprobeAvailable) {
        ffprobeAvailable = execFileAsync('ffprobe', ['-version']).then(() => true).catch(() => false);
    }
    return ffprobeAvailable;
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
    const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'json',
        videoPath
    ]);
    const parsed = JSON.parse(stdout) as FfprobeStreamsResult;
    return parsed.streams?.[0]?.codec_name;
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
            await execFileAsync('ffmpeg', [
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
