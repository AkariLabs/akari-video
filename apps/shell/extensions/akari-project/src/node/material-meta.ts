import { execFile } from 'child_process';
import { promises as fs, Stats } from 'fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { promisify } from 'util';
import type { MaterialMetaEntry } from '../common/akari-project-protocol';
import { deriveThumbnailCacheKey } from './thumbnail-cache';

const execFileAsync = promisify(execFile);
const PROBE_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi',
    '.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg']);

export interface MaterialMetaOptions {
    ffprobePath: () => Promise<string | undefined>;
    runFfprobe?: (binary: string, args: string[]) => Promise<string>;
}

function isoDate(date: Date): string | undefined {
    return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date.toISOString() : undefined;
}

function importedAt(stat: Stats): string {
    return isoDate(stat.birthtime) ?? isoDate(stat.ctime) ?? isoDate(stat.mtime) ?? new Date(0).toISOString();
}

function createdAt(stat: Stats): string | undefined {
    return isoDate(stat.birthtime) ?? isoDate(stat.mtime);
}

function positiveNumber(value: unknown): number | undefined {
    const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function probeFields(stdout: string): { durationSeconds?: number; createdAt?: string; width?: number; height?: number } {
    try {
        const parsed = JSON.parse(stdout) as {
            format?: { duration?: unknown; tags?: { creation_time?: unknown } };
            streams?: Array<{ width?: unknown; height?: unknown }>;
        };
        const tagged = parsed.format?.tags?.creation_time;
        const timestamp = typeof tagged === 'string' ? isoDate(new Date(tagged)) : undefined;
        return {
            durationSeconds: positiveNumber(parsed.format?.duration),
            createdAt: timestamp,
            width: positiveNumber(parsed.streams?.[0]?.width),
            height: positiveNumber(parsed.streams?.[0]?.height)
        };
    } catch {
        return {};
    }
}

function validCache(value: unknown): Record<string, MaterialMetaEntry> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const entries: Record<string, MaterialMetaEntry> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (/^[a-f0-9]{16}$/.test(key) && entry && typeof entry === 'object'
            && typeof (entry as MaterialMetaEntry).importedAt === 'string') {
            entries[key] = entry as MaterialMetaEntry;
        }
    }
    return entries;
}

/** Project-local, rebuildable metadata. Calls for one project are serialized to preserve cache writes. */
export class MaterialMetaReader {
    private readonly projectCalls = new Map<string, Promise<void>>();
    private readonly runFfprobe: (binary: string, args: string[]) => Promise<string>;

    constructor(private readonly options: MaterialMetaOptions) {
        this.runFfprobe = options.runFfprobe ?? (async (binary, args) => (await execFileAsync(binary, args)).stdout);
    }

    async read(projectRoot: string, relativePaths: string[]): Promise<Record<string, MaterialMetaEntry>> {
        const previous = this.projectCalls.get(projectRoot) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolvePromise => { release = resolvePromise; });
        this.projectCalls.set(projectRoot, current);
        await previous;
        try {
            return await this.readBatch(projectRoot, relativePaths);
        } finally {
            release();
            if (this.projectCalls.get(projectRoot) === current) this.projectCalls.delete(projectRoot);
        }
    }

    private async readBatch(projectRoot: string, relativePaths: string[]): Promise<Record<string, MaterialMetaEntry>> {
        const cachePath = join(projectRoot, '.akari', 'cache', 'material-meta.json');
        let cache: Record<string, MaterialMetaEntry> = {};
        try { cache = validCache(JSON.parse(await fs.readFile(cachePath, 'utf8'))); } catch { /* Rebuild corrupt or absent cache. */ }
        const result: Record<string, MaterialMetaEntry> = {};
        const paths = [...new Set(relativePaths)];
        let next = 0;
        let changed = false;
        const binary = await this.options.ffprobePath().catch(() => undefined);
        const worker = async (): Promise<void> => {
            while (next < paths.length) {
                const relativePath = paths[next++];
                const source = resolve(projectRoot, relativePath);
                const withinRoot = relative(projectRoot, source);
                if (!relativePath || isAbsolute(relativePath) || !withinRoot || withinRoot === '..'
                    || withinRoot.startsWith(`..${sep}`)) continue;
                let stat: Stats;
                try { stat = await fs.stat(source); } catch { continue; }
                if (!stat.isFile()) continue;
                const key = deriveThumbnailCacheKey(relativePath, stat.size, stat.mtimeMs);
                const cached = cache[key];
                if (cached) { result[relativePath] = cached; continue; }
                const entry: MaterialMetaEntry = { importedAt: importedAt(stat) };
                if (binary) {
                    let fields: ReturnType<typeof probeFields> = {};
                    if (PROBE_EXTENSIONS.has(extname(source).toLowerCase())) {
                        try {
                            fields = probeFields(await this.runFfprobe(binary, [
                                '-v', 'error', '-show_entries', 'format=duration:format_tags=creation_time:stream=width,height',
                                '-of', 'json', source
                            ]));
                        } catch { /* File metadata still remains useful. */ }
                    }
                    if (fields.durationSeconds !== undefined) entry.durationSeconds = fields.durationSeconds;
                    const creation = fields.createdAt ?? createdAt(stat);
                    if (creation !== undefined) entry.createdAt = creation;
                    if (fields.width !== undefined) entry.width = fields.width;
                    if (fields.height !== undefined) entry.height = fields.height;
                    cache[key] = entry;
                    changed = true;
                }
                result[relativePath] = entry;
            }
        };
        await Promise.all([worker(), worker()]);
        if (changed) {
            try {
                await fs.mkdir(join(projectRoot, '.akari', 'cache'), { recursive: true });
                await fs.writeFile(cachePath, JSON.stringify(cache), 'utf8');
            } catch { /* Cache failure must not prevent material metadata. */ }
        }
        return result;
    }
}
