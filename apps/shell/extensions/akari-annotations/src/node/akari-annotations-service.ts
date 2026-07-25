import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { execFile } from 'child_process';
import { promises as fs, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve, sep } from 'path';
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
    ShiftCaptionRequest,
    SetBgmFieldsRequest,
    SetCaptionFieldsRequest,
    SetCaptionTextStyleRequest,
    SetCutAtValuesRequest,
    SetCutOpacityRequest,
    SetCutSpeedRequest,
    SetCutTransformRequest,
    SetLayerBlendRequest,
    SetLayerOpacityRequest,
    SetLayerTransformRequest,
    SetOverlayVarRequest,
    SetSfxGainRequest,
    SplitCutRequest,
    TrimCutRequest,
    TrimSfxRequest,
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
    splitCutInSource,
    setCutAtValuesInSource,
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
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップをトリム') };
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
        await this.writeAtomic(editPath, updated);
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
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップの変形を変更') };
    }

    async setCutOpacity(request: SetCutOpacityRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateCutOpacityInSource(source, request.cutIndex, request.opacity);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップの不透明度を変更') };
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
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '素材の変形を変更') };
    }

    async setLayerOpacity(request: SetLayerOpacityRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateLayerOpacityInSource(source, request.layerId, request.opacity);
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '素材の不透明度を変更') };
    }

    async setLayerBlend(request: SetLayerBlendRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateLayerBlendInSource(source, request.layerId, request.blend);
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '素材の合成を変更') };
    }

    async setSfxGain(request: SetSfxGainRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = setSfxGainDbInSource(source, request.sfxIndex, request.gainDb);
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'SE の音量を変更') };
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
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'BGM の設定を変更') };
    }

    async setOverlayVar(request: SetOverlayVarRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = updateOverlayVarInSource(source, request.overlayId, request.name, request.value);
        await this.writeAtomic(editPath, updated);
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
        await this.writeAtomic(captionsPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕の内容を変更') };
    }

    async setCaptionTextStyle(request: SetCaptionTextStyleRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.captionsUri, request?.projectRootUri);
        const captionsPath = this.fsPath(request.captionsUri);
        const source = await fs.readFile(captionsPath, 'utf8');
        const updated = updateCaptionTextStyleInSource(source, request.captionId, request.textStyle ?? {});
        await this.writeAtomic(captionsPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '字幕のスタイルを変更') };
    }

    async reorderCuts(request: ReorderCutsRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = reorderCutsInSource(source, request.fromIndex, request.toIndex);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップの順序を入れ替え') };
    }

    async moveCut(request: MoveCutRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = moveCutInSource(source, request.cutIndex, request.at, request.track, request.trackState);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップを移動') };
    }

    async setCutAtValues(request: SetCutAtValuesRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = setCutAtValuesInSource(source, request.entries);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップ間の空白を詰める') };
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

    async splitCut(request: SplitCutRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = splitCutInSource(source, request.cutIndex, request.atSeconds);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップを分割') };
    }

    async deleteCut(request: DeleteCutRequest): Promise<DeleteCutResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const { source: updated, removedText } = deleteCutInSource(source, request.cutIndex);
        await this.writeAtomic(editPath, updated);
        const committed = await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップを削除');
        return { committed, removedText };
    }

    async insertCut(request: InsertCutRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = insertCutInSource(source, request.cutIndex, request.elementText);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'クリップを挿入') };
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

    async moveLayer(request: MoveLayerRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = moveLayerInSource(
            source, request.layerId, request.t, request.duration, request.track, request.trackState
        );
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '素材を移動') };
    }

    async removeLayer(request: RemoveLayerRequest): Promise<RemoveLayerResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const { source: updated, removedText, layerIndex } = deleteLayerByIdInSource(source, request.layerId);
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        const committed = await this.commitWrite(this.fsPath(request.projectRootUri), '素材を削除');
        return { committed, removedText, layerIndex };
    }

    async insertLayer(request: InsertLayerRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = insertLayerInSource(source, request.layerIndex, request.elementText);
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), '素材を挿入') };
    }

    async moveSfx(request: MoveSfxRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = moveSfxInSource(source, request.sfxIndex, request.t, request.track, request.trackState);
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'SE を移動') };
    }

    async trimSfx(request: TrimSfxRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = trimSfxInSource(source, request.sfxIndex, request.in, request.out, request.t);
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'SE をトリム') };
    }

    async removeSfx(request: RemoveSfxRequest): Promise<RemoveSfxResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const { source: updated, removedText } = deleteSfxInSource(source, request.sfxIndex);
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        const committed = await this.commitWrite(this.fsPath(request.projectRootUri), 'SE を削除');
        return { committed, removedText, sfxIndex: request.sfxIndex };
    }

    async insertSfx(request: InsertSfxRequest): Promise<WriteBackResult> {
        this.requireWriteRequest(request?.editUri, request?.projectRootUri);
        const editPath = this.fsPath(request.editUri);
        const source = await fs.readFile(editPath, 'utf8');
        const updated = insertSfxInSource(source, request.sfxIndex, request.elementText);
        await this.assertLintPasses(editPath, updated);
        await this.writeAtomic(editPath, updated);
        return { committed: await this.commitWrite(this.fsPath(request.projectRootUri), 'SE を挿入') };
    }

    protected requireWriteRequest(uri: string | undefined, projectRootUri: string | undefined): void {
        if (!uri || !projectRootUri) {
            throw new Error('書き戻し先を特定できません。');
        }
    }

    // CF-write: layerWrite/audioWrite の書き込み前ゲート。候補全文を実ファイルへは一切書かず、
    // 兄弟ファイル（source 動画・captions.json 等）をシンボリックリンクで写した一時ディレクトリに
    // 候補 edit.json だけを置いて packages/edit-lint/bin/edit-lint.mjs --json を叩く
    // （packages/edit-lint は「呼び出しのみ」— 改変しない）。不正なら書き込まずに例外を投げる
    // （呼び出し側の catch → { ok: false, message } で UI が巻き戻る）。
    protected async assertLintPasses(editPath: string, candidateText: string): Promise<void> {
        const projectRoot = dirname(editPath);
        const tempRoot = await fs.mkdtemp(resolve(tmpdir(), 'akari-lint-'));
        try {
            let siblingNames: string[] = [];
            try {
                siblingNames = await fs.readdir(projectRoot);
            } catch {
                siblingNames = [];
            }
            await Promise.all(siblingNames.map(async name => {
                if (name === 'edit.json') {
                    return;
                }
                try {
                    const targetStat = await fs.stat(join(projectRoot, name));
                    await fs.symlink(
                        join(projectRoot, name), join(tempRoot, name), targetStat.isDirectory() ? 'dir' : 'file'
                    );
                } catch {
                    // Reference is unreadable or a broken symlink; edit-lint will report it as a
                    // missing-file finding on its own, same as it would against the real project.
                }
            }));
            await fs.writeFile(join(tempRoot, 'edit.json'), candidateText, 'utf8');
            const result = await this.runEditLint(tempRoot);
            if (!result.pass) {
                throw new Error(result.errors[0] ?? 'edit-lint が変更を拒否しました');
            }
        } finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    }

    protected async runEditLint(projectRoot: string): Promise<{ pass: boolean; errors: string[] }> {
        const binPath = this.findEditLintBinPath();
        const stdout = await execFileAsync(process.execPath, [binPath, projectRoot, '--json'], {
            encoding: 'utf8', maxBuffer: 10 * 1024 * 1024
        }).then(
            result => result.stdout,
            (error: NodeJS.ErrnoException & { stdout?: string }) => typeof error.stdout === 'string' ? error.stdout : '{}'
        );
        let parsed: { findings?: Array<{ severity?: string; message?: string; check?: string }> };
        try {
            parsed = JSON.parse(stdout);
        } catch (error) {
            return {
                pass: false,
                errors: [`edit-lint の出力を解析できませんでした: ${error instanceof Error ? error.message : String(error)}`]
            };
        }
        const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        const errorFindings = findings.filter(finding => finding.severity === 'error');
        return {
            pass: errorFindings.length === 0,
            errors: errorFindings.map(finding => `[${finding.check ?? 'edit-lint'}] ${finding.message ?? '不明なエラー'}`)
        };
    }

    protected findEditLintBinPath(): string {
        const candidates: string[] = [];

        const packagedCandidate = resolve(__dirname, '../edit-lint/bin/edit-lint.mjs');
        candidates.push(packagedCandidate);
        if (this.isFile(packagedCandidate)) {
            return packagedCandidate;
        }

        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            const candidate = resolve(ancestor, 'packages/edit-lint/bin/edit-lint.mjs');
            candidates.push(candidate);
            if (this.isFile(candidate)) {
                return candidate;
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) {
                break;
            }
            ancestor = parent;
        }

        const cwdCandidates = [
            resolve(process.cwd(), '../../packages/edit-lint/bin/edit-lint.mjs'),
            resolve(process.cwd(), 'packages/edit-lint/bin/edit-lint.mjs'),
            resolve(process.cwd(), '../packages/edit-lint/bin/edit-lint.mjs')
        ];
        for (const candidate of cwdCandidates) {
            if (candidates.includes(candidate)) {
                continue;
            }
            candidates.push(candidate);
            if (this.isFile(candidate)) {
                return candidate;
            }
        }
        throw new Error(`edit-lint bin was not found (tried: ${candidates.join(', ')})`);
    }

    protected isFile(candidate: string): boolean {
        try {
            return statSync(candidate).isFile();
        } catch {
            return false;
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
