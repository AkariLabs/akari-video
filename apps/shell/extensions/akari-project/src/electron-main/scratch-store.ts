import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { basename, join, resolve, sep } from 'path';
import { planScratchCleanup, CleanupEntry } from '../common/scratch-cleanup';
import { makeScratchSource, SCRATCH_ID, ScratchSource, validateScratchSource, scratchLabel } from '../common/scratch-source';
import { renderScratchThumbnail, ScratchThumbnail } from './scratch-thumbnail';

export interface ScratchListItem {
    ref: string; id: string; kind: 'scratch-image'; origin: 'external'; label: string;
    badges: ['外', '利用条件: 不明']; status: 'ready' | 'url_only'; path?: string; thumb?: string;
    quality: 'thumbnail' | 'full' | 'unknown'; capturedAt: string; flags: string[];
}
export function scratchRoot(): string { return join(resolve(process.env.AKARI_HOME ?? join(homedir(), '.akari')), 'scratch'); }
const active = new Set<string>();
let listing = 0;
interface ListThumbnailImage {
    isEmpty(): boolean;
    getSize(): { width: number; height: number };
    resize(size: { width: number; height: number }): ListThumbnailImage;
    toJPEG(quality: number): Buffer;
}
const LIST_THUMB_DATA_URI_MAX = 24 * 1024;
function thumbDataUri(bytes: Buffer): string | undefined {
    const uri = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    return uri.length <= LIST_THUMB_DATA_URI_MAX ? uri : undefined;
}
export function listThumbnailDataUri(bytes: Buffer,
    decode: (value: Buffer) => ListThumbnailImage = value => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- Defer Electron loading while keeping webpack resolution static.
        const electron = require('@theia/core/electron-shared/electron') as typeof import('@theia/core/electron-shared/electron');
        return electron.nativeImage.createFromBuffer(value);
    }): string | undefined {
    const original = thumbDataUri(bytes);
    if (original) return original;
    try {
        const image = decode(bytes);
        if (image.isEmpty()) return undefined;
        const { width, height } = image.getSize();
        if (width <= 0 || height <= 0) return undefined;
        for (const [edge, quality] of [[96, 60], [80, 55], [64, 50]]) {
            const ratio = Math.min(1, edge / Math.max(width, height));
            const resized = ratio < 1 ? image.resize({ width: Math.max(1, Math.round(width * ratio)),
                height: Math.max(1, Math.round(height * ratio)) }) : image;
            const uri = thumbDataUri(resized.toJPEG(quality));
            if (uri) return uri;
        }
    } catch { /* No thumbnail when the decoder does not support this image. */ }
    return undefined;
}
function idNow(now: Date): string {
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    return `${stamp}-${time}-${randomBytes(3).toString('hex')}`;
}
async function readSource(dir: string): Promise<ScratchSource | undefined> {
    try { const path = join(dir, 'source.json'); const stat = await fs.lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
        const value = JSON.parse(await fs.readFile(path, 'utf8')); return validateScratchSource(value) ? value : undefined; }
    catch { return undefined; }
}
async function allSources(root: string): Promise<ScratchSource[]> {
    const result: ScratchSource[] = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || !SCRATCH_ID.test(entry.name)) continue;
        const source = await readSource(join(root, entry.name)); if (source && source.id === entry.name) result.push(source);
    }
    return result;
}
export async function saveScratch(input: {
    bytes?: Buffer; mime?: string; pageUrl: string; imageUrl?: string; linkUrl?: string; pageTitle: string; alt: string;
    resolvedFrom: string; via: ScratchSource['via']; width?: number; height?: number;
    search?: { engine: string; query: string } | null; dataBytes?: number;
}, root = scratchRoot(), thumbnail?: (bytes: Buffer) => ScratchThumbnail | Promise<ScratchThumbnail>,
renderThumbnail: (path: string) => Promise<ScratchThumbnail> = renderScratchThumbnail): Promise<{ source: ScratchSource; duplicate: boolean }> {
    await fs.mkdir(root, { recursive: true });
    const hash = input.bytes ? createHash('sha256').update(input.bytes).digest('hex') : undefined;
    if (hash) {
        const existing = (await allSources(root)).find(source => source.status === 'ready' && source.app.sha256 === hash);
        if (existing) return { source: existing, duplicate: true };
    }
    const now = new Date(); const id = idNow(now); const temp = join(root, `${id}.tmp-${randomBytes(3).toString('hex')}`);
    active.add(temp);
    try {
        await fs.mkdir(temp);
        if (input.bytes) {
            const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
                'image/avif': 'avif' } as Record<string, string>)[input.mime ?? ''];
            if (!ext) throw new Error('unsupported image');
            await fs.writeFile(join(temp, `image.${ext}`), input.bytes);
            const rendered: ScratchThumbnail = thumbnail ? await thumbnail(input.bytes) : input.mime === 'image/webp'
                || input.mime === 'image/gif' || input.mime === 'image/avif'
                ? await renderThumbnail(join(temp, `image.${ext}`)).catch(() => ({})) : (() => {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires -- Defer Electron loading while keeping webpack resolution static.
                    const electron = require('@theia/core/electron-shared/electron') as typeof import('@theia/core/electron-shared/electron');
                    const image = electron.nativeImage.createFromBuffer(input.bytes!);
                    if (image.isEmpty()) return {};
                    const size = image.getSize();
                    const ratio = Math.min(1, 512 / Math.max(size.width, size.height));
                    const scaled = ratio < 1 ? image.resize({ width: Math.max(1, Math.round(size.width * ratio)),
                        height: Math.max(1, Math.round(size.height * ratio)) }) : image;
                    return { bytes: scaled.toJPEG(70), width: size.width, height: size.height };
                } catch { return {}; }
            })();
            input.width = rendered.width; input.height = rendered.height;
            if (rendered.bytes) await fs.writeFile(join(temp, 'thumb.jpg'), rendered.bytes);
        }
        const source = makeScratchSource({ id, status: input.bytes ? 'ready' : 'url_only', capturedAt: now,
            via: input.via, pageUrl: input.pageUrl, imageUrl: input.imageUrl, linkUrl: input.linkUrl,
            pageTitle: input.pageTitle, alt: input.alt, resolvedFrom: input.resolvedFrom,
            mime: input.mime, bytes: input.bytes?.length, width: input.width, height: input.height,
            sha256: hash, search: input.search, dataBytes: input.dataBytes });
        await fs.writeFile(join(temp, 'source.json'), JSON.stringify(source, null, 2));
        await fs.rename(temp, join(root, id));
        return { source, duplicate: false };
    } catch (error) { await fs.rm(temp, { recursive: true, force: true }); throw error; }
    finally { active.delete(temp); }
}
export async function listScratch(root = scratchRoot(), engineName?: (id: string) => string | undefined,
    decodeThumb?: (value: Buffer) => ListThumbnailImage): Promise<ScratchListItem[]> {
    listing++;
    try {
        const sources = (await allSources(root)).sort((a, b) => b.captured_at.localeCompare(a.captured_at)).slice(0, 50);
        const listed = await Promise.all(sources.map(async source => {
            const dir = join(root, source.id);
            const file = source.status === 'ready' ? `image.${({ 'image/jpeg': 'jpg', 'image/png': 'png',
                'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' } as Record<string, string>)[source.app.mime ?? '']}` : undefined;
            const path = file && await fs.lstat(join(dir, file)).then(stat =>
                stat.isFile() && !stat.isSymbolicLink() ? join(dir, file) : undefined).catch(() => undefined);
            if (source.status === 'ready' && !path) return undefined;
            const thumbStat = await fs.lstat(join(dir, 'thumb.jpg')).catch(() => undefined);
            const thumbBytes = thumbStat?.isFile() && !thumbStat.isSymbolicLink()
                ? await fs.readFile(join(dir, 'thumb.jpg')).catch(() => undefined) : undefined;
            const thumb = thumbBytes ? listThumbnailDataUri(thumbBytes, decodeThumb) : undefined;
            return { ref: `scratch:${source.id}`, id: source.id, kind: 'scratch-image' as const, origin: 'external' as const,
                label: scratchLabel(source.app, source.app.search ? engineName?.(source.app.search.engine) : undefined),
                badges: ['外', '利用条件: 不明'] as ['外', '利用条件: 不明'],
                status: source.status, path, thumb, quality: source.app.quality, capturedAt: source.captured_at,
                flags: source.flags.length ? ['injection-suspect'] : [] };
        }));
        return listed.filter((item): item is NonNullable<typeof item> => !!item);
    } finally { listing--; }
}
export async function cleanupScratch(root = scratchRoot(), now = Date.now()): Promise<void> {
    if (listing || active.size) return;
    const rootStat = await fs.lstat(root).catch(() => undefined);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return;
    const entries: CleanupEntry[] = [];
    for (const item of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!item.isDirectory() || item.isSymbolicLink()) continue;
        const path = join(root, item.name);
        if (active.has(path)) continue;
        const stat = await fs.lstat(path);
        if (item.name.includes('.tmp-')) { entries.push({ name: item.name, capturedAt: stat.mtimeMs, bytes: 0, pinned: false }); continue; }
        if (!SCRATCH_ID.test(item.name)) continue;
        const source = await readSource(path); if (!source) continue;
        const children = await fs.readdir(path, { withFileTypes: true });
        let bytes = 0;
        for (const child of children) if (child.isFile()) bytes += (await fs.stat(join(path, child.name))).size;
        entries.push({ name: item.name, capturedAt: Date.parse(source.captured_at), bytes, pinned: source.user.pinned });
    }
    for (const name of planScratchCleanup(entries, now)) {
        if (basename(name) !== name || !/^(?:\d{8}-\d{6}-[a-f0-9]{6})(?:\.tmp-[a-f0-9]+)?$/u.test(name)) continue;
        const path = resolve(root, name);
        if (!path.startsWith(resolve(root) + sep)) continue;
        const stat = await fs.lstat(path).catch(() => undefined);
        if (stat?.isDirectory() && !stat.isSymbolicLink() && !active.has(path) && !listing) await fs.rm(path, { recursive: true, force: true });
    }
}
