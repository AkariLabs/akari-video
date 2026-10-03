import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { basename, join } from 'path';

export const DEFAULT_HISTORY_FILES = ['edit.json', 'captions.json'] as const;
export const DEFAULT_HISTORY_KEEP = 100;

export interface HistoryMeta {
    id: string;
    label: string;
    at: string;
    files: string[];
    sha256: Record<string, string>;
    legacy?: boolean;
    bytes?: number;
}

export interface SnapshotOptions {
    projectDir: string;
    label: string;
    files?: readonly string[];
    keep?: number;
    now?: Date;
}

export interface RestoreOptions {
    files?: readonly string[];
    write?: (files: Record<string, string>) => Promise<void>;
}

export interface RestoreResult {
    restored: HistoryMeta;
    snapshot: HistoryMeta | null;
}

const historyDir = (projectDir: string): string => join(projectDir, '.akari', 'history');
const hash = (content: Buffer | string): string => createHash('sha256').update(content).digest('hex');

function safeFiles(files: readonly string[]): string[] {
    return [...new Set(files)].filter(file => basename(file) === file && file !== '.' && file !== '..');
}

function slug(label: string): string {
    const value = label.normalize('NFKC').toLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return value || 'history';
}

async function exists(path: string): Promise<boolean> {
    try { await fs.access(path); return true; } catch { return false; }
}

async function reserveId(directory: string, base: string): Promise<string> {
    for (let serial = 1; ; serial += 1) {
        const id = serial === 1 ? base : `${base}-${serial}`;
        try { await fs.mkdir(join(directory, id)); return id; }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
    }
}

async function prune(directory: string, keep: number): Promise<void> {
    const names = await fs.readdir(directory, { withFileTypes: true });
    const directories = names.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    for (const name of directories.slice(0, Math.max(0, directories.length - keep))) {
        await fs.rm(join(directory, name), { recursive: true, force: true });
    }
}

export async function snapshot(options: SnapshotOptions): Promise<HistoryMeta | null> {
    const files = safeFiles(options.files ?? DEFAULT_HISTORY_FILES);
    const contents = new Map<string, Buffer>();
    for (const file of files) {
        try { contents.set(file, await fs.readFile(join(options.projectDir, file))); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }
    if (contents.size === 0) return null;

    const at = (options.now ?? new Date()).toISOString();
    const directory = historyDir(options.projectDir);
    await fs.mkdir(directory, { recursive: true });
    const stamp = at.replace(/[:.]/g, '-');
    const id = await reserveId(directory, `${stamp}-${slug(options.label)}`);
    const destination = join(directory, id);
    const savedFiles = [...contents.keys()];
    const meta: HistoryMeta = {
        id,
        label: options.label,
        at,
        files: savedFiles,
        sha256: Object.fromEntries([...contents].map(([file, content]) => [file, hash(content)]))
    };
    try {
        await Promise.all([...contents].map(([file, content]) => fs.writeFile(join(destination, file), content)));
        await fs.writeFile(join(destination, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
    } catch (error) {
        await fs.rm(destination, { recursive: true, force: true });
        throw error;
    }
    await prune(directory, Math.max(1, options.keep ?? DEFAULT_HISTORY_KEEP));
    return meta;
}

async function readDirectoryEntry(directory: string, id: string): Promise<HistoryMeta | null> {
    try {
        const value = JSON.parse(await fs.readFile(join(directory, id, 'meta.json'), 'utf8')) as Partial<HistoryMeta>;
        if (typeof value.label !== 'string' || typeof value.at !== 'string' || !Array.isArray(value.files)) return null;
        return {
            id,
            label: value.label,
            at: value.at,
            files: safeFiles(value.files.filter((file): file is string => typeof file === 'string')),
            sha256: value.sha256 && typeof value.sha256 === 'object' ? value.sha256 : {}
        };
    } catch { return null; }
}

async function readLegacyEntry(directory: string, name: string): Promise<HistoryMeta | null> {
    try {
        const content = await fs.readFile(join(directory, name));
        const stat = await fs.stat(join(directory, name));
        return {
            id: name,
            label: '旧プレビュー履歴',
            at: stat.mtime.toISOString(),
            files: ['edit.json'],
            sha256: { 'edit.json': hash(content) },
            legacy: true,
            bytes: stat.size
        };
    } catch { return null; }
}

export async function list(projectDir: string): Promise<HistoryMeta[]> {
    const directory = historyDir(projectDir);
    let entries: import('fs').Dirent[];
    try {
        await prune(directory, DEFAULT_HISTORY_KEEP);
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch { return []; }
    const loaded = await Promise.all(entries.map(entry => {
        if (entry.isDirectory()) return readDirectoryEntry(directory, entry.name);
        if (entry.isFile() && /^edit-[\w.-]+\.json$/.test(entry.name)) return readLegacyEntry(directory, entry.name);
        return Promise.resolve(null);
    }));
    return loaded.filter((entry): entry is HistoryMeta => entry !== null)
        .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}

const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320] as const;
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const renameRetryWarnedErrors = new WeakSet<object>();

export function renameRetryWarningLogged(error: unknown): boolean {
    return error !== null && typeof error === 'object' && renameRetryWarnedErrors.has(error);
}

/** 一時的な共有違反などで rename が拒まれたときだけ再試行する。 */
export async function renameWithRetry(source: string, destination: string): Promise<void> {
    let retries = 0;
    let waitedMs = 0;
    let failed = false;
    try {
        for (;;) {
            try {
                await fs.rename(source, destination);
                return;
            } catch (error) {
                if (!RENAME_RETRY_CODES.has((error as NodeJS.ErrnoException)?.code ?? '')
                    || retries === RENAME_RETRY_DELAYS_MS.length) {
                    failed = true;
                    if (retries > 0 && error !== null && typeof error === 'object') {
                        renameRetryWarnedErrors.add(error);
                    }
                    throw error;
                }
                const delay = RENAME_RETRY_DELAYS_MS[retries++];
                await new Promise<void>(resolve => setTimeout(resolve, delay));
                waitedMs += delay;
            }
        }
    } finally {
        if (retries > 0) {
            console.warn(`[edit-store] ${basename(destination)} の rename を ${retries} 回再試行しました（待機合計 ${waitedMs} ms、${failed ? '失敗' : '成功'}）。`);
        }
    }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
    const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
        await fs.writeFile(temporary, content);
        await renameWithRetry(temporary, filePath);
    } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
}

export async function restore(projectDir: string, id: string, options: RestoreOptions = {}): Promise<RestoreResult> {
    if (typeof id !== 'string' || basename(id) !== id || id === '.' || id === '..') {
        throw new Error('Invalid history id');
    }
    const directory = historyDir(projectDir);
    const legacy = /^edit-[\w.-]+\.json$/.test(id) && await exists(join(directory, id));
    const entry = legacy ? await readLegacyEntry(directory, id) : await readDirectoryEntry(directory, id);
    if (!entry) throw new Error('History entry not found');

    const candidates: Record<string, string> = {};
    if (legacy) {
        candidates['edit.json'] = await fs.readFile(join(directory, id), 'utf8');
    } else {
        for (const file of safeFiles(entry.files)) {
            const content = await fs.readFile(join(directory, id, file));
            if (entry.sha256[file] && hash(content) !== entry.sha256[file]) {
                throw new Error(`History file checksum mismatch: ${file}`);
            }
            candidates[file] = content.toString('utf8');
        }
    }
    if (Object.keys(candidates).length === 0) throw new Error('History entry contains no files');
    const before = await snapshot({
        projectDir,
        label: `restore-from-${id}`,
        files: options.files ?? DEFAULT_HISTORY_FILES
    });
    if (options.write) await options.write(candidates);
    else await Promise.all(Object.entries(candidates).map(([file, content]) => atomicWrite(join(projectDir, file), content)));
    return { restored: entry, snapshot: before };
}
