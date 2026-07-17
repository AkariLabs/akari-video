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
    ResolveAnnotationRequest
} from '../common/akari-annotations-protocol';
import {
    appendAnnotationLine,
    emptyReviewSource,
    nextAnnotationId,
    parseReview,
    updateStatusLine
} from '../common/annotation-store';

const execFileAsync = promisify(execFile);

@injectable()
export class AkariAnnotationsServiceImpl implements AkariAnnotationsService {

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
        const annotation: Annotation = {
            id: nextAnnotationId(annotations),
            createdAt: new Date().toISOString(),
            sourceT: request.sourceT,
            sourceRange: null,
            timelineT: Number.isFinite(request.timelineT as number) ? (request.timelineT as number) : null,
            target: request.target ?? null,
            text: request.text,
            input: 'typed',
            audio: null,
            strokes: null,
            poses: null,
            status: 'open',
            response: null
        };
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
