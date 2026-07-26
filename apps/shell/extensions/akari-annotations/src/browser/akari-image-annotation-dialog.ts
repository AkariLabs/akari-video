import URI from '@theia/core/lib/common/uri';
import { AbstractDialog, DialogError, DialogMode, DialogProps } from '@theia/core/lib/browser/dialogs';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import {
    createGlowSprite,
    createPlatinumGradient,
    drawPenSegment,
    PEN_TUNING
} from 'akari-preview/lib/common/pen-canvas-visuals';
import { AnnotationStroke, AnnotationStrokeImageRect } from '../common/annotation-store';
import { ReviewModel } from './review-model';

const IMAGE_MIME_TYPES = new Map<string, string>([
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.bmp', 'image/bmp']
]);

/** review-session 契約 §4.2「〜100 点程度に間引き可」に従う簡易間引き上限。 */
const MAX_STROKE_POINTS = 100;
/** ダイアログ内で画像を表示する上限（原寸比は保つ・原寸を超えて拡大はしない）。 */
const MAX_DISPLAY_WIDTH_RATIO = 0.72;
const MAX_DISPLAY_HEIGHT_RATIO = 0.62;

export interface AkariImageAnnotationDialogProps extends DialogProps {
    /** 画像ファイルの絶対 URI（FileService で読む）。 */
    imageUri: URI;
    /** review.json へ書く `image:<path>` のプロジェクト相対パス。 */
    relativePath: string;
    /** 'create' = クリックからの新規作成（ペン + typed テキスト）。'view' = 既存注釈の静止再表示。 */
    mode: 'create' | 'view';
    /** view モード時のみ使う。image-rect の strokes を静止描画する（契約 §4-2: 揮発させない）。 */
    existingStrokes?: readonly AnnotationStroke[];
}

/**
 * レポート内画像のポップアップ + ペン（contract-2026-07-26-doc-image-annotations §1/§3/§4-2）。
 * サンドボックス化された webview ではなく通常の Theia ダイアログ（BaseWidget 系）として実装する
 * ため、S3 の視覚チューニング（akari-preview/src/common/pen-canvas-visuals.ts）を実際に
 * TypeScript として import できる（report.md §統合点調査「採った方式」参照）。
 *
 * 揮発表示（review セッション契約 §4.3）は再生が進む動画面の規約であり、静的な画像面には
 * 適用しない（契約 §4-2）— そのため本ダイアログのストロークはフェードさせず確定まで保持する。
 */
export class AkariImageAnnotationDialog extends AbstractDialog<boolean> {

    protected readonly stage = document.createElement('div');
    protected readonly image = document.createElement('img');
    protected readonly canvas = document.createElement('canvas');
    protected readonly hint = document.createElement('div');
    protected readonly textInput = document.createElement('input');
    protected readonly errorNotice = document.createElement('div');

    protected readonly ctx: CanvasRenderingContext2D;
    protected readonly glowSprite: HTMLCanvasElement;
    protected platinumGradient: CanvasGradient | null = null;

    /** 確定済みストローク（作成モードのみ・持ち回りは正規化 0..1 点列）。 */
    protected readonly completedStrokes: Array<[number, number][]> = [];
    protected activePoints: Array<[number, number]> | undefined;
    protected activePointerId: number | undefined;
    protected canvasWidth = 0;
    protected canvasHeight = 0;
    protected canvasDpr = 1;
    protected imageLoadFailed = false;
    protected saved = false;

    constructor(
        protected readonly props: AkariImageAnnotationDialogProps,
        protected readonly fileService: FileService,
        protected readonly model: ReviewModel
    ) {
        super(props);
        this.ctx = this.canvas.getContext('2d')!;
        this.glowSprite = createGlowSprite(Math.max(64, PEN_TUNING.glowSizePx * 3));
        this.buildDom();
    }

    protected buildDom(): void {
        this.contentNode.classList.add('akari-image-annotation-dialog');
        Object.assign(this.stage.style, {
            position: 'relative', display: 'inline-block', lineHeight: '0',
            background: 'var(--theia-editor-background)', borderRadius: '4px', overflow: 'hidden'
        });
        this.image.alt = this.props.relativePath;
        Object.assign(this.image.style, { display: 'block', maxWidth: '100%' });
        Object.assign(this.canvas.style, {
            position: 'absolute', inset: '0',
            cursor: this.props.mode === 'create' ? 'crosshair' : 'default',
            touchAction: 'none'
        });
        this.stage.append(this.image, this.canvas);
        this.contentNode.appendChild(this.stage);

        if (this.props.mode === 'create') {
            this.hint.textContent = 'ペンで領域を描き、必要ならメモを入力してください（どちらか一方でも確定できます）。';
            Object.assign(this.hint.style, {
                fontSize: '11px', color: 'var(--theia-descriptionForeground)', margin: '8px 0 4px'
            });
            this.textInput.type = 'text';
            this.textInput.placeholder = 'この画像についてコメント（任意）';
            this.textInput.setAttribute('aria-label', 'この画像についてコメント');
            Object.assign(this.textInput.style, { width: '100%', boxSizing: 'border-box', margin: '2px 0 6px' });
            this.textInput.addEventListener('input', () => this.update());
            this.contentNode.append(this.hint, this.textInput);
        }

        Object.assign(this.errorNotice.style, {
            display: 'none', color: 'var(--theia-errorForeground)', fontSize: '12px', margin: '4px 0'
        });
        this.contentNode.appendChild(this.errorNotice);

        if (this.props.mode === 'create') {
            this.appendAcceptButton('注釈を追加');
        }
        this.appendCloseButton(this.props.mode === 'create' ? 'キャンセル' : '閉じる');

        void this.load();
    }

    protected async load(): Promise<void> {
        try {
            const stat = await this.fileService.resolve(this.props.imageUri, { resolveMetadata: true });
            if (typeof stat.size === 'number' && stat.size > 25 * 1024 * 1024) {
                this.showLoadError('この画像はサイズが大きすぎるためプレビューできません。');
                return;
            }
            const content = await this.fileService.readFile(this.props.imageUri);
            const ext = this.props.imageUri.path.ext.toLowerCase();
            const mimeType = IMAGE_MIME_TYPES.get(ext) ?? 'application/octet-stream';
            const dataUri = `data:${mimeType};base64,${this.toBase64(content.value.buffer)}`;
            await new Promise<void>((resolve, reject) => {
                this.image.addEventListener('load', () => resolve(), { once: true });
                this.image.addEventListener('error', () => reject(new Error('decode failed')), { once: true });
                this.image.src = dataUri;
            });
            this.applyNaturalSize();
            this.setupCanvas();
            if (this.props.mode === 'create') {
                this.wirePointerEvents();
            } else if (this.props.existingStrokes) {
                this.paintExistingStrokes();
            }
            this.update();
        } catch (error) {
            console.warn('[akari-annotations] image annotation dialog failed to load image', error);
            this.imageLoadFailed = true;
            this.showLoadError('画像を読み込めませんでした。');
        }
    }

    protected showLoadError(message: string): void {
        this.errorNotice.textContent = message;
        this.errorNotice.style.display = 'block';
    }

    /** 「原寸比」表示: 画面に収まる範囲で最大 = 原寸まで（原寸を超えて拡大はしない）。 */
    protected applyNaturalSize(): void {
        const naturalWidth = this.image.naturalWidth || 1;
        const naturalHeight = this.image.naturalHeight || 1;
        const maxWidth = Math.max(240, window.innerWidth * MAX_DISPLAY_WIDTH_RATIO);
        const maxHeight = Math.max(180, window.innerHeight * MAX_DISPLAY_HEIGHT_RATIO);
        const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
        const displayWidth = Math.max(1, Math.round(naturalWidth * scale));
        const displayHeight = Math.max(1, Math.round(naturalHeight * scale));
        this.image.style.width = `${displayWidth}px`;
        this.image.style.height = `${displayHeight}px`;
        this.stage.style.width = `${displayWidth}px`;
        this.stage.style.height = `${displayHeight}px`;
    }

    protected setupCanvas(): void {
        const rect = this.stage.getBoundingClientRect();
        this.canvasWidth = Math.max(1, Math.round(rect.width));
        this.canvasHeight = Math.max(1, Math.round(rect.height));
        this.canvasDpr = Math.min(PEN_TUNING.maxDevicePixelRatio, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(this.canvasWidth * this.canvasDpr);
        this.canvas.height = Math.round(this.canvasHeight * this.canvasDpr);
        // canvas は置換要素のため、position:absolute; inset:0 だけでは width/height 属性
        // （バッキングストア解像度）がそのまま CSS サイズとして使われてしまう
        // （HiDPI で image の 2 倍表示になる実機不具合を検出・修正）。CSS サイズは
        // 明示的に画像の表示サイズへ固定する。
        this.canvas.style.width = `${this.canvasWidth}px`;
        this.canvas.style.height = `${this.canvasHeight}px`;
        this.ctx.setTransform(this.canvasDpr, 0, 0, this.canvasDpr, 0, 0);
        this.platinumGradient = createPlatinumGradient(this.ctx, this.canvasWidth, this.canvasHeight);
    }

    protected wirePointerEvents(): void {
        this.canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0 || this.activePoints) {
                return;
            }
            event.preventDefault();
            this.canvas.setPointerCapture(event.pointerId);
            this.activePointerId = event.pointerId;
            this.activePoints = [this.normalizedPoint(event)];
        });
        this.canvas.addEventListener('pointermove', event => {
            if (!this.activePoints || event.pointerId !== this.activePointerId) {
                return;
            }
            event.preventDefault();
            const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
            const events = coalesced && coalesced.length > 0 ? coalesced : [event];
            for (const raw of events) {
                this.activePoints.push(this.normalizedPoint(raw));
            }
            this.redraw();
        });
        const finish = (event: PointerEvent): void => {
            if (!this.activePoints || event.pointerId !== this.activePointerId) {
                return;
            }
            if (this.canvas.hasPointerCapture(event.pointerId)) {
                this.canvas.releasePointerCapture(event.pointerId);
            }
            const points = this.activePoints;
            this.activePoints = undefined;
            this.activePointerId = undefined;
            if (points.length >= 2) {
                this.completedStrokes.push(points);
            }
            this.redraw();
            this.update();
        };
        this.canvas.addEventListener('pointerup', finish);
        this.canvas.addEventListener('pointercancel', finish);
    }

    protected normalizedPoint(event: PointerEvent): [number, number] {
        const rect = this.stage.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
        return [x, y];
    }

    /** 確定まで保持（フェードなし。契約 §4-2）。全ストローク + 描画中ストロークを毎回再描画する。 */
    protected redraw(): void {
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        for (const points of this.completedStrokes) {
            this.paintPolyline(points);
        }
        if (this.activePoints) {
            this.paintPolyline(this.activePoints);
        }
    }

    protected paintExistingStrokes(): void {
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        for (const stroke of this.props.existingStrokes ?? []) {
            this.paintPolyline(stroke.points);
        }
    }

    protected paintPolyline(points: ReadonlyArray<readonly [number, number]>): void {
        for (let index = 0; index < points.length - 1; index += 1) {
            drawPenSegment(
                this.ctx, this.glowSprite, this.platinumGradient,
                points[index], points[index + 1],
                this.canvasWidth, this.canvasHeight,
                PEN_TUNING.staticCoreWidthPx
            );
        }
    }

    protected override async isValid(value: boolean, mode: DialogMode): Promise<DialogError> {
        if (this.props.mode === 'view') {
            return true;
        }
        if (this.imageLoadFailed) {
            return { message: '画像を読み込めなかったため注釈を追加できません。', result: false };
        }
        const hasText = this.textInput.value.trim().length > 0;
        const hasStrokes = this.completedStrokes.length > 0;
        if (!hasText && !hasStrokes) {
            return { message: 'テキストまたはペンでの描画のいずれかが必要です。', result: false };
        }
        if (mode === 'preview' || this.saved) {
            return true;
        }
        try {
            const strokes: AnnotationStrokeImageRect[] = this.completedStrokes.map(points => ({
                tool: 'pen', space: 'image-rect', points: this.decimate(points)
            }));
            await this.model.addImageAnnotation(this.textInput.value.trim(), this.props.relativePath, strokes);
            this.saved = true;
            return true;
        } catch (error) {
            return { message: `注釈を追加できません: ${this.errorMessage(error)}`, result: false };
        }
    }

    protected decimate(points: Array<[number, number]>): Array<[number, number]> {
        if (points.length <= MAX_STROKE_POINTS) {
            return points;
        }
        const result: Array<[number, number]> = [];
        const lastIndex = points.length - 1;
        for (let index = 0; index < MAX_STROKE_POINTS; index += 1) {
            result.push(points[Math.round((index * lastIndex) / (MAX_STROKE_POINTS - 1))]);
        }
        return result;
    }

    get value(): boolean {
        return true;
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    protected toBase64(bytes: Uint8Array): string {
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
        }
        return btoa(binary);
    }
}
