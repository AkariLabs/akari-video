import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { promisify } from 'util';
import {
    GetClipThumbnailResult,
    GetClipWaveformResult,
    THUMBNAIL_WIDTH_PX,
    WAVEFORM_BUCKET_COUNT
} from '../common/akari-annotations-protocol';

const execFileAsync = promisify(execFile);
let ffmpegAvailable: Promise<boolean> | undefined;

async function hasFfmpeg(): Promise<boolean> {
    if (!ffmpegAvailable) {
        ffmpegAvailable = execFileAsync('ffmpeg', ['-version'])
            .then(() => true)
            .catch(() => false);
    }
    return ffmpegAvailable;
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
