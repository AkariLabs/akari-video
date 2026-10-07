import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import { inkFromStrokes, strokesFromInk, validateInk } from '../common/ink-model';
import {
    AkariRoughCanvasService, ReadRoughCanvasMemoResult, RoughCanvasManifest,
    SaveRoughCanvasMemoRequest
} from '../common/rough-canvas-protocol';

const PNG_PREFIX = 'data:image/png;base64,';
const MAX_PNG_BYTES = 16 * 1024 * 1024;
const memoId = (id: string): boolean => /^c-\d{4,}$/.test(id);
const fsPath = (uri: string): string => {
    const parsed = new URI(uri);
    if (parsed.scheme !== 'file') throw new Error('ファイルの場所が不正です。');
    return resolve(parsed.path.fsPath());
};
export function decodeRoughCanvasPng(image: string): Buffer {
    if (typeof image !== 'string' || image.length > MAX_PNG_BYTES * 2
        || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
        throw new Error('PNG のデータ形式が不正です。');
    }
    const bytes = Buffer.from(image.slice(PNG_PREFIX.length), 'base64');
    if (bytes.length > MAX_PNG_BYTES || bytes.length < 24
        || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || bytes.toString('ascii', 12, 16) !== 'IHDR'
        || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1) {
        throw new Error('PNG のヘッダまたはサイズが不正です。');
    }
    return bytes;
}
async function realDirectory(path: string, create = false): Promise<void> {
    if (create) {
        try { await fs.mkdir(path); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const info = await fs.lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error('保存先は実ディレクトリである必要があります。');
    }
}
async function canvasRoot(projectRootUri: string): Promise<string> {
    const project = fsPath(projectRootUri);
    await realDirectory(project);
    const review = join(project, 'review');
    await realDirectory(review, true);
    const canvas = join(review, 'canvas');
    await realDirectory(canvas, true);
    return canvas;
}
async function existingDirectory(root: string, id: string): Promise<string> {
    if (!memoId(id)) throw new Error('メモの番号が不正です。');
    const path = join(root, id);
    await realDirectory(path);
    return path;
}
async function allocateDirectory(root: string): Promise<{ id: string; path: string }> {
    const entries = await fs.readdir(root, { withFileTypes: true });
    let next = entries.reduce((max, entry) => {
        const match = entry.isDirectory() ? /^c-(\d{4,})$/.exec(entry.name) : null;
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    while (Number.isSafeInteger(next)) {
        const id = `c-${String(next).padStart(4, '0')}`;
        const path = join(root, id);
        try { await fs.mkdir(path); await realDirectory(path); return { id, path }; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; next++; }
    }
    throw new Error('メモの採番上限に達しました。');
}
async function atomic(path: string, content: string | Buffer): Promise<void> {
    const temp = join(dirname(path), `.${randomUUID()}.tmp`);
    try { await fs.writeFile(temp, content, { flag: 'wx' }); await fs.rename(temp, path); }
    finally { await fs.rm(temp, { force: true }).catch(() => undefined); }
}
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

@injectable()
export class AkariRoughCanvasServiceImpl implements AkariRoughCanvasService {
    async saveMemo(request: SaveRoughCanvasMemoRequest): Promise<{ id: string | null }> {
        if (!request?.projectRootUri || !request.aspect
            || !Number.isFinite(request.aspect.w) || request.aspect.w <= 0
            || !Number.isFinite(request.aspect.h) || request.aspect.h <= 0
            || !request.subject || request.subject.doc !== 'edit.json') throw new Error('メモの内容が不正です。');
        const check = validateInk(request.ink);
        if (check.errors.length) throw new Error(`線のデータが不正です: ${check.errors.join(', ')}`);
        const memo = typeof request.memo === 'string' ? request.memo.trim() : '';
        if (request.id) {
            const existing = await existingDirectory(await canvasRoot(request.projectRootUri), request.id);
            const manifest = JSON.parse(await fs.readFile(join(existing, 'canvas.json'), 'utf8')) as RoughCanvasManifest;
            if (manifest.sealed) throw new Error('このメモは送信済みのため変更できません。');
        }
        if (!request.ink.objects.length && !memo && !request.backdrop) return { id: null };
        const paper = decodeRoughCanvasPng(request.paperPng);
        const backdrop = request.backdrop ? decodeRoughCanvasPng(request.backdrop.image) : undefined;
        const root = await canvasRoot(request.projectRootUri);
        const location = request.id ? { id: request.id, path: await existingDirectory(root, request.id) }
            : await allocateDirectory(root);
        let previous: RoughCanvasManifest | undefined;
        if (request.id) {
            previous = JSON.parse(await fs.readFile(join(location.path, 'canvas.json'), 'utf8')) as RoughCanvasManifest;
            if (previous.sealed) throw new Error('このメモは送信済みのため変更できません。');
        }
        const size: [number, number] = [paper.readUInt32BE(16), paper.readUInt32BE(20)];
        const manifest: RoughCanvasManifest = {
            version: 0, id: location.id, createdAt: previous?.createdAt ?? new Date().toISOString(),
            aspect: request.aspect, aspectSource: request.aspectSource, background: null,
            audio: null, memo: memo || null, status: previous?.status ?? 'recorded', compiledAnnotations: null,
            paper: { file: 'paper.png', size, inkSha256: createHash('sha256').update(json(request.ink)).digest('hex') },
            ink: 'ink.json',
            backdrop: request.backdrop ? { file: 'backdrop.png', kind: 'preview-frame',
                outputT: request.backdrop.outputT, timelineId: request.backdrop.timelineId,
                editSha256: request.backdrop.editSha256 } : null,
            subject: request.subject, ...(request.speech ? { speech: request.speech } : {}),
            exits: previous?.exits ?? [], sealed: false
        };
        const strokes = strokesFromInk(request.ink).map((stroke, index) => ({
            id: `st-${String(index + 1).padStart(4, '0')}`, ...stroke
        }));
        await atomic(join(location.path, 'ink.json'), json(request.ink));
        await atomic(join(location.path, 'paper.png'), paper);
        if (backdrop) await atomic(join(location.path, 'backdrop.png'), backdrop);
        else await fs.rm(join(location.path, 'backdrop.png'), { force: true });
        await atomic(join(location.path, 'strokes.json'), json({ version: 1, strokes }));
        if (request.speech?.engine === 'typed' && memo) {
            await atomic(join(location.path, 'transcript.json'), json({ engine: 'typed', locale: 'ja-JP',
                segments: [{ t0: request.speech.openedRecT, t1: request.speech.span[1], text: memo, kind: 'speech' }] }));
        } else await fs.rm(join(location.path, 'transcript.json'), { force: true });
        await atomic(join(location.path, 'canvas.json'), json(manifest));
        // Memo backdrops are working evidence; do not add them to Git history automatically.
        return { id: location.id };
    }

    async sealMemo(projectRootUri: string, id: string, exit: 'task' | 'send'): Promise<void> {
        if (exit !== 'task' && exit !== 'send') throw new Error('出口が不正です。');
        const path = join(await existingDirectory(await canvasRoot(projectRootUri), id), 'canvas.json');
        const canvas = JSON.parse(await fs.readFile(path, 'utf8')) as RoughCanvasManifest;
        canvas.sealed = true;
        canvas.exits = [...(canvas.exits ?? []), { kind: exit, at: new Date().toISOString() }];
        await atomic(path, json(canvas));
    }

    async readMemo(projectRootUri: string, id: string): Promise<ReadRoughCanvasMemoResult> {
        const path = await existingDirectory(await canvasRoot(projectRootUri), id);
        const canvas = JSON.parse(await fs.readFile(join(path, 'canvas.json'), 'utf8')) as RoughCanvasManifest;
        const warnings: string[] = [];
        let ink;
        try {
            ink = JSON.parse(await fs.readFile(join(path, 'ink.json'), 'utf8'));
            if (validateInk(ink).errors.length) throw new Error('invalid ink');
        } catch {
            const strokes = JSON.parse(await fs.readFile(join(path, 'strokes.json'), 'utf8')) as { strokes: [] };
            ink = inkFromStrokes(strokes.strokes, canvas.aspect);
            warnings.push('線のデータを以前の形式から復元しました。');
        }
        const image = async (name: string): Promise<string | undefined> => {
            try { return `${PNG_PREFIX}${(await fs.readFile(join(path, name))).toString('base64')}`; }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
        };
        return { canvas, ink, paperDataUrl: await image('paper.png'),
            backdropDataUrl: canvas.backdrop ? await image('backdrop.png') : undefined, warnings };
    }

    async hashEdit(editUri: string): Promise<string> {
        return createHash('sha256').update(await fs.readFile(fsPath(editUri))).digest('hex');
    }
}
