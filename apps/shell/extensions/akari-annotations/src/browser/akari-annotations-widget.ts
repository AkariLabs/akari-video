import { CommandService, MessageService } from '@theia/core/lib/common';
import { BaseWidget } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { AkariAnnotationsService, Annotation } from '../common/akari-annotations-protocol';
import { parseReview } from '../common/annotation-store';
import { ProjectLocation } from './project-location';

const TRANSCRIPT_SEEK_COMMAND_ID = 'akari.transcript.seekRequested';
const STATUS_LABELS: Record<Annotation['status'], string> = {
    open: '未対応',
    addressed: '対応済み',
    resolved: '確認済み'
};
const STATUS_COLORS: Record<Annotation['status'], string> = {
    open: 'var(--theia-charts-blue)',
    addressed: '#d68a00',
    resolved: 'var(--theia-charts-green)'
};

interface CutRange { in: number; out: number; }
interface CaptionTick { start: number; end: number; text: string; }

@injectable()
export class AkariAnnotationsWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-annotations-widget';

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(CommandService)
    protected readonly commands!: CommandService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(AkariAnnotationsService)
    protected readonly annotationsService!: AkariAnnotationsService;

    protected readonly toolbar = document.createElement('div');
    protected readonly filterSelect = document.createElement('select');
    protected readonly strip = document.createElement('div');
    protected readonly playhead = document.createElement('div');
    protected readonly composerRow = document.createElement('div');
    protected readonly timeLabel = document.createElement('span');
    protected readonly textInput = document.createElement('input');
    protected readonly addButton = document.createElement('button');
    protected readonly notice = document.createElement('div');
    protected readonly listContainer = document.createElement('div');
    protected readonly footer = document.createElement('div');

    protected location: ProjectLocation | undefined;
    protected annotations: Annotation[] = [];
    protected captions: CaptionTick[] = [];
    protected keepRanges: CutRange[] = [];
    protected selectedSourceT = 0;
    protected statusFilter: 'all' | Annotation['status'] = 'all';
    protected configured = false;

    @postConstruct()
    protected init(): void {
        this.id = AkariAnnotationsWidget.FACTORY_ID;
        this.title.label = '注釈';
        this.title.caption = 'レビューコメントとタイムライン';
        this.title.iconClass = 'codicon codicon-comment';
        this.title.closable = true;
        this.node.classList.add('akari-annotations-widget');
        Object.assign(this.node.style, {
            display: 'grid',
            gridTemplateRows: 'auto auto auto auto minmax(0, 1fr) auto',
            height: '100%',
            overflow: 'hidden',
            background: 'var(--theia-editor-background)'
        });

        Object.assign(this.toolbar.style, {
            alignItems: 'center', display: 'flex', gap: '10px', minHeight: '38px',
            padding: '6px 10px', borderBottom: '1px solid var(--theia-widget-border)', boxSizing: 'border-box'
        });
        const heading = document.createElement('strong');
        heading.textContent = '注釈';
        heading.style.marginRight = 'auto';
        this.filterSelect.setAttribute('aria-label', '状態で絞り込み');
        const filterOptions: Array<[string, string]> = [['all', 'すべて'], ['open', '未対応'], ['addressed', '対応済み'], ['resolved', '確認済み']];
        for (const [value, label] of filterOptions) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            this.filterSelect.appendChild(option);
        }
        this.filterSelect.addEventListener('change', () => {
            this.statusFilter = this.filterSelect.value as typeof this.statusFilter;
            this.renderList();
        });
        this.toolbar.append(heading, this.filterSelect);

        Object.assign(this.strip.style, {
            position: 'relative', margin: '8px 10px', height: '64px',
            border: '1px solid var(--theia-widget-border)', borderRadius: '4px',
            background: 'var(--theia-editorWidget-background)', cursor: 'pointer', overflow: 'hidden'
        });
        Object.assign(this.playhead.style, {
            position: 'absolute', top: '0', bottom: '0', width: '2px',
            background: 'var(--theia-focusBorder)', left: '0%', pointerEvents: 'none'
        });
        this.strip.appendChild(this.playhead);
        this.strip.addEventListener('click', event => this.onStripClick(event));

        Object.assign(this.composerRow.style, {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px 8px', boxSizing: 'border-box'
        });
        Object.assign(this.timeLabel.style, { fontVariantNumeric: 'tabular-nums', color: 'var(--theia-descriptionForeground)', minWidth: '96px' });
        this.textInput.type = 'text';
        this.textInput.placeholder = 'コメントを入力';
        this.textInput.setAttribute('aria-label', 'コメントを入力');
        Object.assign(this.textInput.style, { flex: '1', minWidth: '0' });
        this.textInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void this.submitAnnotation();
            }
        });
        this.addButton.type = 'button';
        this.addButton.className = 'theia-button main';
        this.addButton.textContent = '追加';
        this.addButton.addEventListener('click', () => void this.submitAnnotation());
        this.composerRow.append(this.timeLabel, this.textInput, this.addButton);

        Object.assign(this.notice.style, {
            display: 'none', padding: '7px 11px', color: 'var(--theia-warningForeground)',
            background: 'var(--theia-inputValidation-warningBackground)',
            borderBottom: '1px solid var(--theia-inputValidation-warningBorder)', fontSize: '12px', lineHeight: '1.4'
        });

        Object.assign(this.listContainer.style, { minHeight: '0', overflow: 'auto', padding: '4px 10px' });

        Object.assign(this.footer.style, {
            height: '26px', minHeight: '26px', maxHeight: '26px', padding: '5px 10px', boxSizing: 'border-box',
            borderTop: '1px solid var(--theia-widget-border)', color: 'var(--theia-descriptionForeground)',
            fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        });
        this.footer.textContent = 'ストリップをクリックすると時刻を選べます。プレビューを開いていればその場でシークします。';

        this.node.append(this.toolbar, this.strip, this.composerRow, this.notice, this.listContainer, this.footer);
        const style = document.createElement('style');
        style.textContent = `
    .akari-annotations-widget .akari-annotations-strip-cut {
        background: color-mix(in srgb, var(--theia-editor-background) 78%, var(--theia-disabledForeground, #888));
        opacity: .8;
    }
    .akari-annotations-widget .akari-annotations-strip-caption {
        background: var(--theia-charts-purple, #b180d7);
        opacity: .55;
        border-radius: 2px;
    }
    .akari-annotations-widget .akari-annotations-strip-caption-text {
        position: absolute;
        top: 26px;
        height: 16px;
        display: flex;
        align-items: center;
        white-space: nowrap;
        font-size: 11px;
        line-height: 1;
        color: var(--theia-foreground);
        pointer-events: none;
        padding-left: 3px;
        z-index: 1;
        text-shadow: 0 0 2px var(--theia-editorWidget-background), 0 0 3px var(--theia-editorWidget-background);
    }
`;
        this.node.appendChild(style);
        this.updateTimeLabel();
    }

    async configure(location: ProjectLocation): Promise<void> {
        if (this.configured) {
            return;
        }
        this.configured = true;
        this.location = location;
        this.title.caption = location.reviewUri.toString();
        await this.reloadAll();
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (!this.location) {
                return;
            }
            if (event.contains(this.location.reviewUri)) {
                void this.reloadReview();
            }
            if (this.location.editUri && event.contains(this.location.editUri)) {
                void this.reloadEdit();
            }
            if (event.contains(this.location.captionsUri)) {
                void this.reloadCaptions();
            }
        }));
        try {
            this.toDispose.push(await this.fileService.watch(location.root, { recursive: true, excludes: [] }));
        } catch (error) {
            console.warn('[akari-annotations] file watching is unavailable', error);
        }
    }

    protected async reloadAll(): Promise<void> {
        await Promise.all([this.reloadReview(), this.reloadEdit(), this.reloadCaptions()]);
    }

    protected async reloadReview(): Promise<void> {
        if (!this.location) {
            return;
        }
        try {
            const exists = await this.fileService.exists(this.location.reviewUri);
            if (!exists) {
                this.annotations = [];
                this.hideNotice();
            } else {
                const source = (await this.fileService.readFile(this.location.reviewUri)).value.toString();
                const parsed = parseReview(source);
                this.annotations = parsed.annotations;
                this.showWarnings(parsed.warnings);
            }
        } catch (error) {
            this.annotations = [];
            this.showNotice(`レビューデータを読み取れません: ${this.errorMessage(error)}`);
        }
        this.renderStrip();
        this.renderList();
    }

    protected async reloadEdit(): Promise<void> {
        this.keepRanges = [];
        if (this.location?.editUri) {
            try {
                const edit = JSON.parse((await this.fileService.readFile(this.location.editUri)).value.toString());
                if (Array.isArray(edit?.cuts)) {
                    this.keepRanges = edit.cuts.flatMap((value: any) => {
                        const input = Number(value?.in);
                        const output = Number(value?.out);
                        return Number.isFinite(input) && Number.isFinite(output) && input < output ? [{ in: input, out: output }] : [];
                    });
                }
            } catch {
                // A missing or unreadable edit.json means no cut overlay is drawn.
            }
        }
        this.renderStrip();
    }

    protected async reloadCaptions(): Promise<void> {
        this.captions = [];
        if (this.location) {
            try {
                const source = (await this.fileService.readFile(this.location.captionsUri)).value.toString();
                const parsed = JSON.parse(source);
                if (Array.isArray(parsed)) {
                    this.captions = parsed.flatMap((value: any) => {
                        const start = Number(value?.start);
                        const end = Number(value?.end);
                        return Number.isFinite(start) && Number.isFinite(end) && start < end
                            ? [{ start, end, text: typeof value?.text === 'string' ? value.text : '' }]
                            : [];
                    });
                }
            } catch {
                // A missing or unreadable captions.json means no caption ticks are drawn.
            }
        }
        this.renderStrip();
    }

    protected totalDuration(): number {
        const candidates = [
            10,
            ...this.captions.map(caption => caption.end),
            ...this.keepRanges.map(range => range.out),
            ...this.annotations.map(annotation => annotation.sourceT + 1)
        ];
        return Math.max(...candidates) * 1.02;
    }

    protected renderStrip(): void {
        for (const child of Array.from(this.strip.children)) {
            if (child !== this.playhead) {
                child.remove();
            }
        }
        const duration = this.totalDuration();
        if (this.keepRanges.length > 0) {
            let cursor = 0;
            const sorted = [...this.keepRanges].sort((left, right) => left.in - right.in);
            for (const range of sorted) {
                if (range.in > cursor) {
                    this.strip.appendChild(this.stripSegment(cursor, range.in, 0, 24, 'akari-annotations-strip-cut'));
                }
                cursor = Math.max(cursor, range.out);
            }
            if (cursor < duration) {
                this.strip.appendChild(this.stripSegment(cursor, duration, 0, 24, 'akari-annotations-strip-cut'));
            }
        }
        for (const caption of this.captions) {
            const captionEnd = Math.max(caption.end, caption.start + 0.15);
            this.strip.appendChild(this.stripSegment(caption.start, captionEnd, 26, 16, 'akari-annotations-strip-caption', caption.text));
            this.strip.appendChild(this.captionLabel(caption.start, caption.text));
        }
        for (const annotation of this.annotations) {
            const marker = this.stripSegment(annotation.sourceT, annotation.sourceT + Math.max(duration * 0.006, 0.2), 44, 18, 'akari-annotations-strip-pin', `${this.formatTimestamp(annotation.sourceT)} ${annotation.text}`);
            marker.style.background = STATUS_COLORS[annotation.status];
            marker.style.borderRadius = '50%';
            marker.setAttribute('data-annotation-id', annotation.id);
            marker.setAttribute('data-annotation-status', annotation.status);
            this.strip.appendChild(marker);
        }
        this.playhead.style.left = `${this.percent(this.selectedSourceT, duration)}%`;
        this.updateTimeLabel();
    }

    protected stripSegment(start: number, end: number, top: number, height: number, className: string, title?: string): HTMLDivElement {
        const duration = this.totalDuration();
        const element = document.createElement('div');
        element.className = className;
        if (title) {
            element.title = title;
        }
        Object.assign(element.style, {
            position: 'absolute',
            top: `${top}px`,
            height: `${height}px`,
            left: `${this.percent(start, duration)}%`,
            width: `${Math.max(this.percent(end, duration) - this.percent(start, duration), 0.3)}%`,
            pointerEvents: 'none'
        });
        return element;
    }

    protected captionLabel(start: number, text: string): HTMLDivElement {
        const duration = this.totalDuration();
        const label = document.createElement('div');
        label.className = 'akari-annotations-strip-caption-text';
        label.textContent = text;
        label.title = text;
        label.style.left = `${this.percent(start, duration)}%`;
        return label;
    }

    protected percent(value: number, duration: number): number {
        return duration > 0 ? Math.min(100, Math.max(0, (value / duration) * 100)) : 0;
    }

    protected onStripClick(event: MouseEvent): void {
        const rect = this.strip.getBoundingClientRect();
        const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
        this.selectedSourceT = ratio * this.totalDuration();
        this.playhead.style.left = `${ratio * 100}%`;
        this.updateTimeLabel();
        void this.requestSeek(this.selectedSourceT);
    }

    protected updateTimeLabel(): void {
        this.timeLabel.textContent = this.formatTimestamp(this.selectedSourceT);
    }

    protected async requestSeek(time: number): Promise<void> {
        if (!this.location?.videoUri) {
            this.footer.textContent = `${this.formatTimestamp(time)} を選択しました。動画に結び付く文字起こしが見つかりません。`;
            return;
        }
        const result = await this.commands.executeCommand<'seeked' | 'mismatched-asset' | 'no-preview'>(
            TRANSCRIPT_SEEK_COMMAND_ID,
            { videoUri: this.location.videoUri, time, captionId: '' }
        );
        const timestamp = this.formatTimestamp(time);
        this.footer.textContent = result === 'seeked'
            ? `${timestamp} にプレビューをシークしました。`
            : result === 'mismatched-asset'
                ? `${timestamp} を選択しました。別の素材のプレビューが開いています。`
                : `${timestamp} を選択しました。プレビューを開くとここからジャンプできます。`;
    }

    protected async submitAnnotation(): Promise<void> {
        const text = this.textInput.value.trim();
        if (!text || !this.location) {
            return;
        }
        this.addButton.disabled = true;
        try {
            const result = await this.annotationsService.createAnnotation({
                reviewUri: this.location.reviewUri.toString(),
                projectRootUri: this.location.root.toString(),
                sourceT: this.selectedSourceT,
                timelineT: null,
                target: null,
                text
            });
            if (!this.annotations.some(existing => existing.id === result.annotation.id)) {
                this.annotations = [...this.annotations, result.annotation];
            }
            this.textInput.value = '';
            this.hideNotice();
            this.renderStrip();
            this.renderList();
            this.footer.textContent = result.committed
                ? '注釈を追加しました。変更を記録しました。'
                : '注釈を追加しました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`注釈を追加できません: ${detail}`);
            this.messages.error(`注釈を追加できません: ${detail}`);
        } finally {
            this.addButton.disabled = false;
        }
    }

    protected async resolveAnnotationById(id: string): Promise<void> {
        if (!this.location) {
            return;
        }
        try {
            const result = await this.annotationsService.resolveAnnotation({
                reviewUri: this.location.reviewUri.toString(),
                annotationId: id
            });
            this.annotations = this.annotations.map(annotation => annotation.id === id ? result.annotation : annotation);
            this.renderStrip();
            this.renderList();
            this.footer.textContent = '注釈を確認済みにしました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`更新できません: ${detail}`);
            this.messages.error(`更新できません: ${detail}`);
        }
    }

    protected renderList(): void {
        this.listContainer.replaceChildren();
        const filtered = this.annotations
            .filter(annotation => this.statusFilter === 'all' || annotation.status === this.statusFilter)
            .sort((left, right) => left.sourceT - right.sourceT);
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '該当する注釈はありません。';
            empty.style.color = 'var(--theia-descriptionForeground)';
            empty.style.padding = '8px 2px';
            this.listContainer.appendChild(empty);
            return;
        }
        for (const annotation of filtered) {
            this.listContainer.appendChild(this.renderAnnotationRow(annotation));
        }
    }

    protected renderAnnotationRow(annotation: Annotation): HTMLDivElement {
        const row = document.createElement('div');
        row.setAttribute('data-annotation-row', annotation.id);
        Object.assign(row.style, {
            display: 'grid', gap: '4px', padding: '8px 6px', borderBottom: '1px solid var(--theia-widget-border)'
        });
        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        const time = document.createElement('span');
        time.textContent = this.formatTimestamp(annotation.sourceT);
        time.style.fontVariantNumeric = 'tabular-nums';
        const badge = document.createElement('span');
        badge.textContent = STATUS_LABELS[annotation.status];
        Object.assign(badge.style, { color: STATUS_COLORS[annotation.status], fontSize: '11px', border: `1px solid ${STATUS_COLORS[annotation.status]}`, borderRadius: '999px', padding: '0 8px' });
        head.append(time, badge);
        if (annotation.status === 'addressed') {
            const resolveButton = document.createElement('button');
            resolveButton.type = 'button';
            resolveButton.className = 'theia-button secondary';
            resolveButton.textContent = '確認済みにする';
            resolveButton.setAttribute('data-resolve-button', annotation.id);
            resolveButton.style.marginLeft = 'auto';
            resolveButton.addEventListener('click', () => void this.resolveAnnotationById(annotation.id));
            head.appendChild(resolveButton);
        }
        const text = document.createElement('div');
        text.textContent = annotation.text;
        row.append(head, text);
        if (annotation.response) {
            const response = document.createElement('div');
            response.style.color = 'var(--theia-descriptionForeground)';
            response.style.fontSize = '12px';
            response.textContent = `対応（${annotation.response.action === 'edited' ? '編集しました' : '見送りました'}）: ${annotation.response.summary}`;
            row.appendChild(response);
        }
        return row;
    }

    protected showWarnings(warnings: readonly string[]): void {
        if (warnings.length > 0) {
            this.showNotice(warnings.join(' '));
        } else {
            this.hideNotice();
        }
    }

    protected showNotice(message: string): void {
        this.notice.textContent = message;
        this.notice.style.display = 'block';
    }

    protected hideNotice(): void {
        this.notice.textContent = '';
        this.notice.style.display = 'none';
    }

    protected formatTimestamp(value: number): string {
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
