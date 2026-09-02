import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { writeAtomic, writeProjectFilesGuarded } from '@akari-video/edit-store/lib/write-gate';
import { readInternalSources } from '@akari-video/edit-store/lib/internal-model';
import {
    applyCutRanges as applyCutRangesToSource,
    detectEditVersion,
    type CutRange
} from '@akari-video/edit-store/lib/cut-ranges';
import { refreshItemAnchors, type EditableEditV2 } from '@akari-video/edit-store/lib/tree-ops';
import { toAnchorCaptions, withoutItemAnchors } from '@akari-video/edit-store/lib/item-anchor';
import { applyMigration, planMigration, revertMigration } from '@akari-video/edit-store/lib/migrate';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { basename, dirname, join, relative, sep } from 'path';
import { promisify } from 'util';
import {
    AkariAnnotationsClient,
    AkariAnnotationsService,
    ApplyCutRangesRequest,
    ApplyCutRangesResult,
    Annotation,
    CreateAnnotationRequest,
    CreateAnnotationResult,
    DeleteCutRequest,
    DeleteCutResult,
    EditMigrationPlanResult,
    EditMigrationProposal,
    EditMigrationRequest,
    GetAudioDurationRequest,
    GetAudioDurationResult,
    GetClipFilmstripChunkRequest,
    GetClipFilmstripChunkResult,
    GetClipThumbnailRequest,
    GetClipThumbnailResult,
    GetClipWaveformRequest,
    GetClipWaveformResult,
    InsertCaptionRequest,
    InsertCutRequest,
    InsertLayerRequest,
    InsertOverlayRequest,
    InsertSfxRequest,
    MoveCutRequest,
    MoveCutResult,
    MoveLayerRequest,
    MoveOverlayRequest,
    MoveSfxRequest,
    RemoveCaptionRequest,
    RemoveLayerRequest,
    RemoveLayerResult,
    RemoveOverlayRequest,
    RemoveSfxRequest,
    RemoveSfxResult,
    ReorderCutsRequest,
    ResizeOverlayRequest,
    ResolveAnnotationRequest,
    SaveCanvasRequest,
    SaveCanvasResult,
    ShiftCaptionRequest,
    SlipCutRequest,
    SetBgmFieldsRequest,
    SetCaptionFieldsRequest,
    SetCaptionTimingRequest,
    SetCaptionTextStyleRequest,
    SetCutAtValuesRequest,
    SetCutOpacityRequest,
    SetCutSpeedRequest,
    SetCutTransformRequest,
    SetCutTransitionOutRequest,
    SetLayerBlendRequest,
    SetLayerOpacityRequest,
    SetLayerTransformRequest,
    SetOverlayVarRequest,
    SetSfxFadeRequest,
    SetSfxGainRequest,
    SplitCutRequest,
    TrimCutRequest,
    TrimSfxRequest,
    WriteBackResult,
    WriteEditSnapshotRequest
} from '../common/akari-annotations-protocol';
import type { SetAudioDuckRequest, SetAudioKeyframesRequest } from '../common/akari-annotations-protocol';
import type { MeasureAudioForLevelRequest, MeasureAudioForLevelResult } from '../common/akari-annotations-protocol';
import * as mediaCache from './media-cache';
import { measureAudioForLevel } from './audio-level-resolver';
import { setSfxFadeInSource } from '../common/sfx-fade-store';
import { setAudioDuckInSource, setAudioKeyframesInSource } from '../common/audio-envelope-store';
import {
    appendAnnotationLine,
    emptyReviewSource,
    isDocOrImageTarget,
    nextAnnotationId,
    normalizeInsertPosition,
    normalizeRefs,
    normalizeRegion,
    normalizeStrokes,
    normalizeTargetKind,
    parseReview,
    updateStatusLine
} from '../common/annotation-store';
import {
    insertCaptionLine,
    removeCaptionLine,
    shiftCaptionLine,
    setCaptionTimingLine,
    updateCaptionFieldsInSource,
    updateCaptionTextStyleInSource
} from '../common/caption-store';
import {
    deleteLayerByIdInSource,
    deleteSfxInSource,
    deleteCutInSource,
    insertCutInSource,
    insertLayerInSource,
    insertOverlayInSource,
    insertSfxInSource,
    moveCutAndPruneTracksInSource,
    moveLayerInSource,
    moveOverlayInSource,
    moveSfxInSource,
    removeOverlayInSource,
    reorderCutsInSource,
    resizeOverlayInSource,
    setCutSpeedInSource,
    setSfxGainDbInSource,
    slipCutInSource,
    splitCutInSource,
    setCutAtValuesInSource,
    setCutTransitionOutInSource,
    updateCutOpacityInSource,
    updateCutTransformInSource,
    trimCutInSource,
    trimSfxInSource,
    updateBgmInSource,
    updateLayerBlendInSource,
    updateLayerOpacityInSource,
    updateLayerTransformInSource,
    updateOverlayVarInSource
} from '../common/edit-store';

const execFileAsync = promisify(execFile);

/** review/canvas/c-NNNN/strokes.json の 1 要素（review-session §4.1 と同型・canvas-rect・frame なし）。 */
interface CanvasStrokeRecord {
    id: string;
    tool: 'pen';
    space: 'canvas-rect';
    points: [number, number][];
}

@injectable()
export class AkariAnnotationsServiceImpl implements AkariAnnotationsService {
    protected client: AkariAnnotationsClient | undefined;

    setClient(client: AkariAnnotationsClient | undefined): void {
        this.client = client;
    }

    async planEditMigration(request: EditMigrationRequest): Promise<EditMigrationPlanResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const projectRoot = this.fsPath(request.projectRootUri);
        const text = await fs.readFile(editPath, 'utf8');
        return planMigration(projectRoot, editPath, text);
    }

    async applyEditMigration(proposal: EditMigrationProposal): Promise<void> {
        this.client?.onWillWrite(URI.fromFilePath(proposal.filePath).toString());
        await applyMigration(proposal);
        this.notifyDidWrite(proposal.filePath, proposal.nextText);
    }

    async revertEditMigration(proposal: EditMigrationProposal): Promise<void> {
        this.client?.onWillWrite(URI.fromFilePath(proposal.filePath).toString());
        await revertMigration(proposal);
        this.notifyDidWrite(proposal.filePath, proposal.previousText);
    }

    async getClipThumbnail(request: GetClipThumbnailRequest): Promise<GetClipThumbnailResult> {
        if (!request?.projectRootUri || !request?.videoUri) {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        return mediaCache.getClipThumbnail(
            this.fsPath(request.projectRootUri), this.fsPath(request.videoUri), request.atSeconds
        );
    }

    async getClipFilmstripChunk(request: GetClipFilmstripChunkRequest): Promise<GetClipFilmstripChunkResult> {
        if (!request?.projectRootUri || !request?.videoUri || !Number.isInteger(request.chunkIndex) || request.chunkIndex < 0) {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        return mediaCache.getClipFilmstripChunk(
            this.fsPath(request.projectRootUri), this.fsPath(request.videoUri), request.chunkIndex,
            request.frameWidth, request.fps
        );
    }

    async getClipWaveform(request: GetClipWaveformRequest): Promise<GetClipWaveformResult> {
        if (!request?.projectRootUri || !request?.videoUri) {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        if (request.bucketCount !== undefined) {
            return mediaCache.getClipWaveform(
                this.fsPath(request.projectRootUri), this.fsPath(request.videoUri),
                request.startSeconds, request.endSeconds, request.bucketCount
            );
        }
        return mediaCache.getClipWaveform(
            this.fsPath(request.projectRootUri), this.fsPath(request.videoUri),
            request.startSeconds, request.endSeconds
        );
    }

    async getAudioDuration(request: GetAudioDurationRequest): Promise<GetAudioDurationResult> {
        if (!request?.projectRootUri || !request?.audioUri) {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        return mediaCache.getAudioDuration(this.fsPath(request.projectRootUri), this.fsPath(request.audioUri));
    }

    async createAnnotation(request: CreateAnnotationRequest): Promise<CreateAnnotationResult> {
        if (!request?.reviewUri || !request?.projectRootUri || typeof request.text !== 'string') {
            throw new Error('注釈の内容を入力してください。');
        }
        // text は typed テキスト（任意）+ strokes を 1 annotation として着地させる画像注釈
        // （契約 2026-07-26 §4-2）に限り省略できる。strokes が無い既存の全経路（動画面 / doc:）は
        // 従来どおり非空の text を必須のまま強制する。
        const hasStrokes = Array.isArray(request.strokes) && request.strokes.length > 0;
        if (!request.text.trim() && !hasStrokes) {
            throw new Error('注釈の内容を入力してください。');
        }
        // sourceT: null は doc:<path>#<block-id> / image:<path> target に限り許容する
        // （契約 §2）。動画面の注釈（overlay: / cut: / null target）は従来どおり時刻必須のまま。
        if (request.sourceT === null) {
            if (!isDocOrImageTarget(request.target ?? null)) {
                throw new Error('動画面の注釈には時刻が必要です。');
            }
        } else if (!Number.isFinite(request.sourceT) || request.sourceT < 0) {
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
            transcript: null,
            session: null,
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
            const eventPath = await this.recordGateEvent(root, reviewPath, annotation.id);
            committed = await this.commitIfOwnRoot(root, 'レビューコメントを追加', [reviewPath, eventPath]);
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

    /**
     * キャンバス面（contract-2026-07-26-canvas-surface §1/§2）の記録原本を
     * `project/review/canvas/c-NNNN/{canvas.json,strokes.json}` へ書く。review.json への着地は
     * このメソッドの責務外（skills/compile-review-session が canvas ディレクトリを検出して行う —
     * §4 のコンパイル分離を review セッション（s-NNNN）と同じ構造で踏襲する）。
     */
    async saveCanvas(request: SaveCanvasRequest): Promise<SaveCanvasResult> {
        if (!request?.projectRootUri) {
            throw new Error('プロジェクトを特定できません。');
        }
        const aspect = request.aspect;
        if (!aspect || !Number.isFinite(aspect.w) || aspect.w <= 0 || !Number.isFinite(aspect.h) || aspect.h <= 0) {
            throw new Error('キャンバスの出力解像度が不正です。');
        }
        const aspectSource = request.aspectSource === 'edit.json' ? 'edit.json' : 'default';
        const memo = typeof request.memo === 'string' && request.memo.trim() ? request.memo.trim() : null;
        const strokes = (Array.isArray(request.strokes) ? request.strokes : [])
            .map((stroke, index) => this.buildCanvasStroke(stroke, index))
            .filter((stroke): stroke is CanvasStrokeRecord => stroke !== undefined);
        if (strokes.length === 0 && !memo) {
            throw new Error('ペンで描くかメモを入力してください。');
        }

        const root = this.fsPath(request.projectRootUri);
        const canvasRoot = join(root, 'review', 'canvas');
        await fs.mkdir(canvasRoot, { recursive: true });
        const { id, canvasDirectory } = await this.allocateCanvasDirectory(canvasRoot);

        let background: { ref: string; hash: string } | null = null;
        if (request.background?.uri) {
            const backgroundPath = this.fsPath(request.background.uri);
            const bytes = await fs.readFile(backgroundPath);
            const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
            const ref = relative(root, backgroundPath).split(sep).join('/');
            background = { ref, hash };
        }

        const canvasManifest = {
            version: 0,
            id,
            createdAt: new Date().toISOString(),
            aspect: { w: aspect.w, h: aspect.h },
            // 追記(契約 §2 baseline に対する加筆): 取れない場合 1920x1080 既定へ落ちた導出元を
            // 明示する（task.md 指示 1「取れない場合は…canvas.json に導出元を記録」）。
            aspectSource,
            background,
            audio: null,
            // 追記: 録音なし v0（§3）で唯一のテキスト添付経路。§4 のコンパイルが読む。
            memo,
            status: 'recorded' as const,
            // 追記: session.json の compiledAnnotations と同じ分担（review-session §1 相乗り）。
            compiledAnnotations: null
        };
        await this.writeAtomic(
            join(canvasDirectory, 'canvas.json'), `${JSON.stringify(canvasManifest, null, 2)}\n`
        );
        await this.writeAtomic(
            join(canvasDirectory, 'strokes.json'), `${JSON.stringify({ version: 1, strokes }, null, 2)}\n`
        );

        try {
            await this.commitIfOwnRoot(root, 'キャンバスを記録', [
                join(canvasDirectory, 'canvas.json'),
                join(canvasDirectory, 'strokes.json')
            ]);
        } catch (error) {
            console.warn('[akari-annotations] canvas commit skipped:', error);
        }

        return { id };
    }

    protected buildCanvasStroke(
        input: SaveCanvasRequest['strokes'][number], index: number
    ): CanvasStrokeRecord | undefined {
        if (!input || !Array.isArray(input.points)) {
            return undefined;
        }
        const points = input.points.filter(
            (point): point is [number, number] => Array.isArray(point) && point.length === 2
                && point.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
        );
        if (points.length < 2) {
            return undefined;
        }
        return {
            id: `st-${String(index + 1).padStart(4, '0')}`,
            tool: 'pen',
            space: 'canvas-rect',
            points: points.map(([x, y]) => [x, y])
        };
    }

    /** `c-` + ゼロ埋め連番。review-session の allocateSessionDirectory と同じ採番規律（再利用しない）。 */
    protected async allocateCanvasDirectory(canvasRoot: string): Promise<{ id: string; canvasDirectory: string }> {
        const entries = await fs.readdir(canvasRoot, { withFileTypes: true });
        let next = entries.reduce((maximum, entry) => {
            const match = entry.isDirectory() ? /^c-(\d{4,})$/.exec(entry.name) : null;
            return match ? Math.max(maximum, Number(match[1])) : maximum;
        }, 0) + 1;
        while (Number.isSafeInteger(next)) {
            const id = `c-${String(next).padStart(4, '0')}`;
            const canvasDirectory = join(canvasRoot, id);
            try {
                await fs.mkdir(canvasDirectory);
                return { id, canvasDirectory };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                    throw error;
                }
                next += 1;
            }
        }
        throw new Error('キャンバスの採番上限に達しました。');
    }

    async trimCut(request: TrimCutRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const maxOutSeconds = request.maxOutSeconds !== undefined
            ? request.maxOutSeconds
            : await this.probeMaxOutSeconds(source, editPath, this.fsPath(request.projectRootUri), request.cutIndex);
        const updated = trimCutInSource(
            source, request.cutIndex, request.in, request.out, maxOutSeconds
        );
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップをトリム') };
    }

    /**
     * ソーストリマーの slip（R6c-2）: out−in（尺）と t を固定したまま in/out を同量シフトする。
     * trimSfx と同型で atomic 保存し、保存後 debounce lint の対象にする。
     */
    async slipCut(request: SlipCutRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const maxOutSeconds = request.maxOutSeconds !== undefined
            ? request.maxOutSeconds
            : await this.probeMaxOutSeconds(source, editPath, this.fsPath(request.projectRootUri), request.cutIndex);
        const updated = slipCutInSource(source, request.cutIndex, request.in, request.out, maxOutSeconds);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップをスリップ') };
    }

    /**
     * クライアントが maxOutSeconds を渡さなかった場合の自衛クランプ。edit.json 自身の
     * source(s)（v1 は cuts[].src → sources[]、v0 は直下の source）から対象クリップの
     * 動画パスを解決し、ffprobe（media-cache 既存の流儀）で実尺を直接取得する
     * （analysis sidecar には依存しない）。解決できなければ undefined を返し、
     * 呼び出し側（trimCutInSource）は従来どおりクランプなしで進む。
     */
    protected async probeMaxOutSeconds(
        rawEditSource: string, editPath: string, projectRootPath: string, cutIndex: number
    ): Promise<number | undefined> {
        let value: unknown;
        try {
            value = JSON.parse(rawEditSource);
        } catch {
            return undefined;
        }
        if (!value || typeof value !== 'object') {
            return undefined;
        }
        const document = value as { cuts?: unknown };
        const cuts = Array.isArray(document.cuts) ? document.cuts : [];
        const cut = cuts[cutIndex] as { src?: unknown } | undefined;
        // 版の違いは読み込み層が吸収済み。src の指す素材、無ければ単一素材宣言を使う。
        const table = readInternalSources(value);
        const entry = table.find(source => source.id === cut?.src)
            ?? table.find(source => source.isDefault);
        let mediaPath: string | undefined;
        if (entry && typeof entry.declaredPath === 'string') {
            mediaPath = typeof entry.declaredProxy === 'string' ? entry.declaredProxy : entry.declaredPath;
        }
        if (!mediaPath) {
            return undefined;
        }
        const audioPath = this.resolveMediaFsPath(mediaPath, editPath);
        const result = await mediaCache.getAudioDuration(projectRootPath, audioPath);
        return result.status === 'ready' ? result.durationSeconds : undefined;
    }

    /** edit.json 内の相対/絶対/URI いずれの表記も fs パスへ解決する（ブラウザ側 resolveEditMediaUri と同じ判定）。 */
    protected resolveMediaFsPath(mediaPath: string, editPath: string): string {
        if (/^[a-z][a-z\d+.-]*:/iu.test(mediaPath) && !/^[a-z]:[\\/]/iu.test(mediaPath)) {
            return new URI(mediaPath).path.fsPath();
        }
        if (/^[a-z]:[\\/]/iu.test(mediaPath) || mediaPath.startsWith('\\\\') || mediaPath.startsWith('/')) {
            return mediaPath.replace(/\\/gu, '/');
        }
        return join(dirname(editPath), mediaPath);
    }

    async setCutSpeed(request: SetCutSpeedRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = setCutSpeedInSource(source, request.cutIndex, request.speed);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップの速度を変更') };
    }

    async setCutTransform(request: SetCutTransformRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateCutTransformInSource(source, request.cutIndex, {
            x: request.x,
            y: request.y,
            scale: request.scale,
            rotate: request.rotate
        });
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップの変形を変更') };
    }

    async setCutOpacity(request: SetCutOpacityRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateCutOpacityInSource(source, request.cutIndex, request.opacity);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップの不透明度を変更') };
    }

    async setCutTransitionOut(request: SetCutTransitionOutRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = setCutTransitionOutInSource(source, request.cutIndex, request.transitionOut);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップのトランジションを変更') };
    }

    async setLayerTransform(request: SetLayerTransformRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateLayerTransformInSource(source, request.layerId, {
            x: request.x,
            y: request.y,
            scale: request.scale,
            rotate: request.rotate
        });
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '素材の変形を変更') };
    }

    async setLayerOpacity(request: SetLayerOpacityRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateLayerOpacityInSource(source, request.layerId, request.opacity);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '素材の不透明度を変更') };
    }

    async setLayerBlend(request: SetLayerBlendRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateLayerBlendInSource(source, request.layerId, request.blend);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '素材の合成を変更') };
    }

    async setSfxGain(request: SetSfxGainRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = setSfxGainDbInSource(source, request.sfxIndex, request.gainDb);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '音声クリップの音量を変更') };
    }

    async setSfxFade(request: SetSfxFadeRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = setSfxFadeInSource(source, request.sfxIndex, {
            fadeIn: request.fadeIn,
            fadeOut: request.fadeOut
        });
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '音声クリップのフェードを変更') };
    }

    async setBgmFields(request: SetBgmFieldsRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateBgmInSource(source, {
            gainDb: request.gainDb,
            fadeIn: request.fadeIn,
            fadeOut: request.fadeOut,
            ducking: request.ducking
        });
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'BGM の設定を変更') };
    }

    async setOverlayVar(request: SetOverlayVarRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateOverlayVarInSource(source, request.overlayId, request.name, request.value);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'オーバーレイのパラメータを変更') };
    }

    async setCaptionFields(request: SetCaptionFieldsRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = updateCaptionFieldsInSource(source, request.captionId, {
            text: request.text,
            speaker: request.speaker,
            unrecognized: request.unrecognized
        });
        await this.writeProjectFileGuarded(captionsPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕の内容を変更') };
    }

    async setCaptionTextStyle(request: SetCaptionTextStyleRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = updateCaptionTextStyleInSource(source, request.captionId, request.textStyle ?? {});
        await this.writeProjectFileGuarded(captionsPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕のスタイルを変更') };
    }

    async reorderCuts(request: ReorderCutsRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = reorderCutsInSource(source, request.fromIndex, request.toIndex);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップの順序を入れ替え') };
    }

    async moveCut(request: MoveCutRequest): Promise<MoveCutResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const moved = moveCutAndPruneTracksInSource(
            source, request.cutIndex, request.at, request.track, request.trackState, request.pruneTrackIds
        );
        await this.writeProjectFileGuarded(editPath, moved.source);
        return {
            committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップを移動'),
            ...(moved.prunedTracks ? { prunedTracks: moved.prunedTracks } : {})
        };
    }

    async setCutAtValues(request: SetCutAtValuesRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = setCutAtValuesInSource(source, request.entries);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップ間の空白を詰める') };
    }

    async shiftCaption(request: ShiftCaptionRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = shiftCaptionLine(source, request.captionId, request.deltaStart, request.deltaEnd);
        await this.writeProjectFileGuarded(captionsPath, updated);
        await this.refreshAnchorsAfterCaptionWrite(captionsPath);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕のタイミングを調整') };
    }

    async setCaptionTiming(request: SetCaptionTimingRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = setCaptionTimingLine(
            source,
            request.captionId,
            request.start,
            request.end,
            request.timeDomain,
            request.edited
        );
        await this.writeProjectFileGuarded(captionsPath, updated);
        await this.refreshAnchorsAfterCaptionWrite(captionsPath);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕のタイミングを調整') };
    }

    async insertCaption(request: InsertCaptionRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = insertCaptionLine(source, request.caption);
        await this.writeProjectFileGuarded(captionsPath, updated);
        await this.refreshAnchorsAfterCaptionWrite(captionsPath);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕を複製') };
    }

    async removeCaption(request: RemoveCaptionRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = removeCaptionLine(source, request.captionId);
        await this.writeProjectFileGuarded(captionsPath, updated);
        await this.refreshAnchorsAfterCaptionWrite(captionsPath);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕の複製を取り消し') };
    }

    async moveOverlay(request: MoveOverlayRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = moveOverlayInSource(source, request.overlayId, request.start, request.track, request.trackState);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'オーバーレイを移動') };
    }

    async resizeOverlay(request: ResizeOverlayRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = resizeOverlayInSource(source, request.overlayId, request.duration);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'オーバーレイの尺を変更') };
    }

    async splitCut(request: SplitCutRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = splitCutInSource(source, request.cutIndex, request.atSeconds);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップを分割') };
    }

    async deleteCut(request: DeleteCutRequest): Promise<DeleteCutResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const { source: updated, removedText } = deleteCutInSource(source, request.cutIndex);
        await this.writeProjectFileGuarded(editPath, updated);
        const committed = await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップを削除');
        return { committed, removedText };
    }

    async insertCut(request: InsertCutRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = insertCutInSource(source, request.cutIndex, request.elementText);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップを挿入') };
    }

    async applyCutRanges(request: ApplyCutRangesRequest): Promise<ApplyCutRangesResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const beforeSource = await fs.readFile(editPath, 'utf8');
        let cutInput = beforeSource;
        const anchors = new Map<string, unknown>();
        if (detectEditVersion(beforeSource) === 2) {
            const edit = JSON.parse(beforeSource) as { tracks?: Array<{ items?: unknown[] }> };
            const collect = (items: unknown[]): void => {
                for (const value of items) {
                    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
                    const item = value as { id?: unknown; anchor?: unknown; items?: unknown[] };
                    if (typeof item.id === 'string' && Object.prototype.hasOwnProperty.call(item, 'anchor')) {
                        anchors.set(item.id, item.anchor);
                    }
                    if (Array.isArray(item.items)) collect(item.items);
                }
            };
            for (const track of edit.tracks ?? []) if (Array.isArray(track.items)) collect(track.items);
            if (anchors.size > 0) {
                // applyCutRanges が通る readEditV2 の exact-key 検査は anchor を未定義キーとして throw し、
                // 後段の refreshItemAnchors へ到達できない。正本の射影で一時退避してからカットを適用する。
                const anchorFree = withoutItemAnchors(edit);
                cutInput = `${JSON.stringify(anchorFree, null, 2)}\n`;
            }
        }
        // edit-store の読み取り専用 CutRange 型は kind を消費しないため、サービス境界だけで吸収する。
        const applied = applyCutRangesToSource(cutInput, request.ranges as unknown as CutRange[], {});
        if (anchors.size > 0) {
            const cutEdit = JSON.parse(applied.source) as { tracks?: Array<{ items?: unknown[] }> };
            const restore = (items: unknown[]): void => {
                for (const value of items) {
                    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
                    const item = value as { id?: unknown; anchor?: unknown; items?: unknown[] };
                    if (typeof item.id === 'string') {
                        if (anchors.has(item.id)) item.anchor = anchors.get(item.id);
                    }
                    if (Array.isArray(item.items)) restore(item.items);
                }
            };
            for (const track of cutEdit.tracks ?? []) if (Array.isArray(track.items)) restore(track.items);
            applied.source = `${JSON.stringify(cutEdit, null, 2)}\n`;
        }
        let updated = applied.source;
        if (detectEditVersion(updated) === 2) {
            try {
                const captionsRaw = JSON.parse(await fs.readFile(join(dirname(editPath), 'captions.json'), 'utf8')) as unknown;
                const refreshed = refreshItemAnchors(
                    JSON.parse(updated) as EditableEditV2,
                    toAnchorCaptions(captionsRaw)
                );
                for (const warning of refreshed.warnings) {
                    console.warn(`[akari-annotations] item anchor ${warning.id}: ${warning.reason}`);
                }
                updated = `${JSON.stringify(refreshed.edit, null, 2)}\n`;
            } catch (error) {
                const code = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined;
                if (code !== 'ENOENT') console.warn('[akari-annotations] captions.json のアンカー更新をスキップしました。', error);
            }
        }
        for (const warning of applied.warnings) console.warn(`[akari-annotations] ${warning}`);
        await this.writeProjectFileGuarded(editPath, updated);
        const projectRoot = this.fsPath(request.projectRootUri);
        const committedByStandardPath = await this.commitWrite(projectRoot, request.label);
        const committed = committedByStandardPath
            || await this.commitIfOwnRoot(projectRoot, request.label, [editPath]);
        return { committed, removedFrames: applied.removedFrames, beforeSource };
    }

    async insertOverlay(request: InsertOverlayRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = insertOverlayInSource(source, request.overlay);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'オーバーレイを複製') };
    }

    async removeOverlay(request: RemoveOverlayRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = removeOverlayInSource(source, request.overlayId);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'オーバーレイの複製を取り消し') };
    }

    async moveLayer(request: MoveLayerRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = moveLayerInSource(
            source, request.layerId, request.t, request.duration, request.track, request.trackState
        );
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '素材を移動') };
    }

    async removeLayer(request: RemoveLayerRequest): Promise<RemoveLayerResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const { source: updated, removedText, layerIndex } = deleteLayerByIdInSource(source, request.layerId);
        await this.writeProjectFileGuarded(editPath, updated);
        const committed = await this.commitWrite(this.fsPath(request.projectRootUri), '素材を削除');
        return { committed, removedText, layerIndex };
    }

    async insertLayer(request: InsertLayerRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = insertLayerInSource(source, request.layerIndex, request.elementText);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '素材を挿入') };
    }

    async moveSfx(request: MoveSfxRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = moveSfxInSource(source, request.sfxIndex, request.t, request.track, request.trackState);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '音声クリップを移動') };
    }

    async trimSfx(request: TrimSfxRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = trimSfxInSource(source, request.sfxIndex, request.in, request.out, request.t);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '音声クリップをトリム') };
    }

    async removeSfx(request: RemoveSfxRequest): Promise<RemoveSfxResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const { source: updated, removedText } = deleteSfxInSource(source, request.sfxIndex);
        await this.writeProjectFileGuarded(editPath, updated);
        const committed = await this.commitWrite(this.fsPath(request.projectRootUri), '音声クリップを削除');
        return { committed, removedText, sfxIndex: request.sfxIndex };
    }

    async insertSfx(request: InsertSfxRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = insertSfxInSource(source, request.sfxIndex, request.elementText);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '音声クリップを挿入') };
    }

    /**
     * edit.json（と必要なら captions.json）全文スナップショットの atomic 書き戻し。
     * widget の FileService 直書き経路（タイムライントラック操作・undo/redo）の置き換え先
     * 両ファイル同時変更は連続 atomic 保存し、末尾 debounce 後に最新の組を 1 回 lint する。
     * 従来の FileService 直書きは git commit していなかったため、
     * この RPC も commit しない（committed は常に false）。
     */
    async writeEditSnapshot(request: WriteEditSnapshotRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        if (typeof request.editSource !== 'string' && typeof request.captionsSource !== 'string') {
            throw new Error('書き戻す内容がありません。');
        }
        const editPath = this.fsPath(request.editUri);
        const projectDir = dirname(editPath);
        const candidates: Record<string, string> = {};
        if (typeof request.editSource === 'string') {
            candidates[basename(editPath)] = request.editSource;
        }
        if (typeof request.captionsSource === 'string') {
            const captionsPath = request.captionsUri ? this.fsPath(request.captionsUri) : join(projectDir, 'captions.json');
            candidates[basename(captionsPath)] = request.captionsSource;
        }
        for (const name of Object.keys(candidates)) {
            this.client?.onWillWrite(URI.fromFilePath(join(projectDir, name)).toString());
        }
        await writeProjectFilesGuarded(projectDir, candidates, {
            onDidWrite: (filePath, text) => this.notifyDidWrite(filePath, text),
            onLintResult: result => this.client?.onLintResult({
                projectRootUri: URI.fromFilePath(projectDir).toString(),
                pass: result.pass,
                errors: result.errors,
                writtenFiles: Object.keys(candidates),
                findings: result.findings
            })
        });
        return { committed: false };
    }

    protected requireWriteRequest(uri: string | undefined, projectRootUri: string | undefined): void {
        if (!uri || !projectRootUri) {
            throw new Error('書き戻し先を特定できません。');
        }
    }

    /**
     * edit.json / captions.json への唯一の正規書き込み経路。atomic 保存を先に完了し、
     * packages/edit-store の末尾 debounce でプロセス内 lint を走らせる。lint の失敗は
     * client 通知からフッター警告 + undo 導線として扱い、保存自体は fail-open で維持する。
     */
    protected async writeProjectFileGuarded(filePath: string, content: string): Promise<void> {
        const projectDir = dirname(filePath);
        this.client?.onWillWrite(URI.fromFilePath(filePath).toString());
        await writeProjectFilesGuarded(projectDir, { [basename(filePath)]: content }, {
            onDidWrite: (written, text) => this.notifyDidWrite(written, text),
            onLintResult: result => this.client?.onLintResult({
                projectRootUri: URI.fromFilePath(projectDir).toString(),
                pass: result.pass,
                errors: result.errors,
                writtenFiles: [basename(filePath)],
                findings: result.findings
            })
        });
    }

    private async refreshAnchorsAfterCaptionWrite(captionsPath: string): Promise<void> {
        const editPath = join(dirname(captionsPath), 'edit.json');
        try {
            const editSource = await fs.readFile(editPath, 'utf8');
            if (detectEditVersion(editSource) !== 2) return;
            const captionsRaw = JSON.parse(await fs.readFile(captionsPath, 'utf8')) as unknown;
            const refreshed = refreshItemAnchors(
                JSON.parse(editSource) as EditableEditV2,
                toAnchorCaptions(captionsRaw)
            );
            for (const warning of refreshed.warnings) {
                console.warn(`[akari-annotations] item anchor ${warning.id}: ${warning.reason}`);
            }
            if (refreshed.changes.length > 0) {
                await this.writeProjectFileGuarded(editPath, `${JSON.stringify(refreshed.edit, null, 2)}\n`);
            }
        } catch (error) {
            const code = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined;
            if (code !== 'ENOENT') {
                console.warn('[akari-annotations] 字幕保存後のアンカー更新をスキップしました。', error);
            }
        }
    }

    /**
     * atomic rename 完了の直後にフロントエンドへ全文つきで知らせる（onWillWrite の対）。
     * プレビュー拡張はこれを受けて file watcher を待たずに差分判定へ入る。
     * ここで投げても保存は完了済みなので、握りつぶして保存を維持する。
     */
    protected notifyDidWrite(filePath: string, content: string): void {
        try {
            this.client?.onDidWrite(URI.fromFilePath(filePath).toString(), content);
        } catch (error) {
            console.warn('[akari-annotations] onDidWrite の通知に失敗しました（保存は完了しています）。', error);
        }
    }

    /**
     * 編集 RPC は保存の臨界経路で commit しないため常に false を返す。
     * この所有範囲で残す節目 commit は createAnnotation の承認ゲート記録と saveCanvas の記録。
     * 書き出し経路の commit は本タスクのファイル境界外にあり、本タスクでは未実装。
     */
    protected commitWrite(_root: string, _message: string): boolean {
        return false;
    }

    protected async recordGateEvent(root: string, reviewPath: string, annotationId: string): Promise<string> {
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
        const eventPath = join(eventsDirectory, `${id}.json`);
        await this.writeAtomic(eventPath, `${JSON.stringify(event, null, 2)}\n`);
        return eventPath;
    }

    protected async commitIfOwnRoot(root: string, message: string, contractPaths: string[]): Promise<boolean> {
        if (!(await this.isOwnRoot(root))) {
            return false;
        }
        const relativePaths = contractPaths.map(filePath => relative(root, filePath).split(sep).join('/'));
        await this.runGit(root, ['add', '--', ...relativePaths]);
        const { stdout } = await this.runGit(root, ['status', '--porcelain', '--', ...relativePaths]);
        if (!stdout.trim()) {
            return false;
        }
        await this.runGit(root, [
            '-c', 'user.name=AKARI Video',
            '-c', 'user.email=local@akari.video',
            'commit', '-m', message, '--', ...relativePaths
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

    /** lint 対象外ファイル（review.json / canvas / events）用。edit.json / captions.json は writeProjectFileGuarded を使うこと。 */
    protected async writeAtomic(destination: string, content: string): Promise<void> {
        await writeAtomic(destination, content);
    }

    protected fsPath(uri: string): string {
        return new URI(uri).path.fsPath();
    }

    async setAudioDuck(request: SetAudioDuckRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = setAudioDuckInSource(source, request.target, request.updates);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '音声のダッキングを変更') };
    }

    async setAudioKeyframes(request: SetAudioKeyframesRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = setAudioKeyframesInSource(source, request.target, request.keyframes);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '音量キーフレームを変更') };
    }

    async measureAudioForLevel(request: MeasureAudioForLevelRequest): Promise<MeasureAudioForLevelResult> {
        return measureAudioForLevel(request);
    }
}
