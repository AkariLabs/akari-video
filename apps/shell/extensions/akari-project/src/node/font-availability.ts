import { createHash, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { constants, promises as fs } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';
import { promisify } from 'util';

const run = promisify(execFile);
const EXTENSION = /\.(?:ttf|otf|woff2?)$/i;
type FontEntry = { family: string; file: string; bytes: number; sha256: string; url: string;
    ofl: { file: string; bytes: number; sha256: string; url?: string; text?: string } };
export type FontManifest = { commit: string; fonts: Record<string, FontEntry> };
export type FontAvailability = { status: 'available' | 'download' | 'source' | 'pending' | 'failed'; family: string;
    source?: 'bundled' | 'library' | 'system'; bytes?: number };
export type FontCandidate = { id: string; title: string; aliases?: string[] };

export function normalizeFontName(name: string): string {
    return name.normalize('NFKC').replace(/[\s\u3000._-]+/gu, '').toLocaleLowerCase();
}

export async function fontLibraryRoot(env: NodeJS.ProcessEnv = process.env): Promise<string> {
    if (env.AKARI_LIBRARY_ROOT) return env.AKARI_LIBRARY_ROOT;
    const home = env.AKARI_HOME || join(homedir(), '.akari');
    try {
        const location = JSON.parse(await fs.readFile(join(home, 'library-location.json'), 'utf8'));
        if (typeof location.root === 'string' && (location.state === 'done' || location.state === 'migrating')) return location.root;
        if (typeof location.previousRoot === 'string') return location.previousRoot;
    } catch { /* default location */ }
    return join(home, 'assets');
}

function addName(names: Map<string, string>, value: unknown, family?: string): void {
    if (typeof value === 'string' && value.trim()) names.set(normalizeFontName(value), family || value);
}

type SfntName = { id: number; value: string; priority: number };

function sfntName(buffer: Buffer, offset: number, length: number, platform: number): string | undefined {
    if (offset < 0 || length < 1 || offset + length > buffer.length) return undefined;
    try {
        if (platform === 1) return new TextDecoder('macintosh').decode(buffer.subarray(offset, offset + length)).trim() || undefined;
        if (platform !== 0 && platform !== 3 || length % 2) return undefined;
        let value = '';
        for (let index = offset; index < offset + length; index += 2) value += String.fromCharCode(buffer.readUInt16BE(index));
        return value.replace(/\0/gu, '').trim() || undefined;
    } catch { return undefined; }
}

/** sfnt の英語名を CSS に使える family へ対応づける。TTC は全サブフォントを読む。 */
export function sfntFontNames(buffer: Buffer): Map<string, string> {
    const names = new Map<string, string>();
    try {
        const collection = buffer.toString('ascii', 0, 4) === 'ttcf';
        const offsets: number[] = [];
        if (collection) {
            if (buffer.length < 12) return names;
            const count = buffer.readUInt32BE(8);
            if (count > 256 || 12 + count * 4 > buffer.length) return names;
            for (let index = 0; index < count; index++) offsets.push(buffer.readUInt32BE(12 + index * 4));
        } else offsets.push(0);
        for (const fontOffset of offsets) {
            if (fontOffset + 12 > buffer.length) continue;
            const signature = buffer.toString('ascii', fontOffset, fontOffset + 4);
            if (!['\0\x01\0\0', 'OTTO', 'true', 'typ1'].includes(signature)) continue;
            const tableCount = buffer.readUInt16BE(fontOffset + 4);
            if (tableCount > 256 || fontOffset + 12 + tableCount * 16 > buffer.length) continue;
            const records: SfntName[] = [];
            for (let index = 0; index < tableCount; index++) {
                const table = fontOffset + 12 + index * 16;
                if (buffer.toString('ascii', table, table + 4) !== 'name') continue;
                const tableOffset = buffer.readUInt32BE(table + 8);
                const tableLength = buffer.readUInt32BE(table + 12);
                if (tableLength < 6 || tableOffset + tableLength > buffer.length) break;
                const count = buffer.readUInt16BE(tableOffset + 2);
                const stringOffset = buffer.readUInt16BE(tableOffset + 4);
                if (6 + count * 12 > tableLength) break;
                for (let nameIndex = 0; nameIndex < count; nameIndex++) {
                    const record = tableOffset + 6 + nameIndex * 12;
                    const platform = buffer.readUInt16BE(record);
                    const language = buffer.readUInt16BE(record + 4);
                    const id = buffer.readUInt16BE(record + 6);
                    if (![1, 16, 4, 6].includes(id)) continue;
                    const length = buffer.readUInt16BE(record + 8);
                    const start = stringOffset + buffer.readUInt16BE(record + 10);
                    if (start + length > tableLength) continue;
                    const value = sfntName(buffer, tableOffset + start, length, platform);
                    if (!value) continue;
                    const priority = platform === 3 && language === 0x0409 ? 3
                        : platform === 1 && language === 0 ? 2 : platform === 0 ? 1 : 0;
                    records.push({ id, value, priority });
                }
                break;
            }
            const family = records.filter(record => record.id === 16 || record.id === 1)
                .sort((left, right) => right.priority - left.priority || (right.id === 16 ? 1 : 0) - (left.id === 16 ? 1 : 0))[0]?.value
                ?? records.find(record => record.id === 4)?.value;
            if (family) for (const record of records) addName(names, record.value, family);
        }
    } catch { /* 壊れたフォントは他の書体の判定を妨げない。 */ }
    return names;
}

export async function macSystemFontNames(fonts: unknown,
    readFontFile: (path: string) => Promise<Buffer> = path => fs.readFile(path)): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const paths = new Set<string>();
    for (const font of Array.isArray(fonts) ? fonts : []) {
        if (font.enabled === 'no') continue;
        for (const face of Array.isArray(font.typefaces) ? font.typefaces : []) {
            if (face.enabled === 'no') continue;
            const family = face.family || face.fullname || face._name;
            addName(names, family);
            addName(names, face.fullname, family);
            addName(names, face._name, family);
            const path = typeof face.path === 'string' ? face.path : font.path;
            if (typeof path === 'string' && /\.(?:ttf|otf|ttc)$/i.test(path)) paths.add(path);
        }
    }
    const pending = [...paths];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
        while (next < pending.length) {
            const path = pending[next++];
            try {
                for (const [key, value] of sfntFontNames(await readFontFile(path))) names.set(key, value);
            } catch { /* 読めないファイルだけ飛ばす。 */ }
        }
    }));
    return names;
}

export type SystemFontSnapshot = { phase: 'ready' | 'pending' | 'failed'; names?: ReadonlyMap<string, string> };

/** 同時要求は走査を共有する。失敗を成功扱いでキャッシュせず、再試行だけ間隔を空ける。 */
export function createSystemFontScanner(scan: () => Promise<Map<string, string>>,
    now: () => number = Date.now, retryMs = 30000): {
        snapshot(refresh?: boolean): SystemFontSnapshot;
        wait(timeoutMs: number): Promise<SystemFontSnapshot>;
    } {
    let names: Map<string, string> | undefined;
    let running: Promise<void> | undefined;
    let failedAt: number | undefined;
    const start = (refresh = false): void => {
        if (running || !refresh && names && failedAt === undefined
            || failedAt !== undefined && now() - failedAt < retryMs) return;
        running = Promise.resolve().then(scan).then(result => {
            names = result;
            failedAt = undefined;
        }).catch(() => { failedAt = now(); }).finally(() => { running = undefined; });
    };
    const snapshot = (refresh = false): SystemFontSnapshot => {
        start(refresh);
        return { phase: running ? 'pending' : failedAt !== undefined ? 'failed' : 'ready', names };
    };
    return {
        snapshot,
        async wait(timeoutMs): Promise<SystemFontSnapshot> {
            start();
            if (running) {
                let timer: ReturnType<typeof setTimeout> | undefined;
                try { await Promise.race([running, new Promise<void>(resolve => {
                    timer = setTimeout(resolve, timeoutMs);
                })]); } finally { if (timer) clearTimeout(timer); }
            }
            return snapshot();
        }
    };
}

const systemScanner = createSystemFontScanner(collectSystemFontNames);
export function clearSystemFontCache(): void { systemScanner.snapshot(true); }
export function systemFontSnapshot(): SystemFontSnapshot { return systemScanner.snapshot(); }
export async function waitForSystemFontNames(timeoutMs = 2500): Promise<SystemFontSnapshot> {
    return systemScanner.wait(timeoutMs);
}

async function collectSystemFontNames(): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (process.platform === 'darwin') {
        const { stdout } = await run('system_profiler', ['SPFontsDataType', '-json'], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
        const fonts = JSON.parse(stdout).SPFontsDataType;
        return macSystemFontNames(fonts);
    } else if (process.platform === 'linux') {
        const { stdout } = await run('fc-list', ['--format', '%{family}|%{postscriptname}\n'], { maxBuffer: 32 * 1024 * 1024 });
        for (const line of stdout.split('\n')) {
            const [families, postscript] = line.split('|');
            const family = families?.split(',')[0];
            for (const name of families?.split(',') ?? []) addName(names, name, family);
            addName(names, postscript, family);
        }
    } else if (process.platform === 'win32') {
        const windows = process.env.WINDIR || 'C:\\Windows';
        const dirs = [join(windows, 'Fonts'), join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts')];
        for (const dir of dirs) {
            for (const entry of await fs.readdir(dir).catch(() => [])) {
                if (EXTENSION.test(entry)) addName(names, basename(entry).replace(EXTENSION, ''));
            }
        }
        const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command',
            'Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name'],
        { maxBuffer: 16 * 1024 * 1024 });
        for (const family of stdout.split(/\r?\n/)) addName(names, family);
    }
    return names;
}

async function libraryFonts(root: string): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const id of await fs.readdir(join(root, 'font')).catch(() => [])) {
        const dir = join(root, 'font', id);
        const files = await fs.readdir(dir).catch(() => []);
        if (!files.some(file => EXTENSION.test(file))) continue;
        try {
            const meta = JSON.parse(await fs.readFile(join(dir, 'meta.json'), 'utf8'));
            const family = meta.title?.replace(/（.*$/u, '').trim();
            addName(names, family);
            for (const alias of meta.aliases ?? []) addName(names, alias, family);
        } catch { /* ignore malformed library item */ }
    }
    return names;
}

export async function resolveFontAvailability(items: readonly FontCandidate[], manifest: FontManifest,
    bundled: readonly { id: string; family: string }[], options: {
        libraryRoot?: string; system?: ReadonlyMap<string, string>; systemPhase?: SystemFontSnapshot['phase'] } = {}): Promise<Map<string, FontAvailability>> {
    const library = await libraryFonts(options.libraryRoot ?? await fontLibraryRoot());
    const snapshot = options.system ? undefined : systemFontSnapshot();
    const system = options.system ?? snapshot?.names ?? new Map<string, string>();
    const phase = options.systemPhase ?? (options.system ? 'ready' : snapshot?.phase ?? 'pending');
    const result = new Map<string, FontAvailability>();
    for (const item of items) {
        const display = item.title.replace(/（.*$/u, '').trim();
        const candidates = [display, ...(item.aliases ?? [])].map(normalizeFontName);
        const bundledFace = bundled.find(face => face.id === item.id);
        const inLibrary = candidates.map(name => library.get(name)).find(Boolean);
        const onSystem = candidates.map(name => system.get(name)).find(Boolean);
        result.set(item.id, bundledFace ? { status: 'available', family: bundledFace.family, source: 'bundled' }
            : inLibrary ? { status: 'available', family: inLibrary, source: 'library' }
            : onSystem ? { status: 'available', family: onSystem, source: 'system' }
            : phase === 'pending' || phase === 'failed' ? { status: phase, family: display,
                bytes: manifest.fonts[item.id]?.bytes }
            : manifest.fonts[item.id] ? { status: 'download', family: manifest.fonts[item.id].family,
                bytes: manifest.fonts[item.id].bytes }
            : { status: 'source', family: display });
    }
    return result;
}

export async function readFontManifest(catalogRoot: string): Promise<FontManifest> {
    return JSON.parse(await fs.readFile(join(catalogRoot, 'font', 'download-manifest.json'), 'utf8'));
}

async function verifiedBytes(url: string, bytes: number, sha256: string, timeoutMs = 60000): Promise<Buffer> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'raw.githubusercontent.com'
        || !/^\/google\/fonts\/[a-f0-9]{40}\/ofl\//.test(parsed.pathname)) throw new Error('取得先を確認できません。');
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`フォントを取得できませんでした (${response.status})。`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== bytes || createHash('sha256').update(data).digest('hex') !== sha256)
        throw new Error('取得したフォントの検証に失敗しました。');
    return data;
}

const fontDownloads = new Map<string, Promise<void>>();
export function downloadFont(id: string, title: string, aliases: string[], manifest: FontManifest,
    root?: string, timeoutMs = 60000): Promise<void> {
    const existing = fontDownloads.get(id);
    if (existing) return existing;
    const work = downloadFontOnce(id, title, aliases, manifest, root, timeoutMs)
        .finally(() => { if (fontDownloads.get(id) === work) fontDownloads.delete(id); });
    fontDownloads.set(id, work);
    return work;
}

async function downloadFontOnce(id: string, title: string, aliases: string[], manifest: FontManifest,
    root: string | undefined, timeoutMs: number): Promise<void> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('フォント ID が不正です。');
    const entry = manifest.fonts[id];
    if (!entry) throw new Error('この書体は配布元から入手してください。');
    const [font, license] = await Promise.all([
        verifiedBytes(entry.url, entry.bytes, entry.sha256, timeoutMs),
        entry.ofl.url ? verifiedBytes(entry.ofl.url, entry.ofl.bytes, entry.ofl.sha256, timeoutMs)
            : Promise.resolve(Buffer.from(entry.ofl.text ?? '', 'utf8'))
    ]);
    if (license.length !== entry.ofl.bytes || createHash('sha256').update(license).digest('hex') !== entry.ofl.sha256)
        throw new Error('ライセンスの検証に失敗しました。');
    const parent = join(root ?? await fontLibraryRoot(), 'font');
    await fs.mkdir(parent, { recursive: true });
    const temp = join(parent, `.${id}-${randomUUID()}`);
    await fs.mkdir(temp);
    try {
        await fs.writeFile(join(temp, entry.file), font);
        await fs.writeFile(join(temp, 'OFL.txt'), license);
        await fs.writeFile(join(temp, 'meta.json'), JSON.stringify({ id, category: 'font', title: entry.family || title,
            aliases, tags: ['font', 'japanese'], license: { spdx: 'OFL-1.1' } }, null, 2));
        await fs.access(join(temp, entry.file), constants.R_OK);
        await fs.rename(temp, join(parent, id));
    } catch (error) {
        await fs.rm(temp, { recursive: true, force: true });
        throw error;
    }
}
