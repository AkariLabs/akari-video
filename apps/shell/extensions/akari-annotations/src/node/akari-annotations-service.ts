import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { writeAtomic, writeProjectFilesGuarded } from '@akari-video/edit-store/lib/write-gate';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { basename, dirname, join, relative, sep } from 'path';
import { promisify } from 'util';
import {
    AkariAnnotationsService,
    Annotation,
    CreateAnnotationRequest,
    CreateAnnotationResult,
    DeleteCutRequest,
    DeleteCutResult,
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
import * as mediaCache from './media-cache';
import { setSfxFadeInSource } from '../common/sfx-fade-store';
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
    moveCutInSource,
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
            await this.commitIfOwnRoot(root, 'キャンバスを記録');
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
     * trimSfx と同型で lint ゲートを通す（cuts の他の書き込み経路〔trimCut 等〕はゲート無しだが、
     * slip は新設 RPC のため sfx 系の慎重な作法に倣う）。
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
        const document = value as { cuts?: unknown; sources?: unknown; source?: unknown };
        const cuts = Array.isArray(document.cuts) ? document.cuts : [];
        const cut = cuts[cutIndex] as { src?: unknown } | undefined;
        let mediaPath: string | undefined;
        if (cut && typeof cut.src === 'string' && Array.isArray(document.sources)) {
            const match = (document.sources as unknown[]).find(
                entry => entry !== null && typeof entry === 'object' && (entry as { id?: unknown }).id === cut.src
            ) as { path?: unknown; proxy?: unknown } | undefined;
            if (match && typeof match.path === 'string') {
                mediaPath = typeof match.proxy === 'string' ? match.proxy : match.path;
            }
        } else if (document.source && typeof document.source === 'object') {
            const defaultSource = document.source as { path?: unknown; proxy?: unknown };
            if (typeof defaultSource.path === 'string') {
                mediaPath = typeof defaultSource.proxy === 'string' ? defaultSource.proxy : defaultSource.path;
            }
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
            speaker: request.speaker
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

    async moveCut(request: MoveCutRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = moveCutInSource(source, request.cutIndex, request.at, request.track, request.trackState);
        await this.writeProjectFileGuarded(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップを移動') };
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
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕のタイミングを調整') };
    }

    async insertCaption(request: InsertCaptionRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = insertCaptionLine(source, request.caption);
        await this.writeProjectFileGuarded(captionsPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕を複製') };
    }

    async removeCaption(request: RemoveCaptionRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = removeCaptionLine(source, request.captionId);
        await this.writeProjectFileGuarded(captionsPath, updated);
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
     * edit.json（と必要なら captions.json）全文スナップショットの lint ゲート付き書き戻し。
     * widget の FileService 直書き経路（タイムライントラック操作・undo/redo）の置き換え先
     * （パリティ契約 §2.7）。両ファイル同時変更は同じ一時ディレクトリで 1 回の lint にかけ、
     * 整合した組として検証する。従来の FileService 直書きは git commit していなかったため、
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
        await writeProjectFilesGuarded(projectDir, candidates);
        return { committed: false };
    }

    protected requireWriteRequest(uri: string | undefined, projectRootUri: string | undefined): void {
        if (!uri || !projectRootUri) {
            throw new Error('書き戻し先を特定できません。');
        }
    }

    /**
     * edit.json / captions.json への唯一の正規書き込み経路。lint ゲート（一時ディレクトリで
     * edit-lint --json・fail-open）→ atomic 書き込みを packages/edit-store の共有カーネルで行う
     * （パリティ契約 §2.7「すべての書き込み経路は edit-lint を通す」— Phase 2 で全 RPC に適用）。
     * 不正なら書き込まずに例外を投げる（呼び出し側の catch → UI が巻き戻る）。
     */
    protected async writeProjectFileGuarded(filePath: string, content: string): Promise<void> {
        await writeProjectFilesGuarded(dirname(filePath), { [basename(filePath)]: content });
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

    /** lint 対象外ファイル（review.json / canvas / events）用。edit.json / captions.json は writeProjectFileGuarded を使うこと。 */
    protected async writeAtomic(destination: string, content: string): Promise<void> {
        await writeAtomic(destination, content);
    }

    protected fsPath(uri: string): string {
        return new URI(uri).path.fsPath();
    }
}
