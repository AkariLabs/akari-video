import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import {
    ClipFilmstripChunk,
    FILMSTRIP_CHUNK_SECONDS,
    FILMSTRIP_COLS,
    FILMSTRIP_FPS,
    FILMSTRIP_FRAME_WIDTH_PX,
    FILMSTRIP_MAX_FRAMES_PER_CHUNK,
    GetAudioDurationResult,
    GetClipFilmstripChunkResult,
    GetClipThumbnailResult,
    GetClipWaveformResult,
    THUMBNAIL_WIDTH_PX,
    WAVEFORM_BUCKET_COUNT
} from '../common/akari-annotations-protocol';
import { planFilmstripChunk } from '../common/filmstrip-geometry';

const execFileAsync = promisify(execFile);

// task/2026-07-31-shell-ffmpeg-bundle: PATH に ffmpeg/ffprobe が無い環境向けのフォールバック。
// 優先順位は packages/media-bin の resolveFfmpeg/resolveFfprobe と揃える（明示指定 env → PATH →
// アプリ同梱バイナリ）。media-bin をそのまま import しないのは apps/shell/extensions/akari-preview/
// src/node/hevc-proxy.ts と同じ理由（この extension の tsconfig は rootDir: src で閉じており、
// media-bin 側の require('ffmpeg-static') が asar 化されたバックエンドから解決できる保証もない）。
// 同梱バイナリの実体は apps/shell/package.json の extraResources（resources/vendor-ffmpeg →
// Resources/media-bin、prepackage の bundle-ffmpeg-binaries.mjs が生成）。
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

async function ffmpegPath(): Promise<string | undefined> {
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

async function ffprobePath(): Promise<string | undefined> {
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

async function hasFfmpeg(): Promise<boolean> {
    return (await ffmpegPath()) !== undefined;
}

async function hasFfprobe(): Promise<boolean> {
    return (await ffprobePath()) !== undefined;
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
            // 静止画ソース（cuts[].src の画像対応）は尺 0 のため -ss を付けると
            // 「先頭より後ろへのシーク」になり 1 フレームも出力されない。時刻指定なしで
            // その 1 フレームをそのまま使う。
            await execFileAsync(await ffmpegPath() ?? 'ffmpeg', [
                '-y',
                ...(isFilmstripImageSource(videoPath) ? [] : ['-ss', String(atSeconds)]),
                '-i', videoPath,
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
// フィルムストリップ atlas（T2 → T3 でチャンク分割）
//
// 単位は「素材のソース時間チャンク」（`floor(sourceT / FILMSTRIP_CHUNK_SECONDS)`）。
// T2 は素材全体を 1 パスでフルデコードしていたため長尺素材で初回表示が遅かった
// （62 分素材で実測 294 秒）。T3 ではチャンク境界をソース時刻の等間隔グリッドに
// 固定し（クリップの in/out やトリムに依存しない）、可視範囲に重なるチャンクだけを
// `-ss <chunkStart>`（-i より前 = キーフレームシーク）+ `-t <CHUNK>` でオンデマンド
// 生成する。キャッシュキーは素材 path + size/mtime + frameWidth/fps + chunkIndex
// のみで、クリップの in/out は含まない（トリムでは再焼成しない性質は T2 から継承）。
//
// 置き場所は project-structure-v0 契約の正準パス（.akari/cache/）。既存の
// レガシー `cache/timeline/`（getClipThumbnail 等）とは意図的に分離し、移設しない。
// T2 の全体 atlas キャッシュ（旧ハッシュ体系のファイル）はキー体系が変わるため
// 自然に不使用となる（読み捨て、削除処理は行わない）。
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

async function probeForFilmstrip(videoPath: string, isImage: boolean): Promise<FilmstripProbe | undefined> {
    try {
        const { stdout } = await execFileAsync(await ffprobePath() ?? 'ffprobe', [
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
        if (!width || !height) {
            return undefined;
        }
        // 静止画は ffprobe が format.duration を報告しない（契約
        // docs/contract-2026-08-12-still-image-cut-source-v0.md §2.3 と同じ実測）。ここで
        // duration を必須にすると下流の isImage 分岐（1 フレーム atlas）が永遠に届かない
        // dead code になる — 静止画クリップがタイムラインで灰色のままだった原因。
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            return isImage ? { durationSeconds: 0, width, height } : undefined;
        }
        return { durationSeconds, width, height };
    } catch {
        return undefined;
    }
}

type FilmstripChunkMeta = Omit<ClipFilmstripChunk, 'atlasUri'>;

async function readFilmstripChunk(atlasPath: string, metaPath: string): Promise<ClipFilmstripChunk | undefined> {
    try {
        const [metaRaw] = await Promise.all([fs.readFile(metaPath, 'utf8'), fs.access(atlasPath)]);
        const meta = JSON.parse(metaRaw) as Partial<FilmstripChunkMeta>;
        if (
            typeof meta.frameWidth !== 'number' || typeof meta.frameHeight !== 'number'
            || typeof meta.cols !== 'number' || typeof meta.rows !== 'number'
            || typeof meta.frameCount !== 'number' || typeof meta.fps !== 'number'
            || typeof meta.chunkIndex !== 'number' || typeof meta.chunkStartSeconds !== 'number'
            || typeof meta.chunkDurationSeconds !== 'number'
        ) {
            return undefined;
        }
        return { ...(meta as FilmstripChunkMeta), atlasUri: pathToFileURL(atlasPath).toString() };
    } catch {
        return undefined;
    }
}

export async function getClipFilmstripChunk(
    projectRoot: string,
    videoPath: string,
    chunkIndex: number,
    requestedFrameWidth?: number,
    requestedFps?: number
): Promise<GetClipFilmstripChunkResult> {
    const frameWidth = evenUp(
        requestedFrameWidth !== undefined && requestedFrameWidth > 0 ? requestedFrameWidth : FILMSTRIP_FRAME_WIDTH_PX
    );
    const fps = requestedFps !== undefined && requestedFps > 0 ? requestedFps : FILMSTRIP_FPS;
    const isImage = isFilmstripImageSource(videoPath);
    // 静止画は「チャンク」概念を持たない（常に同じ 1 フレーム）。どの chunkIndex が
    // 要求されても cacheChunkIndex=0 に丸めて同一キャッシュへ収束させ、クリップの
    // 表示尺が 120s を跨いでも重複生成しない。
    const cacheChunkIndex = isImage ? 0 : chunkIndex;

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
    const hash = cacheHash([
        videoPath, stat.size, stat.mtimeMs, frameWidth, fps, FILMSTRIP_CHUNK_SECONDS, cacheChunkIndex, 'filmstrip-chunk-v1'
    ]);
    const atlasPath = join(directory, `${hash}.jpg`);
    const metaPath = join(directory, `${hash}.json`);

    try {
        await ensureAkariCacheDirectory(directory, projectRoot);

        const cached = await readFilmstripChunk(atlasPath, metaPath);
        if (cached) {
            return { status: 'ready', chunk: { ...cached, chunkIndex } };
        }

        const probe = await probeForFilmstrip(videoPath, isImage);
        if (!probe) {
            return { status: 'unavailable', reason: 'extraction-failed' };
        }
        const frameHeight = evenUp(frameWidth * probe.height / probe.width);

        const plan = isImage
            ? { chunkStartSeconds: 0, chunkDurationSeconds: probe.durationSeconds }
            : planFilmstripChunk(probe.durationSeconds, cacheChunkIndex);
        if (!plan) {
            return { status: 'unavailable', reason: 'extraction-failed' };
        }
        const { chunkStartSeconds, chunkDurationSeconds } = plan;

        let frameCount: number;
        let effectiveFps: number;
        if (isImage) {
            frameCount = 1;
            effectiveFps = fps;
        } else {
            const rawCount = Math.max(1, Math.ceil(chunkDurationSeconds * fps));
            if (rawCount > FILMSTRIP_MAX_FRAMES_PER_CHUNK) {
                effectiveFps = FILMSTRIP_MAX_FRAMES_PER_CHUNK / chunkDurationSeconds;
                frameCount = FILMSTRIP_MAX_FRAMES_PER_CHUNK;
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
            const args = isImage
                ? [
                    '-y', '-v', 'error', '-i', videoPath,
                    '-vf', vf, '-frames:v', '1', '-q:v', '4', '-pix_fmt', 'yuvj420p',
                    '-f', 'image2', temporary
                ]
                : [
                    '-y', '-v', 'error',
                    // -ss を -i より前に置くキーフレームシーク（デマルチプレクサ側シーク）。
                    // チャンク境界のわずかな前後ズレは許容し、素材全長のフルデコードを避ける。
                    '-ss', String(chunkStartSeconds), '-i', videoPath, '-t', String(chunkDurationSeconds),
                    '-vf', vf, '-frames:v', '1', '-q:v', '4', '-pix_fmt', 'yuvj420p',
                    // 出力先は `<hash>.jpg.<pid>.tmp`（拡張子が .tmp）なのでコンテナ自動判定が効かない。
                    // getClipThumbnail と同じく -f で明示する。
                    '-f', 'image2', temporary
                ];
            await execFileAsync(await ffmpegPath() ?? 'ffmpeg', args);
            await fs.rename(temporary, atlasPath);
        } catch {
            await fs.unlink(temporary).catch(() => undefined);
            return { status: 'unavailable', reason: 'extraction-failed' };
        }

        const meta: FilmstripChunkMeta = {
            frameWidth, frameHeight, cols, rows, frameCount, fps: effectiveFps,
            chunkIndex: cacheChunkIndex, chunkStartSeconds, chunkDurationSeconds
        };
        await writeAtomic(metaPath, `${JSON.stringify(meta)}\n`);
        return { status: 'ready', chunk: { ...meta, atlasUri: pathToFileURL(atlasPath).toString(), chunkIndex } };
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
            await execFileAsync(await ffmpegPath() ?? 'ffmpeg', [
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
        const { stdout } = await execFileAsync(await ffprobePath() ?? 'ffprobe', [
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
