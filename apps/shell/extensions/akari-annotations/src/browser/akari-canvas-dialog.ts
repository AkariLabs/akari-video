import URI from '@theia/core/lib/common/uri';
import { AbstractDialog, DialogError, DialogMode, DialogProps } from '@theia/core/lib/browser/dialogs';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { Message } from '@theia/core/shared/@lumino/messaging';
import {
    createGlowSprite,
    createPlatinumGradient,
    drawPenSegment,
    PEN_TUNING
} from 'akari-preview/lib/common/pen-canvas-visuals';
import { decimateStrokePoints, IMAGE_MIME_TYPES } from './akari-image-annotation-dialog';
import { ReviewModel } from './review-model';
import { AKARI_WARNING_TEXT_COLOR } from './akari-notice-banner';

/** ダイアログ内でキャンバスを表示する上限（原寸比は保つ・原寸を超えて拡大はしない）。 */
const MAX_DISPLAY_WIDTH_RATIO = 0.72;
const MAX_DISPLAY_HEIGHT_RATIO = 0.62;
const MAX_BACKGROUND_BYTES = 25 * 1024 * 1024;
const BACKGROUND_FILTERS = { '画像': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] };

export interface AkariCanvasDialogProps extends DialogProps {
    /** 'create' = 「キャンバスを開く」からの新規記録。'view' = 既存キャンバスの静止再表示。 */
    mode: 'create' | 'view';
    /** 動画の実出力解像度から導出したアスペクト（task.md 指示 1）。 */
    aspect: { w: number; h: number };
    /** create モードのみ: canvas.json.aspectSource に書く導出元。 */
    aspectSource?: 'edit.json' | 'default';
    /** view モードのみ: 背景画像の絶対 file URI（白紙 or 実ファイル不在なら未設定）。 */
    backgroundUri?: URI;
    /** view モードのみ: background.ref はあるが実ファイルが見当たらない場合の警告文言（契約 §6）。 */
    backgroundWarning?: string;
    /** view モードのみ: 既存ストローク（正規化 canvas-rect 点列・フル精度。strokes.json 原本）。 */
    existingStrokes?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
}

/**
 * キャンバス面（contract-2026-07-26-canvas-surface）— 出力アスペクトの白板 + ペン + 任意メモ。
 * 画像ポップアップ（akari-image-annotation-dialog.ts）と同じ通常 Theia ダイアログ方式を踏襲し、
 * S3 のペン基盤（pen-canvas-visuals）をそのまま import する。動画面と異なり描画は揮発させない
 * （契約 §5）。背景は白紙 or 静止画像アセットのみ（動画フレーム抽出は非ゴール・契約 §8）。
 */
export class AkariCanvasDialog extends AbstractDialog<string | undefined> {

    protected readonly stage = document.createElement('div');
    protected readonly image = document.createElement('img');
    protected readonly canvas = document.createElement('canvas');
    protected readonly hint = document.createElement('div');
    protected readonly backgroundRow = document.createElement('div');
    protected readonly backgroundLabel = document.createElement('span');
    protected readonly blankButton = document.createElement('button');
    protected readonly pickButton = document.createElement('button');
    protected readonly memoInput = document.createElement('input');
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
    protected backgroundUri: URI | undefined;
    protected backgroundLoaded = false;
    protected saved = false;
    protected savedId: string | undefined;

    constructor(
        protected readonly props: AkariCanvasDialogProps,
        protected readonly fileService: FileService,
        protected readonly model: ReviewModel,
        protected readonly fileDialogService: FileDialogService
    ) {
        super(props);
        this.ctx = this.canvas.getContext('2d')!;
        this.glowSprite = createGlowSprite(Math.max(64, PEN_TUNING.glowSizePx * 3));
        this.backgroundUri = props.mode === 'view' ? props.backgroundUri : undefined;
        this.buildDom();
    }

    protected buildDom(): void {
        this.contentNode.classList.add('akari-canvas-dialog');
        Object.assign(this.stage.style, {
            position: 'relative', display: 'block', background: '#ffffff',
            borderRadius: '4px', overflow: 'hidden', margin: '0 auto',
            // contentNode（dialogContent）は display:flex; flex-direction:column のため、
            // flex-shrink の既定値（1）のままだと他の要素（hint/背景選択行/メモ欄）と競合して
            // アスペクト計算どおりの高さが縮められてしまう（L1 実機検証で発見・受け入れ条件 1
            // 「アスペクトが出力解像度と一致」に直結する不具合）。stage だけは縮めさせない。
            flexShrink: '0', flexGrow: '0'
        });
        Object.assign(this.image.style, {
            position: 'absolute', inset: '0', width: '100%', height: '100%',
            objectFit: 'cover', display: 'none'
        });
        Object.assign(this.canvas.style, {
            position: 'absolute', inset: '0',
            cursor: this.props.mode === 'create' ? 'crosshair' : 'default',
            touchAction: 'none'
        });
        this.stage.append(this.image, this.canvas);

        if (this.props.mode === 'create') {
            this.hint.textContent = 'ペンで描いて構図を伝えてください（背景は白紙のままでも画像を選んでもかまいません）。';
            Object.assign(this.hint.style, {
                fontSize: '11px', color: 'var(--theia-descriptionForeground)', margin: '0 0 6px'
            });
            this.contentNode.appendChild(this.hint);

            Object.assign(this.backgroundRow.style, {
                display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 8px'
            });
            this.blankButton.type = 'button';
            this.blankButton.className = 'theia-button secondary';
            this.blankButton.textContent = '白紙のまま';
            this.blankButton.addEventListener('click', () => this.clearBackground());
            this.pickButton.type = 'button';
            this.pickButton.className = 'theia-button secondary';
            this.pickButton.textContent = '画像を選ぶ...';
            this.pickButton.addEventListener('click', () => void this.pickBackgroundImage());
            this.backgroundLabel.textContent = '背景: 白紙';
            Object.assign(this.backgroundLabel.style, { fontSize: '11px', color: 'var(--theia-descriptionForeground)' });
            this.backgroundRow.append(this.blankButton, this.pickButton, this.backgroundLabel);
            this.contentNode.appendChild(this.backgroundRow);
        }

        this.contentNode.appendChild(this.stage);

        if (this.props.mode === 'create') {
            this.memoInput.type = 'text';
            this.memoInput.placeholder = 'メモ（任意・録音なしのときはこの内容がそのまま注釈になります）';
            this.memoInput.setAttribute('aria-label', 'キャンバスのメモ');
            Object.assign(this.memoInput.style, { width: '100%', boxSizing: 'border-box', margin: '8px 0 4px' });
            this.memoInput.addEventListener('input', () => this.update());
            this.contentNode.appendChild(this.memoInput);
        }

        Object.assign(this.errorNotice.style, {
            display: this.props.backgroundWarning ? 'block' : 'none',
            color: AKARI_WARNING_TEXT_COLOR, fontSize: '12px', margin: '4px 0'
        });
        if (this.props.backgroundWarning) {
            this.errorNotice.textContent = this.props.backgroundWarning;
        }
        this.contentNode.appendChild(this.errorNotice);

        if (this.props.mode === 'create') {
            this.appendAcceptButton('キャンバスを記録');
        }
        this.appendCloseButton(this.props.mode === 'create' ? 'キャンセル' : '閉じる');

        // stage のサイズ（アスペクト比）は window.innerWidth/innerHeight だけに依存するため、
        // DOM 未接続の時点で計算しても問題ない。一方 setupCanvas() は
        // stage.getBoundingClientRect() で実レイアウトを読むため、ダイアログがまだ document に
        // 接続されていない構築時点（buildDom は dialog.open() による接続より前に走る）に呼ぶと
        // 幅・高さ 0 の矩形を読んでしまい、canvas のバッキングストアが 1x1 に壊れる
        // （L1 実機検証で発見）。実接続後の onAfterAttach まで遅延させる。
        this.applyAspectSize();
        if (this.props.mode === 'create') {
            this.wirePointerEvents();
        }
    }

    protected override onAfterAttach(message: Message): void {
        super.onAfterAttach(message);
        this.setupCanvas();
        if (this.props.mode === 'view') {
            if (this.props.backgroundUri) {
                void this.loadBackgroundImage(this.props.backgroundUri);
            }
            this.paintExistingStrokes();
        }
    }

    /** 「実出力アスペクトと一致」させる（L1 受け入れ条件 1）。画面に収まる範囲で最大まで拡大する。 */
    protected applyAspectSize(): void {
        const ratio = this.props.aspect.w / this.props.aspect.h;
        const maxWidth = Math.max(240, window.innerWidth * MAX_DISPLAY_WIDTH_RATIO);
        const maxHeight = Math.max(180, window.innerHeight * MAX_DISPLAY_HEIGHT_RATIO);
        let displayWidth = maxWidth;
        let displayHeight = displayWidth / ratio;
        if (displayHeight > maxHeight) {
            displayHeight = maxHeight;
            displayWidth = displayHeight * ratio;
        }
        this.stage.style.width = `${Math.max(1, Math.round(displayWidth))}px`;
        this.stage.style.height = `${Math.max(1, Math.round(displayHeight))}px`;
    }

    protected setupCanvas(): void {
        const rect = this.stage.getBoundingClientRect();
        this.canvasWidth = Math.max(1, Math.round(rect.width));
        this.canvasHeight = Math.max(1, Math.round(rect.height));
        this.canvasDpr = Math.min(PEN_TUNING.maxDevicePixelRatio, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(this.canvasWidth * this.canvasDpr);
        this.canvas.height = Math.round(this.canvasHeight * this.canvasDpr);
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

    /** キャンバス矩形基準の正規化座標（space: "canvas-rect"。契約 §1）。 */
    protected normalizedPoint(event: PointerEvent): [number, number] {
        const rect = this.stage.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
        return [x, y];
    }

    /** 確定まで保持（フェードなし。動画面の揮発表示は契約 §5 で適用しない）。 */
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
        for (const points of this.props.existingStrokes ?? []) {
            this.paintPolyline(points);
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

    protected clearBackground(): void {
        this.backgroundUri = undefined;
        this.backgroundLoaded = false;
        this.image.style.display = 'none';
        this.image.removeAttribute('src');
        this.backgroundLabel.textContent = '背景: 白紙';
        this.hideNotice();
    }

    protected async pickBackgroundImage(): Promise<void> {
        const uri = await this.fileDialogService.showOpenDialog({
            title: '背景に使う画像を選ぶ',
            canSelectFiles: true,
            canSelectFolders: false,
            filters: BACKGROUND_FILTERS
        });
        if (!uri) {
            return;
        }
        if (!await this.fileService.exists(uri)) {
            this.showNotice('選んだ画像が見つかりません。');
            return;
        }
        this.backgroundUri = uri;
        await this.loadBackgroundImage(uri);
    }

    protected async loadBackgroundImage(uri: URI): Promise<void> {
        try {
            const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
            if (typeof stat.size === 'number' && stat.size > MAX_BACKGROUND_BYTES) {
                this.showNotice('この画像はサイズが大きすぎるため使用できません。白紙のまま続けられます。');
                this.backgroundUri = undefined;
                return;
            }
            const content = await this.fileService.readFile(uri);
            const ext = uri.path.ext.toLowerCase();
            const mimeType = IMAGE_MIME_TYPES.get(ext) ?? 'application/octet-stream';
            const dataUri = `data:${mimeType};base64,${this.toBase64(content.value.buffer)}`;
            await new Promise<void>((resolve, reject) => {
                this.image.addEventListener('load', () => resolve(), { once: true });
                this.image.addEventListener('error', () => reject(new Error('decode failed')), { once: true });
                this.image.src = dataUri;
            });
            this.image.style.display = 'block';
            this.backgroundLoaded = true;
            if (this.props.mode === 'create') {
                this.backgroundLabel.textContent = `背景: ${uri.path.base}`;
            }
            this.hideNotice();
        } catch (error) {
            console.warn('[akari-annotations] canvas dialog failed to load background image', error);
            this.showNotice('画像を読み込めませんでした。白紙のまま続けられます。');
            this.backgroundUri = undefined;
            this.image.style.display = 'none';
        }
        this.update();
    }

    protected showNotice(message: string): void {
        this.errorNotice.textContent = message;
        this.errorNotice.style.display = 'block';
    }

    protected hideNotice(): void {
        if (this.props.backgroundWarning) {
            return;
        }
        this.errorNotice.textContent = '';
        this.errorNotice.style.display = 'none';
    }

    protected override async isValid(value: string | undefined, mode: DialogMode): Promise<DialogError> {
        if (this.props.mode === 'view') {
            return true;
        }
        const hasText = this.memoInput.value.trim().length > 0;
        const hasStrokes = this.completedStrokes.length > 0;
        if (!hasText && !hasStrokes) {
            return { message: 'ペンで描くかメモを入力してください。', result: false };
        }
        if (mode === 'preview' || this.saved) {
            return true;
        }
        try {
            const strokes = this.completedStrokes.map(points => ({ points: decimateStrokePoints(points) }));
            const result = await this.model.saveCanvas({
                aspect: this.props.aspect,
                aspectSource: this.props.aspectSource ?? 'default',
                background: this.backgroundLoaded && this.backgroundUri ? { uri: this.backgroundUri.toString() } : null,
                memo: this.memoInput.value.trim() || null,
                strokes
            });
            this.savedId = result.id;
            this.saved = true;
            return true;
        } catch (error) {
            return { message: `キャンバスを記録できません: ${this.errorMessage(error)}`, result: false };
        }
    }

    get value(): string | undefined {
        return this.savedId;
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
