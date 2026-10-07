import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { promisify } from 'util';
import type { MaterialStripOptions, MaterialStripOutcome } from '../common/akari-project-protocol';
import { deriveThumbnailCacheKey, thumbnailCacheFileName } from './thumbnail-cache';

const execFileAsync = promisify(execFile);
const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const AUDIO = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg']);

export interface MaterialStripDeps {
    ffmpegPath: () => Promise<string | undefined>;
    durationSeconds: (sourcePath: string) => Promise<number | undefined>;
    runFfmpeg?: (binary: string, args: string[]) => Promise<void>;
}

/** Project-local, rebuildable filmstrips. No source file is modified. */
export class MaterialStripGenerator {
    private readonly inFlight = new Map<string, Promise<MaterialStripOutcome>>();
    private readonly queue: Array<() => void> = [];
    private active = 0;

    constructor(private readonly deps: MaterialStripDeps) {}

    async resolve(projectRoot: string, relativePath: string, options: MaterialStripOptions,
        cachedDurationSeconds?: number): Promise<MaterialStripOutcome> {
        const sourcePath = resolve(projectRoot, relativePath);
        const withinRoot = relative(projectRoot, sourcePath);
        if (!relativePath || isAbsolute(relativePath) || !withinRoot || withinRoot === '..'
            || withinRoot.startsWith(`..${sep}`)) return { available: false };
        const extension = extname(sourcePath).toLowerCase();
        const kind = VIDEO.has(extension) ? 'video' : AUDIO.has(extension) ? 'audio' : undefined;
        if (!kind) return { available: false };
        const cells = Math.max(1, Math.min(48, Math.round(options.cells)));
        const cellWidth = Math.max(2, Math.min(512, Math.round(options.cellWidth)));
        if (!Number.isFinite(cells) || !Number.isFinite(cellWidth)) return { available: false };
        let stat;
        try { stat = await fs.stat(sourcePath); } catch { return { available: false }; }
        if (!stat.isFile()) return { available: false };
        const key = deriveThumbnailCacheKey(`${relativePath}:${cells}:${cellWidth}:strip-v1`, stat.size, stat.mtimeMs);
        const cacheFileName = thumbnailCacheFileName(key, '.png');
        const cacheDirectory = join(projectRoot, '.akari', 'cache', 'thumbnails');
        const cachePath = join(cacheDirectory, cacheFileName);
        const cacheRelativePath = `.akari/cache/thumbnails/${cacheFileName}`;
        const cached = await fs.stat(cachePath).then(file => file.size > 0, () => false);
        if (cached) return { available: true, cacheRelativePath, cells };
        const pending = this.inFlight.get(cachePath);
        if (pending) return pending;
        const generation = this.schedule(async () => {
            const ffmpeg = await this.deps.ffmpegPath();
            if (!ffmpeg) return { available: false };
            const height = Math.max(2, Math.round(cellWidth * 9 / 16 / 2) * 2);
            let filter: string;
            if (kind === 'video') {
                const duration = cachedDurationSeconds && cachedDurationSeconds > 0
                    ? cachedDurationSeconds : await this.deps.durationSeconds(sourcePath);
                if (!duration || !Number.isFinite(duration)) return { available: false };
                filter = `fps=${cells}/${duration},scale=${cellWidth}:-2,` +
                    `crop=${cellWidth}:min(ih\\,${height}):0:(ih-oh)/2,` +
                    `pad=${cellWidth}:${height}:0:(oh-ih)/2,tile=${cells}x1`;
            } else {
                const size = `${cells * cellWidth}x${height}`;
                filter = `color=c=0x0b1a10:s=${size}[bg];` +
                    `[0:a]showwavespic=s=${size}:colors=0x3fb950:scale=sqrt,format=rgba,` +
                    `colorkey=black:0.1:0[wave];[bg][wave]overlay=shortest=1:format=auto`;
            }
            await fs.mkdir(cacheDirectory, { recursive: true });
            const temporaryPath = join(cacheDirectory, `.tmp-${process.pid}-${cacheFileName}`);
            const args = kind === 'video'
                ? ['-y', '-loglevel', 'error', '-i', sourcePath, '-vf', filter, '-frames:v', '1', temporaryPath]
                : ['-y', '-loglevel', 'error', '-i', sourcePath, '-filter_complex', filter,
                    '-frames:v', '1', temporaryPath];
            try {
                await (this.deps.runFfmpeg ?? (async (binary, command) => { await execFileAsync(binary, command); }))(ffmpeg, args);
                await fs.rename(temporaryPath, cachePath);
                return { available: true, cacheRelativePath, cells };
            } catch {
                await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
                return { available: false };
            }
        }).finally(() => this.inFlight.delete(cachePath));
        this.inFlight.set(cachePath, generation);
        return generation;
    }

    private schedule(work: () => Promise<MaterialStripOutcome>): Promise<MaterialStripOutcome> {
        return new Promise(resolvePromise => {
            this.queue.push(() => {
                this.active++;
                void work().then(resolvePromise, () => resolvePromise({ available: false })).finally(() => {
                    this.active--;
                    this.drain();
                });
            });
            this.drain();
        });
    }

    private drain(): void {
        while (this.active < 3 && this.queue.length) this.queue.shift()!();
    }
}
