import { createHash, randomBytes } from 'crypto';
import { constants } from 'fs';
import {
    access,
    mkdir,
    open,
    readFile,
    readdir,
    realpath,
    rename,
    stat,
    unlink,
    writeFile
} from 'fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
    AppendReviewSessionAudioRequest,
    AppendReviewSessionEventRequest,
    AppendReviewSessionStrokeRequest,
    EndReviewSessionRequest,
    ListReviewSessionsRequest,
    ReadReviewSessionStrokesRequest,
    ReadReviewSessionStrokesResult,
    ReviewSessionSummary,
    ReviewStroke,
    StartReviewSessionRequest,
    StartReviewSessionResult
} from '../common/akari-preview-protocol';

const SESSION_DIRECTORY_PATTERN = /^s-(\d{4,})$/;
const WAV_HEADER_BYTES = 44;
const WAV_SAMPLE_RATE = 16_000;
const WAV_CHANNELS = 1;
const WAV_BITS_PER_SAMPLE = 16;
const WAV_BYTES_PER_SECOND = WAV_SAMPLE_RATE * WAV_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);

interface SessionManifest {
    version: 1;
    id: string;
    startedAt: string;
    endedAt: string;
    audio: 'audio.wav';
    editSnapshot: 'edit.snapshot.json';
    editHash: string;
    status: 'recorded';
    compiledAnnotations: null;
}

export class ReviewSessionWriter {
    constructor(protected readonly workspaceRoots: () => Promise<string[]>) {}

    async start(request: StartReviewSessionRequest): Promise<StartReviewSessionResult> {
        if (!request || !Number.isFinite(request.timelineT) || typeof request.playing !== 'boolean') {
            throw new Error('Invalid review session start request');
        }
        const projectRoot = await this.resolveProjectRoot(request.projectRootUri);
        const editPath = await realpath(this.filePath(request.editUri));
        if (!this.contains(projectRoot, editPath) || !(await stat(editPath)).isFile()) {
            throw new Error('edit.json must be a file inside the project root');
        }

        const sessionsRoot = join(projectRoot, 'review', 'sessions');
        await mkdir(sessionsRoot, { recursive: true });
        const { id, sessionDirectory } = await this.allocateSessionDirectory(sessionsRoot);
        const snapshot = await readFile(editPath);
        const editHash = `sha256:${createHash('sha256').update(snapshot).digest('hex')}`;
        const startedAt = new Date().toISOString();

        // If any write fails, keep the allocated directory and completed raw files as a recoverable orphan.
        await this.writeAtomic(join(sessionDirectory, 'edit.snapshot.json'), snapshot);
        await writeFile(join(sessionDirectory, 'audio.wav'), this.wavHeader(0), { flag: 'wx' });
        await this.appendAndSync(join(sessionDirectory, 'events.jsonl'), `${JSON.stringify({
            recT: 0,
            type: 'start',
            timelineT: request.timelineT,
            playing: request.playing
        })}\n`);

        return {
            id,
            sessionDir: pathToFileURL(sessionDirectory).toString(),
            startedAt,
            editHash
        };
    }

    async appendEvent(request: AppendReviewSessionEventRequest): Promise<void> {
        const sessionDirectory = await this.resolveSessionDirectory(request?.sessionDir);
        const event = request?.event;
        if (!event || !Number.isFinite(event.recT) || event.recT < 0) {
            throw new Error('Invalid review session event');
        }
        await this.appendAndSync(join(sessionDirectory, 'events.jsonl'), `${JSON.stringify(event)}\n`);
    }

    async appendAudio(request: AppendReviewSessionAudioRequest): Promise<void> {
        const sessionDirectory = await this.resolveSessionDirectory(request?.sessionDir);
        if (typeof request?.pcmBase64 !== 'string') {
            throw new Error('Invalid review session audio request');
        }
        const pcm = Buffer.from(request.pcmBase64, 'base64');
        if (pcm.length === 0) {
            return;
        }
        if (pcm.length % 2 !== 0) {
            throw new Error('PCM payload must contain complete 16-bit samples');
        }

        const wavPath = join(sessionDirectory, 'audio.wav');
        const handle = await open(wavPath, 'r+');
        try {
            const current = await handle.stat();
            if (current.size < WAV_HEADER_BYTES) {
                throw new Error('Review session WAV header is missing');
            }
            await handle.write(pcm, 0, pcm.length, current.size);
            await handle.sync();
            const dataBytes = current.size - WAV_HEADER_BYTES + pcm.length;
            const sizes = Buffer.alloc(8);
            sizes.writeUInt32LE(36 + dataBytes, 0);
            sizes.writeUInt32LE(dataBytes, 4);
            await handle.write(sizes.subarray(0, 4), 0, 4, 4);
            await handle.write(sizes.subarray(4), 0, 4, 40);
            await handle.sync();
        } finally {
            await handle.close();
        }
    }

    async appendStroke(request: AppendReviewSessionStrokeRequest): Promise<void> {
        const sessionDirectory = await this.resolveSessionDirectory(request?.sessionDir);
        const stroke = request?.stroke;
        if (!stroke || !/^st-\d{4,}$/.test(stroke.id)
            || stroke.space !== 'content-rect'
            || !Number.isFinite(stroke.recTStart) || stroke.recTStart < 0
            || !Number.isFinite(stroke.recTEnd) || stroke.recTEnd < stroke.recTStart
            || !Number.isFinite(stroke.frame?.timelineT)
            || !Number.isFinite(stroke.frame?.sourceT)
            || (stroke.frame?.cutIndex !== null
                && (!Number.isInteger(stroke.frame?.cutIndex) || stroke.frame.cutIndex < 0))
            || !this.isValidStrokeShape(stroke)) {
            throw new Error('Invalid review session stroke');
        }
        const strokesPath = join(sessionDirectory, 'strokes.json');
        let document: { version: 1; strokes: unknown[] } = { version: 1, strokes: [] };
        try {
            const parsed = JSON.parse(await readFile(strokesPath, 'utf8')) as {
                version?: unknown;
                strokes?: unknown;
            };
            if (parsed.version !== 1 || !Array.isArray(parsed.strokes)) {
                throw new Error('Review session strokes file is invalid');
            }
            document = { version: 1, strokes: parsed.strokes };
        } catch (error) {
            if ((error as { code?: string }).code !== 'ENOENT') {
                throw error;
            }
        }
        document.strokes.push(stroke);
        await this.writeAtomic(
            strokesPath,
            Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
        );
    }

    /**
     * task.md 指示4: the rect tool lands through this same pipeline as pen, distinguished by the
     * additive `tool` field. Points (pen) must be a normalized 0-1 polyline of at least 2 points;
     * box (rect) must be the same [x,y,w,h] normalized-0-1 shape as review.json's region.box
     * (docs/contract-2026-07-20-review-json-v1-annotation-model.md §2: x+w<=1 and y+h<=1).
     */
    protected isValidStrokeShape(stroke: ReviewStroke): boolean {
        if (stroke.tool === 'pen') {
            return Array.isArray(stroke.points) && stroke.points.length >= 2
                && stroke.points.every(point => Array.isArray(point) && point.length === 2
                    && point.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
        }
        if (stroke.tool === 'rect') {
            const box = stroke.box;
            if (!Array.isArray(box) || box.length !== 4 || !box.every(value => Number.isFinite(value))) {
                return false;
            }
            const [x, y, w, h] = box;
            return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1;
        }
        return false;
    }

    async readStrokes(request: ReadReviewSessionStrokesRequest): Promise<ReadReviewSessionStrokesResult> {
        const projectRoot = await this.resolveProjectRoot(request?.projectRootUri);
        if (typeof request?.sessionId !== 'string' || !SESSION_DIRECTORY_PATTERN.test(request.sessionId)) {
            throw new Error('Invalid review session id');
        }
        const sessionDirectory = join(projectRoot, 'review', 'sessions', request.sessionId);
        const normalized = resolve(sessionDirectory);
        if (!this.contains(projectRoot, normalized)) {
            throw new Error('The review session must be inside the current workspace');
        }
        const strokesPath = join(sessionDirectory, 'strokes.json');
        let parsed: unknown;
        try {
            parsed = JSON.parse(await readFile(strokesPath, 'utf8'));
        } catch (error) {
            if ((error as { code?: string }).code === 'ENOENT') {
                return { sessionId: request.sessionId, strokes: [], warnings: [] };
            }
            return {
                sessionId: request.sessionId,
                strokes: [],
                warnings: ['strokes.json を読み取れないため描線なしとして扱いました。']
            };
        }

        const warnings: string[] = [];
        let candidates: unknown[];
        if (Array.isArray(parsed)) {
            candidates = parsed;
            warnings.push('旧形式（配列ルート）の strokes.json を互換読み込みしました。');
        } else if (parsed && typeof parsed === 'object'
            && Array.isArray((parsed as { strokes?: unknown }).strokes)) {
            candidates = (parsed as { strokes: unknown[] }).strokes;
            if ((parsed as { version?: unknown }).version !== 1) {
                warnings.push('旧形式（version 1 以外）の strokes.json を互換読み込みしました。');
            }
        } else {
            return {
                sessionId: request.sessionId,
                strokes: [],
                warnings: ['strokes.json の形式を認識できないため描線なしとして扱いました。']
            };
        }

        const strokes: ReviewStroke[] = [];
        for (const [index, candidate] of candidates.entries()) {
            const stroke = candidate as ReviewStroke;
            if (!stroke || !/^st-\d{4,}$/.test(stroke.id)
                || stroke.space !== 'content-rect'
                || !Number.isFinite(stroke.recTStart) || stroke.recTStart < 0
                || !Number.isFinite(stroke.recTEnd) || stroke.recTEnd < stroke.recTStart
                || !Number.isFinite(stroke.frame?.timelineT)
                || !Number.isFinite(stroke.frame?.sourceT)
                || (stroke.frame?.cutIndex !== null
                    && (!Number.isInteger(stroke.frame?.cutIndex) || stroke.frame.cutIndex < 0))
                || !this.isValidStrokeShape(stroke)) {
                warnings.push(`strokes[${index}] は不正なため再表示から除外しました。`);
                continue;
            }
            strokes.push(stroke);
        }
        return { sessionId: request.sessionId, strokes, warnings };
    }

    async end(request: EndReviewSessionRequest): Promise<void> {
        const sessionDirectory = await this.resolveSessionDirectory(request?.sessionDir);
        if (!this.isIsoDate(request?.startedAt) || !this.isIsoDate(request?.endedAt)
            || typeof request?.editHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(request.editHash)
            || !Number.isFinite(request?.recT) || request.recT < 0
            || !Number.isFinite(request?.timelineT)) {
            throw new Error('Invalid review session end request');
        }
        await this.appendAndSync(join(sessionDirectory, 'events.jsonl'), `${JSON.stringify({
            recT: request.recT,
            type: 'end',
            timelineT: request.timelineT
        })}\n`);
        const id = basename(sessionDirectory);
        const manifest: SessionManifest = {
            version: 1,
            id,
            startedAt: request.startedAt,
            endedAt: request.endedAt,
            audio: 'audio.wav',
            editSnapshot: 'edit.snapshot.json',
            editHash: request.editHash,
            status: 'recorded',
            compiledAnnotations: null
        };
        await this.writeAtomic(
            join(sessionDirectory, 'session.json'),
            Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
        );
    }

    async list(request: ListReviewSessionsRequest): Promise<ReviewSessionSummary[]> {
        const projectRoot = await this.resolveProjectRoot(request?.projectRootUri);
        const sessionsRoot = join(projectRoot, 'review', 'sessions');
        let entries;
        try {
            entries = await readdir(sessionsRoot, { withFileTypes: true });
        } catch (error) {
            if ((error as { code?: string }).code === 'ENOENT') {
                return [];
            }
            throw error;
        }

        const summaries: ReviewSessionSummary[] = [];
        for (const entry of entries
            .filter(candidate => candidate.isDirectory() && SESSION_DIRECTORY_PATTERN.test(candidate.name))
            .sort((left, right) => left.name.localeCompare(right.name))) {
            const sessionDirectory = join(sessionsRoot, entry.name);
            const manifestPath = join(sessionDirectory, 'session.json');
            try {
                await access(manifestPath, constants.F_OK);
            } catch {
                summaries.push(await this.orphanSummary(entry.name, sessionDirectory));
                continue;
            }
            try {
                const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
                if (parsed.version !== 1 || parsed.id !== entry.name
                    || !this.isIsoDate(parsed.startedAt) || !this.isIsoDate(parsed.endedAt)
                    || parsed.audio !== 'audio.wav' || parsed.editSnapshot !== 'edit.snapshot.json'
                    || typeof parsed.editHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(parsed.editHash)
                    || (parsed.status !== 'recorded' && parsed.status !== 'transcribed' && parsed.status !== 'compiled')) {
                    throw new Error('manifest fields are invalid');
                }
                summaries.push({
                    id: entry.name,
                    startedAt: parsed.startedAt,
                    endedAt: parsed.endedAt,
                    durationSec: await this.wavDuration(join(sessionDirectory, 'audio.wav')),
                    orphaned: false
                });
            } catch (error) {
                console.warn(`[akari-preview] skipping damaged review session ${entry.name}`, error);
            }
        }
        return summaries;
    }

    protected async resolveProjectRoot(uri: string | undefined): Promise<string> {
        if (typeof uri !== 'string') {
            throw new Error('A project root URI is required');
        }
        const projectRoot = await realpath(this.filePath(uri));
        if (!(await stat(projectRoot)).isDirectory()) {
            throw new Error('The project root must be a directory');
        }
        const roots = await this.workspaceRoots();
        if (!roots.some(root => this.contains(root, projectRoot))) {
            throw new Error('The project root must be inside the current workspace');
        }
        return projectRoot;
    }

    protected async resolveSessionDirectory(uri: string | undefined): Promise<string> {
        if (typeof uri !== 'string') {
            throw new Error('A review session directory URI is required');
        }
        const sessionDirectory = await realpath(this.filePath(uri));
        if (!(await stat(sessionDirectory)).isDirectory()
            || !SESSION_DIRECTORY_PATTERN.test(basename(sessionDirectory))) {
            throw new Error('Invalid review session directory');
        }
        const normalized = resolve(sessionDirectory);
        if (basename(dirname(normalized)) !== 'sessions' || basename(dirname(dirname(normalized))) !== 'review') {
            throw new Error('Review sessions must be stored under review/sessions');
        }
        const roots = await this.workspaceRoots();
        if (!roots.some(root => this.contains(root, normalized))) {
            throw new Error('The review session must be inside the current workspace');
        }
        return normalized;
    }

    protected async allocateSessionDirectory(sessionsRoot: string): Promise<{ id: string; sessionDirectory: string }> {
        const entries = await readdir(sessionsRoot, { withFileTypes: true });
        let next = entries.reduce((maximum, entry) => {
            const match = entry.isDirectory() ? SESSION_DIRECTORY_PATTERN.exec(entry.name) : null;
            return match ? Math.max(maximum, Number(match[1])) : maximum;
        }, 0) + 1;
        while (Number.isSafeInteger(next)) {
            const id = `s-${String(next).padStart(4, '0')}`;
            const sessionDirectory = join(sessionsRoot, id);
            try {
                await mkdir(sessionDirectory);
                return { id, sessionDirectory };
            } catch (error) {
                if ((error as { code?: string }).code !== 'EEXIST') {
                    throw error;
                }
                next += 1;
            }
        }
        throw new Error('Review session sequence exceeded the safe integer range');
    }

    protected wavHeader(dataBytes: number): Buffer {
        const header = Buffer.alloc(WAV_HEADER_BYTES);
        header.write('RIFF', 0, 'ascii');
        header.writeUInt32LE(36 + dataBytes, 4);
        header.write('WAVE', 8, 'ascii');
        header.write('fmt ', 12, 'ascii');
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(WAV_CHANNELS, 22);
        header.writeUInt32LE(WAV_SAMPLE_RATE, 24);
        header.writeUInt32LE(WAV_BYTES_PER_SECOND, 28);
        header.writeUInt16LE(WAV_CHANNELS * (WAV_BITS_PER_SAMPLE / 8), 32);
        header.writeUInt16LE(WAV_BITS_PER_SAMPLE, 34);
        header.write('data', 36, 'ascii');
        header.writeUInt32LE(dataBytes, 40);
        return header;
    }

    protected async wavDuration(path: string): Promise<number> {
        try {
            const handle = await open(path, 'r');
            try {
                const header = Buffer.alloc(WAV_HEADER_BYTES);
                const result = await handle.read(header, 0, header.length, 0);
                if (result.bytesRead !== WAV_HEADER_BYTES
                    || header.toString('ascii', 0, 4) !== 'RIFF'
                    || header.toString('ascii', 8, 12) !== 'WAVE') {
                    return 0;
                }
                return header.readUInt32LE(40) / WAV_BYTES_PER_SECOND;
            } finally {
                await handle.close();
            }
        } catch {
            return 0;
        }
    }

    protected async orphanSummary(id: string, sessionDirectory: string): Promise<ReviewSessionSummary> {
        const directoryStat = await stat(sessionDirectory);
        return {
            id,
            startedAt: directoryStat.birthtime.toISOString(),
            endedAt: null,
            durationSec: await this.wavDuration(join(sessionDirectory, 'audio.wav')),
            orphaned: true
        };
    }

    protected async appendAndSync(path: string, content: string): Promise<void> {
        const handle = await open(path, 'a');
        try {
            await handle.writeFile(content, 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
    }

    protected async writeAtomic(destination: string, content: Buffer): Promise<void> {
        await mkdir(dirname(destination), { recursive: true });
        const temporary = `${destination}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
        try {
            const handle = await open(temporary, 'wx');
            try {
                await handle.writeFile(content);
                await handle.sync();
            } finally {
                await handle.close();
            }
            await rename(temporary, destination);
        } catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
        }
    }

    protected filePath(uri: string): string {
        const parsed = new URL(uri);
        if (parsed.protocol !== 'file:') {
            throw new Error('Only local file URIs are supported');
        }
        return fileURLToPath(parsed);
    }

    protected contains(root: string, target: string): boolean {
        const path = relative(root, target);
        return path === '' || (!path.startsWith('..') && !isAbsolute(path));
    }

    protected isIsoDate(value: unknown): value is string {
        return typeof value === 'string' && Number.isFinite(Date.parse(value));
    }
}
