import URI from '@theia/core/lib/common/uri';
import { MessageService } from '@theia/core/lib/common';
import { BaseWidget, OpenerService, open } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { AkariAnnotationsService, Annotation } from '../common/akari-annotations-protocol';
import { AnnotationStroke, parseReview } from '../common/annotation-store';
import { collectBlockIds, extractBlocksManifest, parseDocTarget, parseImageTarget } from '../common/doc-target';
import { AkariImageAnnotationDialog } from './akari-image-annotation-dialog';
import { ReviewModel } from './review-model';

/** doc: target のブロック存在チェック結果（契約 §6 の劣化規約に対応。akari-review-panel-widget.ts とミラー）。 */
type DocTargetHealth = 'ok' | 'path-missing' | 'block-missing';
/** image: target のファイル存在チェック結果（akari-review-panel-widget.ts とミラー）。 */
type ImageTargetHealth = 'ok' | 'path-missing';

// akari-preview 側の同名イベントとミラー（extension 間の npm 依存を作らない。
// akari-review-panel-widget.ts の ✏️ ボタンと同じ経路を再利用する）。
const REVIEW_ANNOTATION_SHOW_STROKES_EVENT = 'akari.review.annotation.showStrokes';

type BoardColumn = 'open' | 'addressed' | 'resolved';

const COLUMN_DEFS: ReadonlyArray<{ status: BoardColumn; title: string; hint: string }> = [
    { status: 'open', title: '依頼中', hint: '人間からの指摘（AI 対応待ち）' },
    { status: 'addressed', title: 'AI 対応済み', hint: '人間の確認待ち — ここだけ「完了にする」操作あり' },
    { status: 'resolved', title: '完了', hint: '確認済み。読み取り専用アーカイブ' }
];

const INPUT_LABELS: Record<Annotation['input'], string> = {
    typed: 'タイプ',
    voice: '音声',
    session: 'セッション'
};

interface VideoSourceCache {
    single: string;
    bySrcId: Map<string, string>;
}

/**
 * review.json のチケットをかんばん形式（依頼中/AI 対応済み/完了）で見せる、エディタ領域のタブ。
 * データはタイムライン widget が読み込み・監視する ReviewModel に相乗りする（本 widget はファイルを
 * 直接 watch しない）。壊れ検知だけは review.json を直接読み直して診断する（§ refreshDiagnostics）。
 */
@injectable()
export class AkariReviewBoardWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-review-board-widget';

    @inject(ReviewModel)
    protected readonly model!: ReviewModel;

    @inject(AkariAnnotationsService)
    protected readonly annotationsService!: AkariAnnotationsService;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(OpenerService)
    protected readonly openerService!: OpenerService;

    protected readonly notice = document.createElement('div');
    protected readonly board = document.createElement('div');
    protected readonly columnElements = new Map<BoardColumn, { list: HTMLDivElement; count: HTMLSpanElement }>();

    protected videoSources: VideoSourceCache = { single: '', bySrcId: new Map() };
    protected readonly thumbnailCache = new Map<string, string | 'unavailable'>();
    /** doc: target の block-id 存在チェック（契約 §6）。report.html の blocks マニフェストを path ごとにキャッシュする。 */
    protected readonly docTargetHealthCache = new Map<string, Promise<unknown | undefined>>();
    protected refreshToken = 0;

    @postConstruct()
    protected init(): void {
        this.id = AkariReviewBoardWidget.FACTORY_ID;
        this.title.label = 'レビューボード';
        this.title.caption = 'レビューボード（review.json のかんばん）';
        this.title.iconClass = 'codicon codicon-project';
        this.title.closable = true;
        this.node.classList.add('akari-review-board-widget');
        Object.assign(this.node.style, {
            display: 'grid',
            gridTemplateRows: 'auto minmax(0, 1fr)',
            height: '100%',
            overflow: 'hidden',
            background: 'var(--theia-editor-background)'
        });

        Object.assign(this.notice.style, {
            display: 'none', padding: '7px 11px', color: 'var(--theia-warningForeground)',
            background: 'var(--theia-inputValidation-warningBackground)',
            borderBottom: '1px solid var(--theia-inputValidation-warningBorder)', fontSize: '12px', lineHeight: '1.4'
        });
        this.notice.setAttribute('data-board-notice', '');

        Object.assign(this.board.style, {
            display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1px',
            minHeight: '0', overflow: 'hidden', background: 'var(--theia-widget-border)'
        });
        for (const def of COLUMN_DEFS) {
            const column = document.createElement('div');
            column.setAttribute('data-board-column', def.status);
            Object.assign(column.style, {
                display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)',
                minHeight: '0', background: 'var(--theia-editor-background)'
            });
            const header = document.createElement('div');
            Object.assign(header.style, {
                display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px',
                borderBottom: '1px solid var(--theia-widget-border)'
            });
            const title = document.createElement('strong');
            title.textContent = def.title;
            title.title = def.hint;
            const count = document.createElement('span');
            count.setAttribute('data-board-column-count', def.status);
            Object.assign(count.style, {
                marginLeft: 'auto', color: 'var(--theia-descriptionForeground)', fontSize: '12px'
            });
            header.append(title, count);
            const list = document.createElement('div');
            Object.assign(list.style, { minHeight: '0', overflow: 'auto', padding: '6px' });
            column.append(header, list);
            this.board.appendChild(column);
            this.columnElements.set(def.status, { list, count });
        }

        this.node.append(this.notice, this.board);

        this.toDispose.push(this.model.onChanged(() => this.refresh()));
        this.refresh();
    }

    /** review.json の読み込み・監視はタイムライン側（ReviewModel 経由）に相乗りする。ここでは壊れ検知だけ独自に行う。 */
    protected refresh(): void {
        const token = ++this.refreshToken;
        this.renderColumns();
        void this.refreshVideoSources().then(() => {
            if (token === this.refreshToken) {
                this.renderColumns();
            }
        });
        void this.refreshDiagnostics();
    }

    protected renderColumns(): void {
        // 一覧が再描画されるたびに劣化状態を再確認する（ファイルのリネーム・差し替えを
        // ライブセッション中に検知できるよう、レンダーパスをまたいでキャッシュしない）。
        this.docTargetHealthCache.clear();
        const byStatus = new Map<BoardColumn, Annotation[]>();
        for (const def of COLUMN_DEFS) {
            byStatus.set(def.status, []);
        }
        for (const annotation of [...this.model.annotations].sort(
            (left, right) => (left.sourceT ?? Infinity) - (right.sourceT ?? Infinity)
        )) {
            byStatus.get(annotation.status)?.push(annotation);
        }
        for (const def of COLUMN_DEFS) {
            const elements = this.columnElements.get(def.status);
            if (!elements) {
                continue;
            }
            const annotations = byStatus.get(def.status) ?? [];
            elements.count.textContent = String(annotations.length);
            elements.list.replaceChildren();
            if (annotations.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = 'チケットはありません。';
                empty.style.color = 'var(--theia-descriptionForeground)';
                empty.style.padding = '8px 2px';
                elements.list.appendChild(empty);
                continue;
            }
            for (const annotation of annotations) {
                elements.list.appendChild(this.renderCard(annotation));
            }
        }
    }

    protected renderCard(annotation: Annotation): HTMLDivElement {
        const card = document.createElement('div');
        card.className = 'akari-review-board-card';
        card.setAttribute('data-board-card', annotation.id);
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        Object.assign(card.style, {
            display: 'grid', gap: '6px', padding: '8px', marginBottom: '8px',
            border: '1px solid var(--theia-widget-border)', borderRadius: '4px',
            background: 'var(--theia-editorWidget-background)', cursor: 'pointer'
        });

        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' });
        const time = document.createElement('span');
        time.textContent = this.formatTimestamp(annotation.sourceT);
        Object.assign(time.style, {
            fontVariantNumeric: 'tabular-nums', fontSize: '11px', color: 'var(--theia-descriptionForeground)'
        });
        head.appendChild(time);

        const inputTag = document.createElement('span');
        inputTag.textContent = INPUT_LABELS[annotation.input] ?? annotation.input;
        Object.assign(inputTag.style, {
            fontSize: '11px', color: 'var(--theia-descriptionForeground)',
            border: '1px solid var(--theia-widget-border)', borderRadius: '999px', padding: '0 7px'
        });
        head.appendChild(inputTag);

        const flagged = annotation.text.trim().startsWith('[要確認]');
        if (flagged) {
            const flagBadge = document.createElement('span');
            flagBadge.textContent = '要確認';
            flagBadge.setAttribute('data-board-flag', annotation.id);
            Object.assign(flagBadge.style, {
                fontSize: '11px', color: 'var(--theia-errorForeground)',
                border: '1px solid var(--theia-errorForeground)', borderRadius: '999px', padding: '0 7px'
            });
            head.appendChild(flagBadge);
        }
        if (annotation.session) {
            const confidenceBadge = document.createElement('span');
            confidenceBadge.textContent = `confidence: ${annotation.session.confidence}`;
            confidenceBadge.setAttribute('data-board-confidence', annotation.session.confidence);
            const color = annotation.session.confidence === 'low'
                ? 'var(--theia-errorForeground)'
                : annotation.session.confidence === 'medium'
                    ? '#d68a00'
                    : 'var(--theia-charts-green)';
            Object.assign(confidenceBadge.style, {
                fontSize: '11px', color, border: `1px solid ${color}`, borderRadius: '999px', padding: '0 7px'
            });
            head.appendChild(confidenceBadge);
        }
        const hasStrokes = Array.isArray(annotation.strokes) && annotation.strokes.length > 0;
        if (hasStrokes) {
            const strokesBadge = document.createElement('span');
            strokesBadge.textContent = '✏️';
            strokesBadge.title = 'ペン描画あり（カードクリックで静止表示）';
            head.appendChild(strokesBadge);
        }
        if (annotation.status === 'addressed') {
            const resolveButton = document.createElement('button');
            resolveButton.type = 'button';
            resolveButton.className = 'theia-button secondary';
            resolveButton.textContent = '完了にする';
            resolveButton.setAttribute('data-board-resolve', annotation.id);
            resolveButton.style.marginLeft = 'auto';
            resolveButton.addEventListener('click', event => {
                event.stopPropagation();
                void this.resolveAnnotationById(annotation.id);
            });
            head.appendChild(resolveButton);
        }
        card.appendChild(head);

        const docTarget = parseDocTarget(annotation.target);
        const imageTarget = parseImageTarget(annotation.target);
        if (docTarget) {
            card.appendChild(this.renderDocTargetRow(docTarget));
        } else if (imageTarget) {
            card.appendChild(this.renderImageTargetRow(imageTarget));
        } else if (annotation.target) {
            const target = document.createElement('div');
            target.textContent = annotation.target;
            Object.assign(target.style, { fontSize: '11px', color: 'var(--theia-descriptionForeground)' });
            card.appendChild(target);
        }

        if (!docTarget && !imageTarget) {
            const thumbnail = document.createElement('div');
            thumbnail.setAttribute('data-board-thumbnail', annotation.id);
            Object.assign(thumbnail.style, {
                width: '100%', aspectRatio: '16 / 9', borderRadius: '3px', overflow: 'hidden',
                background: 'var(--theia-input-background)', display: 'flex',
                alignItems: 'center', justifyContent: 'center'
            });
            card.appendChild(thumbnail);
            void this.loadThumbnail(annotation, thumbnail);
        }

        const text = document.createElement('div');
        text.textContent = annotation.text.split('\n')[0];
        Object.assign(text.style, {
            fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: '3', WebkitBoxOrient: 'vertical'
        });
        card.appendChild(text);

        if (annotation.response) {
            const response = document.createElement('div');
            response.style.color = 'var(--theia-descriptionForeground)';
            response.style.fontSize = '11px';
            const actionLabel = annotation.response.action === 'edited' ? '編集しました' : '見送りました';
            response.textContent = `対応（${actionLabel}）: ${annotation.response.summary}`;
            card.appendChild(response);
        }

        const activate = (): void => this.activateCard(annotation);
        card.addEventListener('click', activate);
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
            }
        });
        return card;
    }

    /**
     * strokes 付きは静止表示イベント（akari-review-panel-widget.ts の ✏️ ボタンと同経路）に
     * seek 自体も委ねる — akari-preview 側のハンドラが detail.sourceT でシーク後にストロークを
     * 描画するため、ここで別途 model.requestSeek も呼ぶと cuts 変換済みの時刻と未変換の
     * sourceT とで二重にシークし合って後勝ちの方に化けてしまう（本タスクの L1 実機検証で発見）。
     */
    protected activateCard(annotation: Annotation): void {
        const docTarget = parseDocTarget(annotation.target);
        if (docTarget) {
            void this.openReportAndReveal(docTarget);
            return;
        }
        const imageTarget = parseImageTarget(annotation.target);
        if (imageTarget) {
            void this.openImageAnnotationPopup(imageTarget.path, annotation.strokes);
            return;
        }
        const hasStrokes = Array.isArray(annotation.strokes) && annotation.strokes.length > 0;
        const editUri = this.model.location?.editUri?.normalizePath().toString();
        if (hasStrokes && editUri) {
            window.dispatchEvent(new CustomEvent(REVIEW_ANNOTATION_SHOW_STROKES_EVENT, {
                detail: { editUri, sourceT: annotation.sourceT, strokes: annotation.strokes }
            }));
            return;
        }
        if (annotation.sourceT !== null) {
            this.model.requestSeek(annotation.sourceT);
        }
    }

    /**
     * image: target 注釈のカードクリック導線（契約 §4-2・受け入れ条件 3。akari-review-panel-widget.ts
     * の同名メソッドとミラー）: ポップアップを再表示し strokes を静止描画する（揮発しない）。
     */
    protected async openImageAnnotationPopup(path: string, strokes: Annotation['strokes']): Promise<void> {
        const location = this.model.location;
        if (!location) {
            return;
        }
        const imageUri = location.root.resolve(path);
        if (!await this.fileService.exists(imageUri)) {
            this.messages.warn(`${path} が見つからないため、ポップアップを再表示できません。`);
            return;
        }
        const imageRectStrokes = (strokes ?? []).filter(
            (stroke): stroke is Extract<AnnotationStroke, { space: 'image-rect' }> => stroke.space === 'image-rect'
        );
        const dialog = new AkariImageAnnotationDialog(
            { title: '画像の注釈', mode: 'view', imageUri, relativePath: path, existingStrokes: imageRectStrokes, maxWidth: 960 },
            this.fileService,
            this.model
        );
        await dialog.open();
    }

    /** image: target 用の行（契約 §6 の劣化規約: path 不在は warning バッジ）。 */
    protected renderImageTargetRow(imageTarget: { path: string }): HTMLDivElement {
        const row = document.createElement('div');
        Object.assign(row.style, { fontSize: '11px', color: 'var(--theia-descriptionForeground)' });
        row.setAttribute('data-board-image-target', imageTarget.path);
        row.textContent = `🖼️ ${imageTarget.path}`;
        row.title = `${imageTarget.path} — クリックでポップアップを再表示`;
        void this.imageTargetHealth(imageTarget.path).then(health => {
            if (!row.isConnected) {
                return;
            }
            if (health === 'path-missing') {
                row.textContent = `🖼️⚠️ ${imageTarget.path}`;
                row.title = `${imageTarget.path} が見つかりません（再表示は不可。注釈自体は有効です）`;
                row.style.color = 'var(--theia-warningForeground)';
            }
        });
        return row;
    }

    protected async imageTargetHealth(path: string): Promise<ImageTargetHealth> {
        const location = this.model.location;
        if (!location) {
            return 'path-missing';
        }
        return await this.fileService.exists(location.root.resolve(path)) ? 'ok' : 'path-missing';
    }

    /**
     * doc: target 用の行（レポートを開くリンク + 劣化バッジ）。akari-review-panel-widget.ts の
     * renderDocTargetButton と同じ規約（契約 §6: path 不在は warning・block-id 消失は「対象消失」）。
     */
    protected renderDocTargetRow(docTarget: { path: string; blockId: string }): HTMLDivElement {
        const row = document.createElement('div');
        Object.assign(row.style, { fontSize: '11px', color: 'var(--theia-textLink-foreground)' });
        row.setAttribute('data-board-doc-target', `${docTarget.path}#${docTarget.blockId}`);
        row.textContent = `📄 ${docTarget.path}`;
        row.title = `${docTarget.path}#${docTarget.blockId}`;
        void this.docTargetHealth(docTarget.path, docTarget.blockId).then(health => {
            if (!row.isConnected) {
                return;
            }
            if (health === 'path-missing') {
                row.textContent = `📄⚠️ ${docTarget.path}`;
                row.title = `${docTarget.path} が見つかりません（ピン表示は不可。注釈自体は有効です）`;
            } else if (health === 'block-missing') {
                row.textContent = `📄 ${docTarget.path}（対象消失）`;
                row.title = `block-id が現在のレポートにありません: ${docTarget.blockId}`;
                row.style.color = 'var(--theia-warningForeground)';
            }
        });
        return row;
    }

    /** report.html を開き（既存タブを再利用）、対象ブロックへスクロール + ピン表示させる。 */
    protected async openReportAndReveal(docTarget: { path: string; blockId: string }): Promise<void> {
        const location = this.model.location;
        if (!location) {
            return;
        }
        const reportUri = location.root.resolve(docTarget.path);
        try {
            const opened = await open(this.openerService, reportUri);
            if (opened instanceof WebviewWidget) {
                opened.sendMessage({ type: 'akari-doc-annotation-reveal', blockId: docTarget.blockId });
            }
        } catch (error) {
            this.messages.error(`レポートを開けません: ${this.errorMessage(error)}`);
        }
    }

    protected async docTargetHealth(path: string, blockId: string): Promise<DocTargetHealth> {
        const location = this.model.location;
        if (!location) {
            return 'path-missing';
        }
        const uri = location.root.resolve(path);
        const cacheKey = uri.toString();
        let cached = this.docTargetHealthCache.get(cacheKey);
        if (!cached) {
            cached = this.readBlocksManifest(uri);
            this.docTargetHealthCache.set(cacheKey, cached);
        }
        const manifest = await cached;
        if (manifest === undefined) {
            return 'path-missing';
        }
        return collectBlockIds(manifest).has(blockId) ? 'ok' : 'block-missing';
    }

    protected async readBlocksManifest(uri: URI): Promise<unknown | undefined> {
        try {
            if (!(await this.fileService.exists(uri))) {
                return undefined;
            }
            const source = (await this.fileService.readFile(uri)).value.toString();
            return extractBlocksManifest(source);
        } catch {
            return undefined;
        }
    }

    protected async resolveAnnotationById(id: string): Promise<void> {
        try {
            await this.model.resolveAnnotation(id);
        } catch (error) {
            const detail = this.errorMessage(error);
            this.messages.error(`完了にできません: ${detail}`);
        }
    }

    /**
     * review.json は既存 annotations サービスの読み込み経路（ReviewModel）に相乗りするため
     * ここでは watch しない。壊れ（JSON 不正・要素破損）だけは v0 劣化規約どおり warning 表示
     * のために読み直す（parseReview はタイムライン widget と共有する同一の純関数）。
     */
    protected async refreshDiagnostics(): Promise<void> {
        const location = this.model.location;
        if (!location) {
            this.hideNotice();
            return;
        }
        try {
            const exists = await this.fileService.exists(location.reviewUri);
            if (!exists) {
                this.hideNotice();
                return;
            }
            const source = (await this.fileService.readFile(location.reviewUri)).value.toString();
            const parsed = parseReview(source);
            if (parsed.warnings.length > 0) {
                this.showNotice(parsed.warnings.join(' '));
            } else {
                this.hideNotice();
            }
        } catch (error) {
            this.showNotice(`レビューデータを読み取れません: ${this.errorMessage(error)}`);
        }
    }

    /** edit.json の source(s) からサムネイル用の動画パスを解決する（cuts 等の複雑な写像には踏み込まない）。 */
    protected async refreshVideoSources(): Promise<void> {
        const location = this.model.location;
        const next: VideoSourceCache = { single: location?.videoUri ?? '', bySrcId: new Map() };
        if (location?.editUri) {
            try {
                const source = (await this.fileService.readFile(location.editUri)).value.toString();
                const value = JSON.parse(source) as { source?: { path?: string }; sources?: Array<{ id?: string; path?: string }> };
                if (Array.isArray(value.sources)) {
                    for (const entry of value.sources) {
                        if (typeof entry?.id === 'string' && typeof entry?.path === 'string') {
                            next.bySrcId.set(entry.id, location.editUri.parent.resolve(entry.path).toString());
                        }
                    }
                } else if (typeof value.source?.path === 'string') {
                    next.single = location.editUri.parent.resolve(value.source.path).toString();
                }
            } catch {
                // edit.json が読めない/壊れている場合は location.videoUri のフォールバックのまま進める
            }
        }
        this.videoSources = next;
    }

    protected videoUriFor(annotation: Annotation): string {
        if (annotation.src) {
            return this.videoSources.bySrcId.get(annotation.src) ?? this.videoSources.single;
        }
        return this.videoSources.single;
    }

    protected async loadThumbnail(annotation: Annotation, container: HTMLDivElement): Promise<void> {
        const location = this.model.location;
        const videoUri = this.videoUriFor(annotation);
        // sourceT: null（doc: / image: target 以外の想定外レコードも含め、劣化規約により
        // 表示自体は残す）はサムネイルの対象時刻を持たないため縮退させる。
        const sourceT = annotation.sourceT;
        if (!location || !videoUri || sourceT === null) {
            this.renderThumbnailPlaceholder(container);
            return;
        }
        const cacheKey = `${videoUri}@${sourceT}`;
        const cached = this.thumbnailCache.get(cacheKey);
        if (cached === 'unavailable') {
            this.renderThumbnailPlaceholder(container);
            return;
        }
        if (cached) {
            this.renderThumbnailImage(container, cached);
            return;
        }
        try {
            const result = await this.annotationsService.getClipThumbnail({
                projectRootUri: location.root.toString(),
                videoUri,
                atSeconds: sourceT
            });
            if (!container.isConnected) {
                return;
            }
            if (result.status === 'ready' && result.dataUri) {
                this.thumbnailCache.set(cacheKey, result.dataUri);
                this.renderThumbnailImage(container, result.dataUri);
            } else {
                this.thumbnailCache.set(cacheKey, 'unavailable');
                this.renderThumbnailPlaceholder(container);
            }
        } catch {
            this.thumbnailCache.set(cacheKey, 'unavailable');
            if (container.isConnected) {
                this.renderThumbnailPlaceholder(container);
            }
        }
    }

    protected renderThumbnailImage(container: HTMLDivElement, dataUri: string): void {
        container.replaceChildren();
        const image = document.createElement('img');
        image.src = dataUri;
        image.alt = '';
        Object.assign(image.style, { width: '100%', height: '100%', objectFit: 'cover' });
        container.appendChild(image);
    }

    protected renderThumbnailPlaceholder(container: HTMLDivElement): void {
        container.replaceChildren();
        const icon = document.createElement('span');
        icon.textContent = '🎬';
        icon.style.opacity = '0.4';
        icon.style.fontSize = '18px';
        container.appendChild(icon);
    }

    protected showNotice(message: string): void {
        this.notice.textContent = message;
        this.notice.style.display = 'block';
    }

    protected hideNotice(): void {
        this.notice.textContent = '';
        this.notice.style.display = 'none';
    }

    /** sourceT: null（doc: / image: target）は時刻表示を持たないため縮退させる（契約 §2）。 */
    protected formatTimestamp(value: number | null): string {
        if (value === null) {
            return '--:--:--.---';
        }
        const milliseconds = Math.max(0, Math.round(value * 1000));
        const hours = Math.floor(milliseconds / 3_600_000);
        const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
        const seconds = Math.floor((milliseconds % 60_000) / 1000);
        const fraction = milliseconds % 1000;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
            `${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
