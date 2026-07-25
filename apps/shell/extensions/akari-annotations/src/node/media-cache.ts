import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import {
    ClipFilmstripAtlas,
    FILMSTRIP_COLS,
    FILMSTRIP_FPS,
    FILMSTRIP_FRAME_WIDTH_PX,
    FILMSTRIP_MAX_FRAMES,
    GetAudioDurationResult,
    GetClipFilmstripResult,
    GetClipThumbnailResult,
    GetClipWaveformResult,
    THUMBNAIL_WIDTH_PX,
    WAVEFORM_BUCKET_COUNT
} from '../common/akari-annotations-protocol';

const execFileAsync = promisify(execFile);
let ffmpegAvailable: Promise<boolean> | undefined;
let ffprobeAvailable: Promise<boolean> | undefined;

async function hasFfmpeg(): Promise<boolean> {
    if (!ffmpegAvailable) {
        ffmpegAvailable = execFileAsync('ffmpeg', ['-version'])
            .then(() => true)
            .catch(() => false);
    }
    return ffmpegAvailable;
}

async function hasFfprobe(): Promise<boolean> {
    if (!ffprobeAvailable) {
        ffprobeAvailable = execFileAsync('ffprobe', ['-version'])
            .then(() => true)
            .catch(() => false);
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

async function writeAtomic(destination: string, content: string | Buffer): Promise<void> {
    await fs.mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, destination);
}

async function readThumbnail(path: string): Promise<GetClipThumbnailResult> {
    const base64 = (await fs.readFile(path)).toString('base64');
    return { status: 'ready', dataUri: `data:image/jpeg;base64,${base64}` };
}

export async function getClipThumbnail(
    projectRoot: string,
    videoPath: string,
    atSeconds: number
): Promise<GetClipThumbnailResult> {
    let stat;
    try {
        stat = await fs.stat(videoPath);
    } catch {
        return { status: 'unavailable', reason: 'source-missing' };
    }
    if (!(await hasFfmpeg())) {
        return { status: 'unavailable', reason: 'ffmpeg-not-found' };
    }

    const directory = join(projectRoot, 'cache', 'timeline', 'thumbs');
    const hash = cacheHash([videoPath, stat.size, stat.mtimeMs, atSeconds, 'thumbnail']);
    const destination = join(directory, `${hash}.jpg`);
    try {
        await ensureCacheDirectory(directory, projectRoot);
        try {
            return await readThumbnail(destination);
        } catch {
            // A cache miss falls through to extraction.
        }
        const temporary = `${destination}.${process.pid}.tmp`;
        try {
            await execFileAsync('ffmpeg', [
                '-y', '-ss', String(atSeconds), '-i', videoPath,
                '-frames:v', '1', '-vf', `scale=${THUMBNAIL_WIDTH_PX}:-1`, '-q:v', '4',
                '-f', 'image2', temporary
            ]);
            await fs.rename(temporary, destination);
        } catch {
            await fs.unlink(temporary).catch(() => undefined);
            return { status: 'unavailable', reason: 'extraction-failed' };
        }
        return await readThumbnail(destination);
    } catch {
        return { status: 'unavailable', reason: 'extraction-failed' };
    }
}

// ============================================================================
// フィルムストリップ atlas（T2）
//
// 単位は「素材全体」（クリップ区間ごとではない）。キャッシュキーは素材 path +
// size/mtime + frameWidth/fps のみで、クリップの in/out は含まない。トリムで
// in/out が変わっても同じ atlas がヒットし続け、再焼成は発生しない（widget 側で
// background-position を再マッピングするだけ、旧版 SlipGhost 方式）。
//
// 置き場所は project-structure-v0 契約の正準パス（.akari/cache/）。既存の
// レガシー `cache/timeline/`（getClipThumbnail 等）とは意図的に分離し、移設しない。
// ============================================================================

const FILMSTRIP_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.heic', '.heif', '.tiff', '.tif'];

function isFilmstripImageSource(path: string): boolean {
    const lower = path.toLowerCase();
    return FILMSTRIP_IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function evenUp(value: number): number {
    const rounded = Math.max(2, Math.round(value));
    return rounded % 2 === 0 ? rounded : rounded + 1;
}

async function ensureAkariCacheDirectory(directory: string, projectRoot: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
    const gitignore = join(projectRoot, '.akari', 'cache', '.gitignore');
    try {
        await fs.writeFile(gitignore, '*\n', { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }
    }
}

interface FilmstripProbe {
    durationSeconds: number;
    width: number;
    height: number;
}

async function probeForFilmstrip(videoPath: string): Promise<FilmstripProbe | undefined> {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height:format=duration',
            '-of', 'json',
            videoPath
        ]);
        const parsed = JSON.parse(stdout) as {
            streams?: Array<{ width?: number; height?: number }>;
            format?: { duration?: string };
        };
        const stream = parsed.streams?.[0];
        const width = stream?.width;
        const height = stream?.height;
        const durationSeconds = Number(parsed.format?.duration);
        if (!width || !height || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            return undefined;
        }
        return { durationSeconds, width, height };
    } catch {
        return undefined;
    }
}

type FilmstripAtlasMeta = Omit<ClipFilmstripAtlas, 'atlasUri'>;

async function readFilmstripAtlas(atlasPath: string, metaPath: string): Promise<ClipFilmstripAtlas | undefined> {
    try {
        const [metaRaw] = await Promise.all([fs.readFile(metaPath, 'utf8'), fs.access(atlasPath)]);
        const meta = JSON.parse(metaRaw) as Partial<FilmstripAtlasMeta>;
        if (
            typeof meta.frameWidth !== 'number' || typeof meta.frameHeight !== 'number'
            || typeof meta.cols !== 'number' || typeof meta.rows !== 'number'
            || typeof meta.frameCount !== 'number' || typeof meta.fps !== 'number'
            || typeof meta.durationSeconds !== 'number'
        ) {
            return undefined;
        }
        return { ...(meta as FilmstripAtlasMeta), atlasUri: pathToFileURL(atlasPath).toString() };
    } catch {
        return undefined;
    }
}

export async function getClipFilmstrip(
    projectRoot: string,
    videoPath: string,
    requestedFrameWidth?: number,
    requestedFps?: number
): Promise<GetClipFilmstripResult> {
    const frameWidth = evenUp(
        requestedFrameWidth !== undefined && requestedFrameWidth > 0 ? requestedFrameWidth : FILMSTRIP_FRAME_WIDTH_PX
    );
    const fps = requestedFps !== undefined && requestedFps > 0 ? requestedFps : FILMSTRIP_FPS;

    let stat;
    try {
        stat = await fs.stat(videoPath);
    } catch {
        return { status: 'unavailable', reason: 'source-missing' };
    }
    if (!(await hasFfmpeg()) || !(await hasFfprobe())) {
        return { status: 'unavailable', reason: 'ffmpeg-not-found' };
    }

    const directory = join(projectRoot, '.akari', 'cache', 'timeline', 'filmstrip');
    const hash = cacheHash([videoPath, stat.size, stat.mtimeMs, frameWidth, fps, 'filmstrip-v1']);
    const atlasPath = join(directory, `${hash}.jpg`);
    const metaPath = join(directory, `${hash}.json`);

    try {
        await ensureAkariCacheDirectory(directory, projectRoot);

        const cached = await readFilmstripAtlas(atlasPath, metaPath);
        if (cached) {
            return { status: 'ready', atlas: cached };
        }

        const probe = await probeForFilmstrip(videoPath);
        if (!probe) {
            return { status: 'unavailable', reason: 'extraction-failed' };
        }
        const isImage = isFilmstripImageSource(videoPath);
        const frameHeight = evenUp(frameWidth * probe.height / probe.width);

        let frameCount: number;
        let effectiveFps: number;
        if (isImage) {
            frameCount = 1;
            effectiveFps = fps;
        } else {
            const rawCount = Math.max(1, Math.ceil(probe.durationSeconds * fps));
            if (rawCount > FILMSTRIP_MAX_FRAMES) {
                effectiveFps = FILMSTRIP_MAX_FRAMES / probe.durationSeconds;
                frameCount = FILMSTRIP_MAX_FRAMES;
            } else {
                effectiveFps = fps;
                frameCount = rawCount;
            }
        }
        const cols = Math.max(1, Math.min(FILMSTRIP_COLS, frameCount));
        const rows = Math.max(1, Math.ceil(frameCount / cols));

        const vf = isImage
            ? `scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=disable`
            : `fps=${effectiveFps.toFixed(6)},scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=disable,tile=${cols}x${rows}`;

        const temporary = `${atlasPath}.${process.pid}.tmp`;
        try {
            await execFileAsync('ffmpeg', [
                '-y', '-v', 'error', '-i', videoPath,
                '-vf', vf, '-frames:v', '1', '-q:v', '4', '-pix_fmt', 'yuvj420p',
                // 出力先は `<hash>.jpg.<pid>.tmp`（拡張子が .tmp）なのでコンテナ自動判定が効かない。
                // getClipThumbnail と同じく -f で明示する。
                '-f', 'image2', temporary
            ]);
            await fs.rename(temporary, atlasPath);
        } catch {
            await fs.unlink(temporary).catch(() => undefined);
            return { status: 'unavailable', reason: 'extraction-failed' };
        }

        const meta: FilmstripAtlasMeta = {
            frameWidth, frameHeight, cols, rows, frameCount,
            fps: effectiveFps, durationSeconds: probe.durationSeconds
        };
        await writeAtomic(metaPath, `${JSON.stringify(meta)}\n`);
        return { status: 'ready', atlas: { ...meta, atlasUri: pathToFileURL(atlasPath).toString() } };
    } catch {
        return { status: 'unavailable', reason: 'extraction-failed' };
    }
}

function extractPeaks(pcm: Buffer): number[] {
    const sampleCount = Math.floor(pcm.length / 2);
    const peaks = new Array<number>(WAVEFORM_BUCKET_COUNT).fill(0);
    for (let bucket = 0; bucket < WAVEFORM_BUCKET_COUNT; bucket++) {
        const start = Math.floor(sampleCount * bucket / WAVEFORM_BUCKET_COUNT);
        const end = bucket === WAVEFORM_BUCKET_COUNT - 1
            ? sampleCount
            : Math.floor(sampleCount * (bucket + 1) / WAVEFORM_BUCKET_COUNT);
        let maximum = 0;
        for (let sample = start; sample < end; sample++) {
            maximum = Math.max(maximum, Math.abs(pcm.readInt16LE(sample * 2)));
        }
        peaks[bucket] = maximum / 32768;
    }
    return peaks;
}

export async function getClipWaveform(
    projectRoot: string,
    videoPath: string,
    startSeconds: number,
    endSeconds: number
): Promise<GetClipWaveformResult> {
    let stat;
    try {
        stat = await fs.stat(videoPath);
    } catch {
        return { status: 'unavailable', reason: 'source-missing' };
    }
    if (!(await hasFfmpeg())) {
        return { status: 'unavailable', reason: 'ffmpeg-not-found' };
    }

    const directory = join(projectRoot, 'cache', 'timeline', 'waveform');
    const hash = cacheHash([videoPath, stat.size, stat.mtimeMs, startSeconds, endSeconds, 'waveform']);
    const destination = join(directory, `${hash}.json`);
    const temporaryPcm = `${destination}.${process.pid}.tmp`;
    try {
        await ensureCacheDirectory(directory, projectRoot);
        try {
            const peaks = JSON.parse(await fs.readFile(destination, 'utf8')) as number[];
            return { status: 'ready', peaks };
        } catch {
            // A cache miss falls through to extraction.
        }
        try {
            await execFileAsync('ffmpeg', [
                '-y', '-ss', String(startSeconds), '-to', String(endSeconds), '-i', videoPath,
                '-ac', '1', '-ar', '8000', '-f', 's16le', temporaryPcm
            ]);
        } catch {
            return { status: 'unavailable', reason: 'extraction-failed' };
        }
        const peaks = extractPeaks(await fs.readFile(temporaryPcm));
        await writeAtomic(destination, `${JSON.stringify(peaks)}\n`);
        return { status: 'ready', peaks };
    } catch {
        return { status: 'unavailable', reason: 'extraction-failed' };
    } finally {
        await fs.unlink(temporaryPcm).catch(() => undefined);
    }
}

export async function getAudioDuration(
    projectRoot: string,
    audioPath: string
): Promise<GetAudioDurationResult> {
    let stat;
    try {
        stat = await fs.stat(audioPath);
    } catch {
        return { status: 'unavailable', reason: 'source-missing' };
    }
    if (!(await hasFfprobe())) {
        return { status: 'unavailable', reason: 'ffmpeg-not-found' };
    }

    const directory = join(projectRoot, 'cache', 'timeline', 'duration');
    const hash = cacheHash([audioPath, stat.size, stat.mtimeMs, 'duration']);
    const destination = join(directory, `${hash}.json`);
    try {
        await ensureCacheDirectory(directory, projectRoot);
        try {
            const cached = JSON.parse(await fs.readFile(destination, 'utf8')) as { durationSeconds?: number };
            const durationSeconds = cached.durationSeconds;
            if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0) {
                return { status: 'ready', durationSeconds };
            }
        } catch {
            // A cache miss falls through to extraction.
        }
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            audioPath
        ]);
        const durationSeconds = Number(stdout.trim());
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            return { status: 'unavailable', reason: 'extraction-failed' };
        }
        await writeAtomic(destination, `${JSON.stringify({ durationSeconds })}\n`);
        return { status: 'ready', durationSeconds };
    } catch {
        return { status: 'unavailable', reason: 'extraction-failed' };
    }
}
