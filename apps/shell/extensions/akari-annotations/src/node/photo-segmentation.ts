import { createHash, randomUUID } from 'crypto';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join, resolve, sep } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { commitPhotoMask } from './photo-mask-storage';

const run = promisify(execFile);
const MODEL_BASE = 'https://huggingface.co/apple/coreml-sam2.1-tiny/resolve/main';
const MODEL_NAMES = ['ImageEncoder', 'PromptEncoder', 'MaskDecoder'] as const;
const MODEL_FILES = ['Manifest.json', 'Data/com.apple.CoreML/model.mlmodel', 'Data/com.apple.CoreML/weights/weight.bin'] as const;
export const photoModelDirectory = (): string => join(homedir(), 'Library', 'Caches', 'AKARI Video', 'photo-models', 'sam2.1-tiny');

export interface PhotoCandidate { id: string; label: string; png: string; area?: number; score?: number }
export type PhotoCandidates = { ok: true; inputSha256: string; candidates: PhotoCandidate[] }
    | { ok: false; message: string };

async function sourceHash(path: string): Promise<string> {
    return createHash('sha256').update(await fs.readFile(path)).digest('hex');
}

async function cacheFolder(projectRoot: string, hash: string): Promise<string> {
    const root = await fs.realpath(projectRoot);
    const folder = resolve(root, '.akari', 'cache', 'photo-masks', hash);
    for (const directory of [join(root, '.akari'), join(root, '.akari', 'cache'),
        join(root, '.akari', 'cache', 'photo-masks'), folder]) {
        await fs.mkdir(directory, { recursive: true });
        if (!(await fs.realpath(directory)).startsWith(root + sep)) throw new Error('プロジェクト外には保存できません');
    }
    return folder;
}

async function candidatesFrom(folder: string, values: Array<{ id: string; label?: string; file: string; area?: number; score?: number }>,
    inputSha256: string): Promise<PhotoCandidates> {
    const candidates: PhotoCandidate[] = [];
    for (const value of values) {
        if (!/^[a-z0-9-]+\.png$/u.test(value.file)) throw new Error('候補の保存名が不正です');
        const png = await fs.readFile(join(folder, value.file));
        candidates.push({ id: value.id, label: value.label ?? value.id,
            png: png.toString('base64'), ...(value.area === undefined ? {} : { area: value.area }),
            ...(value.score === undefined ? {} : { score: value.score }) });
    }
    return { ok: true, inputSha256, candidates };
}

export async function visionCandidates(projectRoot: string, input: string, helper: string | undefined,
    mode: 'foreground' | 'people'): Promise<PhotoCandidates> {
    if (!helper || !await fs.stat(helper).then(value => value.isFile()).catch(() => false))
        return { ok: false, message: 'この Mac では使えません' };
    const hash = await sourceHash(input);
    const folder = await cacheFolder(projectRoot, hash);
    const target = join(folder, `vision-${mode}`);
    const manifest = join(target, 'manifest.json');
    let values: Array<{ id: string; label: string; file: string }>;
    try { values = JSON.parse(await fs.readFile(manifest, 'utf8')).instances; }
    catch {
        await fs.mkdir(target, { recursive: true });
        const { stdout } = await run(helper, ['instances', input, target, mode], { timeout: 120_000, maxBuffer: 1024 * 1024 });
        values = JSON.parse(stdout.trim()).instances;
        await fs.writeFile(manifest, JSON.stringify({ instances: values }));
    }
    if (await sourceHash(input) !== hash) return { ok: false, message: '処理中に写真が変わりました' };
    return candidatesFrom(target, values.map(value => ({ ...value, id: `vision-${mode}--${value.id}` })), hash);
}

export async function ensurePhotoModels(onProgress?: (done: number, total: number) => void,
    root = photoModelDirectory()): Promise<string> {
    if (process.platform !== 'darwin') throw new Error('この Mac では使えません');
    let done = 0;
    for (const name of MODEL_NAMES) for (const relative of MODEL_FILES) {
        const target = join(root, `SAM2_1Tiny${name}FLOAT16.mlpackage`, relative);
        if (!await fs.stat(target).then(value => value.size > 0).catch(() => false)) {
            await fs.mkdir(resolve(target, '..'), { recursive: true });
            const url = `${MODEL_BASE}/SAM2_1Tiny${name}FLOAT16.mlpackage/${relative}`;
            const response = await fetch(url);
            if (!response.ok || !response.body) throw new Error('モデルを取得できませんでした');
            const temp = `${target}.${randomUUID()}.download`;
            try {
                await pipeline(Readable.fromWeb(response.body as any), (await import('fs')).createWriteStream(temp, { flags: 'wx' }));
                await fs.rename(temp, target);
            } finally { await fs.rm(temp, { force: true }); }
        }
        onProgress?.(++done, MODEL_NAMES.length * MODEL_FILES.length);
    }
    return root;
}

class SamConnection {
    private child: ChildProcessWithoutNullStreams | undefined;
    private pending: Array<{ resolve: (value: any) => void; reject: (reason: unknown) => void }> = [];
    private buffer = '';
    private startPromise: Promise<void> | undefined;
    async start(helper: string, models: string): Promise<void> {
        if (this.child && !this.child.killed) return;
        if (this.startPromise) return this.startPromise;
        this.startPromise = new Promise<void>((resolveStart, rejectStart) => {
            const child = spawn(helper, ['sam-serve', models], { stdio: 'pipe' });
            this.child = child;
            const timer = setTimeout(() => {
                child.kill();
                rejectStart(new Error('モデルの準備が終わりませんでした'));
            }, 60_000);
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', chunk => {
                this.buffer += chunk;
                while (this.buffer.includes('\n')) {
                    const index = this.buffer.indexOf('\n');
                    const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
                    try {
                        const value = JSON.parse(line);
                        if (value.ready) { clearTimeout(timer); resolveStart(); }
                        else this.pending.shift()?.resolve(value);
                    } catch { /* malformed helper output is ignored until timeout */ }
                }
            });
            child.on('error', error => { clearTimeout(timer); rejectStart(error); this.pending.splice(0).forEach(p => p.reject(error)); this.child = undefined; });
            child.on('exit', () => {
                clearTimeout(timer);
                const error = new Error('この Mac では使えません');
                rejectStart(error); this.pending.splice(0).forEach(p => p.reject(error)); this.child = undefined;
            });
        }).finally(() => { this.startPromise = undefined; });
        return this.startPromise;
    }
    request(value: Record<string, unknown>): Promise<any> {
        if (!this.child) return Promise.reject(new Error('この Mac では使えません'));
        return new Promise((resolveRequest, reject) => {
            this.pending.push({ resolve: resolveRequest, reject });
            this.child!.stdin.write(JSON.stringify(value) + '\n');
        });
    }
}

const sam = new SamConnection();
let preparedHash = '';
let preparingHash = '';
let preparing: Promise<{ ok: boolean; message?: string; inputSha256?: string }> | undefined;
export async function preparePhotoClick(input: string, helper: string | undefined): Promise<{ ok: boolean; message?: string; inputSha256?: string }> {
    if (!helper || !await fs.stat(helper).then(value => value.isFile()).catch(() => false))
        return { ok: false, message: 'この Mac では使えません' };
    const hash = await sourceHash(input);
    if (preparedHash === hash) return { ok: true, inputSha256: hash };
    if (preparingHash === hash && preparing) return preparing;
    preparingHash = hash;
    preparing = (async () => {
        try {
            const models = await ensurePhotoModels();
            await sam.start(helper, models);
            const result = await sam.request({ op: 'prepare', input, hash });
            if (!result.ok || await sourceHash(input) !== hash) return { ok: false, message: '処理中に写真が変わりました' };
            preparedHash = hash;
            return { ok: true, inputSha256: hash };
        } catch { return { ok: false, message: 'この Mac では使えません' }; }
    })();
    const result = await preparing;
    if (preparingHash === hash) { preparing = undefined; preparingHash = ''; }
    return result;
}

export async function clickPhoto(projectRoot: string, input: string, x: number, y: number,
    helper: string | undefined): Promise<PhotoCandidates> {
    if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
        return { ok: false, message: '写真の上を押してください' };
    const hash = await sourceHash(input);
    if (preparedHash !== hash) {
        const ready = await preparePhotoClick(input, helper);
        if (!ready.ok) return { ok: false, message: ready.message ?? 'この Mac では使えません' };
    }
    const folder = join(await cacheFolder(projectRoot, hash), `sam-${randomUUID()}`);
    const result = await sam.request({ op: 'click', hash, x, y, output: folder });
    if (!result.ok || await sourceHash(input) !== hash) return { ok: false, message: '処理中に写真が変わりました' };
    const values = (result.candidates as Array<{ id: string; file: string; area: number; score: number }>).sort((a, b) => a.area - b.area);
    return candidatesFrom(folder, values.map((value, index) => ({ ...value, id: `${folder.split('/').pop()}--${value.id}`,
        label: ['狭く', '中間', '広く'][index]! })), hash);
}

export async function adoptPhotoCandidate(projectRoot: string, input: string, candidate: string,
    inputSha256: string, engine: 'apple-vision' | 'sam2.1-tiny'): Promise<Awaited<ReturnType<typeof commitPhotoMask>>> {
    if (!/^[a-z0-9-]+$/u.test(candidate) || !/^[a-f0-9]{64}$/u.test(inputSha256))
        return { ok: false, message: '候補が見つかりません' };
    const folder = await cacheFolder(projectRoot, inputSha256);
    const files = candidateCachePath(folder, candidate);
    const path = (await Promise.all(files.map(async file => await fs.stat(file).then(() => file).catch(() => undefined)))).find(Boolean);
    if (!path) return { ok: false, message: '候補が見つかりません' };
    const png = await fs.readFile(path);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    return commitPhotoMask(projectRoot, input, png,
        { engine, request: candidate, width, height, parameters: {} }, inputSha256);
}

export async function adoptPhotoCandidates(projectRoot: string, input: string, candidates: string[],
    inputSha256: string, engine: 'apple-vision' | 'sam2.1-tiny', helper: string | undefined,
    invert = false): Promise<Awaited<ReturnType<typeof commitPhotoMask>>> {
    if (!helper || !candidates.length || candidates.length > 32 || !/^[a-f0-9]{64}$/u.test(inputSha256))
        return { ok: false, message: 'この Mac では使えません' };
    const folder = await cacheFolder(projectRoot, inputSha256);
    const paths: string[] = [];
    for (const candidate of candidates) {
        if (!/^[a-z0-9-]+$/u.test(candidate)) return { ok: false, message: '候補が見つかりません' };
        const possible = candidateCachePath(folder, candidate);
        const found = (await Promise.all(possible.map(async path => await fs.stat(path).then(() => path).catch(() => undefined)))).find(Boolean);
        if (!found) return { ok: false, message: '候補が見つかりません' };
        paths.push(found);
    }
    const output = join(folder, `combined-${randomUUID()}.png`);
    try {
        await run(helper, ['combine', output, invert ? 'invert' : 'normal', ...paths], { timeout: 120_000 });
        const png = await fs.readFile(output);
        return commitPhotoMask(projectRoot, input, png, { engine, request: invert ? 'inverse-instances' : 'instances',
            parameters: { candidates }, width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, inputSha256);
    } finally { await fs.rm(output, { force: true }); }
}

export function candidateCachePath(folder: string, candidate: string): string[] {
    const parts = candidate.split('--');
    if (parts.length !== 2 || !/^(vision-(foreground|people)|sam-[a-f0-9-]{36})$/u.test(parts[0]!)
        || !/^(all|person-\d+|subject-\d+|candidate-[0-2])$/u.test(parts[1]!)) return [];
    return [join(folder, parts[0]!, `${parts[1]}.png`)];
}
