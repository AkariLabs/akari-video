import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { promisify } from 'util';
import {
    AkariAnnotationsService,
    Annotation,
    CreateAnnotationRequest,
    CreateAnnotationResult,
    GetClipThumbnailRequest,
    GetClipThumbnailResult,
    GetClipWaveformRequest,
    GetClipWaveformResult,
    InsertCaptionRequest,
    InsertOverlayRequest,
    MoveOverlayRequest,
    RemoveCaptionRequest,
    RemoveOverlayRequest,
    ReorderCutsRequest,
    ResizeOverlayRequest,
    ResolveAnnotationRequest,
    ShiftCaptionRequest,
    TrimCutRequest,
    WriteBackResult
} from '../common/akari-annotations-protocol';
import * as mediaCache from './media-cache';
import {
    appendAnnotationLine,
    emptyReviewSource,
    nextAnnotationId,
    normalizeInsertPosition,
    normalizeRefs,
    normalizeRegion,
    normalizeStrokes,
    normalizeTargetKind,
    parseReview,
    updateStatusLine
} from '../common/annotation-store';
import { insertCaptionLine, removeCaptionLine, shiftCaptionLine } from '../common/caption-store';
import {
    insertOverlayInSource,
    moveOverlayInSource,
    removeOverlayInSource,
    reorderCutsInSource,
    resizeOverlayInSource,
    trimCutInSource
} from '../common/edit-store';

const execFileAsync = promisify(execFile);

@injectable()
export class AkariAnnotationsServiceImpl implements AkariAnnotationsService {

    async getClipThumbnail(request: GetClipThumbnailRequest): Promise<GetClipThumbnailResult> {
        if (!request?.projectRootUri || !request?.videoUri) {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        return mediaCache.getClipThumbnail(
            this.fsPath(request.projectRootUri), this.fsPath(request.videoUri), request.atSeconds
        );
    }

    async getClipWaveform(request: GetClipWaveformRequest): Promise<GetClipWaveformResult> {
        if (!request?.projectRootUri || !request?.videoUri) {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        return mediaCache.getClipWaveform(
            this.fsPath(request.projectRootUri), this.fsPath(request.videoUri),
            request.startSeconds, request.endSeconds
        );
    }

    async createAnnotation(request: CreateAnnotationRequest): Promise<CreateAnnotationResult> {
        if (!request?.reviewUri || !request?.projectRootUri || typeof request.text !== 'string' || !request.text.trim()) {
            throw new Error('注釈の内容を入力してください。');
        }
        if (!Number.isFinite(request.sourceT) || request.sourceT < 0) {
            throw new Error('注釈の時刻が不正です。');
        }
        const reviewPath = this.fsPath(request.reviewUri);
        const root = this.fsPath(request.projectRootUri);

        let baseSource: string;
        try {
            baseSource = await fs.readFile(reviewPath, 'utf8');
        } catch {
            baseSource = emptyReviewSource();
        }
        const { annotations } = parseReview(baseSource);
        const id = nextAnnotationId(annotations);
        const fieldWarnings: string[] = [];
        const sourceRange = Array.isArray(request.sourceRange)
            && request.sourceRange.length === 2
            && request.sourceRange.every(entry => Number.isFinite(entry))
            && request.sourceRange[0] < request.sourceRange[1]
            ? [request.sourceRange[0], request.sourceRange[1]] as [number, number]
            : null;
        const annotation: Annotation = {
            id,
            createdAt: new Date().toISOString(),
            src: typeof request.src === 'string' && request.src.trim() ? request.src : null,
            sourceT: request.sourceT,
            sourceRange,
            // timelineT は非推奨（契約 §1）。リクエスト値は無視し常に null で保存する
            timelineT: null,
            target: request.target ?? null,
            targetKind: normalizeTargetKind(request.targetKind, id, fieldWarnings),
            region: normalizeRegion(request.region, id, fieldWarnings),
            strokes: normalizeStrokes(request.strokes, id, fieldWarnings),
            refs: normalizeRefs(request.refs, id, fieldWarnings),
            insertPosition: normalizeInsertPosition(request.insertPosition, id, fieldWarnings),
            intent: typeof request.intent === 'string' && request.intent.trim() ? request.intent : null,
            text: request.text,
            input: 'typed',
            audio: null,
            poses: null,
            status: 'open',
            response: null
        };
        if (fieldWarnings.length > 0) {
            console.warn('[akari-annotations] createAnnotation:', fieldWarnings.join(' '));
        }
        const updated = appendAnnotationLine(baseSource, annotation);
        await this.writeAtomic(reviewPath, updated);

        let committed = false;
        try {
            await this.recordGateEvent(root, reviewPath, annotation.id);
            committed = await this.commitIfOwnRoot(root, 'レビューコメントを追加');
        } catch (error) {
            console.warn('[akari-annotations] event/commit skipped:', error);
        }
        return { annotation, committed };
    }

    async resolveAnnotation(request: ResolveAnnotationRequest): Promise<{ annotation: Annotation }> {
        if (!request?.reviewUri || !request?.annotationId) {
            throw new Error('対象の注釈を特定できません。');
        }
        const reviewPath = this.fsPath(request.reviewUri);
        const source = await fs.readFile(reviewPath, 'utf8');
        const updated = updateStatusLine(source, request.annotationId, ['addressed'], 'resolved');
        await this.writeAtomic(reviewPath, updated);
        const { annotations } = parseReview(updated);
        const annotation = annotations.find(candidate => candidate.id === request.annotationId);
        if (!annotation) {
            throw new Error('更新後の注釈を読み取れません。');
        }
        return { annotation };
    }

    async trimCut(request: TrimCutRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = trimCutInSource(source, request.cutIndex, request.in, request.out);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップをトリム') };
    }

    async reorderCuts(request: ReorderCutsRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = reorderCutsInSource(source, request.fromIndex, request.toIndex);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップの順序を入れ替え') };
    }

    async shiftCaption(request: ShiftCaptionRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = shiftCaptionLine(source, request.captionId, request.deltaStart, request.deltaEnd);
        await this.writeAtomic(captionsPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕のタイミングを調整') };
    }

    async insertCaption(request: InsertCaptionRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = insertCaptionLine(source, request.caption);
        await this.writeAtomic(captionsPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕を複製') };
    }

    async removeCaption(request: RemoveCaptionRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = removeCaptionLine(source, request.captionId);
        await this.writeAtomic(captionsPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕の複製を取り消し') };
    }

    async moveOverlay(request: MoveOverlayRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = moveOverlayInSource(source, request.overlayId, request.start, request.track, request.trackState);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'オーバーレイを移動') };
    }

    async resizeOverlay(request: ResizeOverlayRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = resizeOverlayInSource(source, request.overlayId, request.duration);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'オーバーレイの尺を変更') };
    }

    async insertOverlay(request: InsertOverlayRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = insertOverlayInSource(source, request.overlay);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'オーバーレイを複製') };
    }

    async removeOverlay(request: RemoveOverlayRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = removeOverlayInSource(source, request.overlayId);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'オーバーレイの複製を取り消し') };
    }

    protected requireWriteRequest(uri: string | undefined, projectRootUri: string | undefined): void {
        if (!uri || !projectRootUri) {
            throw new Error('書き戻し先を特定できません。');
        }
    }

    protected async commitWrite(root: string, message: string): Promise<boolean> {
        try {
            return await this.commitIfOwnRoot(root, message);
        } catch (error) {
            console.warn('[akari-annotations] commit skipped:', error);
            return false;
        }
    }

    protected async recordGateEvent(root: string, reviewPath: string, annotationId: string): Promise<void> {
        const eventsDirectory = join(root, '.akari', 'events');
        await fs.mkdir(eventsDirectory, { recursive: true });
        const occurredAt = new Date().toISOString();
        const id = `${occurredAt.replace(/[:.]/g, '-')}-annotation-created-${Math.random().toString(36).slice(2, 8)}`;
        const event = {
            version: 1,
            id,
            type: 'annotation-created',
            occurredAt,
            path: relative(root, reviewPath).split(sep).join('/'),
            annotationId
        };
        await this.writeAtomic(join(eventsDirectory, `${id}.json`), `${JSON.stringify(event, null, 2)}\n`);
    }

    protected async commitIfOwnRoot(root: string, message: string): Promise<boolean> {
        if (!(await this.isOwnRoot(root))) {
            return false;
        }
        await this.runGit(root, ['add', '-A', '--', '.']);
        const { stdout } = await this.runGit(root, ['status', '--porcelain']);
        if (!stdout.trim()) {
            return false;
        }
        await this.runGit(root, [
            '-c', 'user.name=AKARI Video',
            '-c', 'user.email=local@akari.video',
            'commit', '-m', message
        ]);
        return true;
    }

    protected async isOwnRoot(root: string): Promise<boolean> {
        try {
            const { stdout: inside } = await this.runGit(root, ['rev-parse', '--is-inside-work-tree']);
            if (inside.trim() !== 'true') {
                return false;
            }
            const { stdout: toplevel } = await this.runGit(root, ['rev-parse', '--show-toplevel']);
            const [top, target] = await Promise.all([fs.realpath(toplevel.trim()), fs.realpath(root)]);
            return top === target;
        } catch {
            return false;
        }
    }

    protected async runGit(root: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
        return execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    }

    protected async writeAtomic(destination: string, content: string): Promise<void> {
        await fs.mkdir(dirname(destination), { recursive: true });
        const temporary = `${destination}.${process.pid}.tmp`;
        await fs.writeFile(temporary, content, 'utf8');
        await fs.rename(temporary, destination);
    }

    protected fsPath(uri: string): string {
        return new URI(uri).path.fsPath();
    }
}
